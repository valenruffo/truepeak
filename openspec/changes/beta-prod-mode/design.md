# Design: Beta/Prod Mode Toggle with Waitlist & Admin Dashboard

## Technical Approach

We will implement a DB-backed configuration table (`app_config`) with an environment variable fallback to toggle the landing page mode between `beta` (waitlist email capture modal) and `prod` (direct Polar checkout). 

The application will resolve the active mode as follows:
1. Query the database table `app_config` for the key `"app_mode"`. If found, use its value.
2. If not found in the DB, read the environment variable `NEXT_PUBLIC_APP_MODE` (or `APP_MODE` on the backend).
3. If neither is set, fallback to `"beta"`.

This allows immediate, live toggling from the admin panel without rebuilding or redeploying the frontend/backend services.

---

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **DB-backed Configuration** (AppConfig Table) | Requires database query on load but allows real-time updates. | **Chosen**. Provides the best operational control without redeployment. |
| **Simple Admin Password Auth** | Low complexity, no user management needed, but relies on a shared secret. | **Chosen**. A single `ADMIN_PASSWORD` env var passed via `X-Admin-Password` is sufficient and secure for this single-operator dashboard. |
| **Spam Protection** (Honeypot + slowapi) | Honeypot is client-side invisible and zero-friction; `slowapi` handles rate limits. | **Chosen**. Rejects automated spam with minimal friction and avoids complex recaptcha setups. |

---

## Data Flow

### Waitlist Submission
```
Producer clicks CTA ──→ Opens Modal ──→ Enters email ──→ POST /api/waitlist
                                                              │
                                                   (Honeypot & Rate Limit Check)
                                                              │
                                            Persists email to DB (waitlist_entry)
```

### Live App Mode Toggle
```
Admin Dashboard ──→ Toggle Switch ──→ PUT /api/config/app-mode ──→ AppConfig Table
                                                                      │
Landing Page ───→ SWR Fetch ───→ GET /api/config/app-mode ───────────┘
```

---

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/app/models.py` | Modify | Define `WaitlistEntry` and `AppConfig` models. |
| `backend/app/database.py` | Modify | Ensure the new models are imported so `SQLModel.metadata.create_all` creates their tables. |
| `backend/app/api/waitlist.py` | Create | New router file with waitlist submit, list, export, and mode config endpoints. |
| `backend/app/main.py` | Modify | Import and mount the waitlist router. |
| `frontend/lib/api.ts` | Modify | Add TypeScript interfaces and API request helper functions for waitlist and app mode configs. |
| `frontend/lib/i18n.tsx` | Modify | Add translation strings for waitlist modal headers, placeholders, success, and error messages. |
| `frontend/app/page.tsx` | Modify | Add state for modal, fetch current mode, show waitlist modal, and conditional pricing buttons. |
| `frontend/app/admin/dashboard/page.tsx` | Create | Password login view and admin dashboard panel with mode toggle, waitlist table, and CSV export. |

---

## Interfaces / Contracts

### DB Models (SQLModel)
```python
from datetime import datetime, UTC
from uuid import uuid4
from sqlmodel import Field, SQLModel

class WaitlistEntry(SQLModel, table=True):
    __tablename__ = "waitlist_entry"
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    email: str = Field(unique=True, index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    source: str = Field(default="landing")

class AppConfig(SQLModel, table=True):
    __tablename__ = "app_config"
    key: str = Field(primary_key=True, index=True)
    value: str
```

### API Routes
- `GET /api/config/app-mode`
  - Response: `200 OK` `{ "mode": "beta" | "prod" }`
- `PUT /api/config/app-mode`
  - Headers: `X-Admin-Password: <password>`
  - Request Body: `{ "mode": "beta" | "prod" }`
  - Response: `200 OK` `{ "status": "ok", "mode": "beta" | "prod" }`
- `POST /api/waitlist`
  - Request Body: `{ "email": "user@example.com", "company": "" }` (honeypot `company` must be empty)
  - Response: `200 OK` `{ "status": "ok" }` (Note: if honeypot is filled, returns 200 `{ "status": "ok" }` but skips insertion)
- `GET /api/admin/waitlist`
  - Headers: `X-Admin-Password: <password>`
  - Query Params: `page=1`, `per_page=20`
  - Response: `200 OK` `{ "total": 25, "entries": [...] }`
- `GET /api/admin/waitlist/export`
  - Headers: `X-Admin-Password: <password>`
  - Response: `200 OK` (`text/csv` stream attachment)

---

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (Backend) | Waitlist submission logic, honeypot filter, duplicate handling, mode fallback. | pytest tests checking endpoint results. |
| Integration (Backend) | Rate limiting (slowapi) and admin authentication headers. | pytest tests asserting 429 and 401 response codes. |
| E2E / Manual | Pricing button clicks in beta/prod modes, login screen in dashboard, CSV export download. | Manual validation using browser devtools and Polar redirects. |

---

## Migration / Rollout

No database schema migrations are needed for existing columns. Since both `WaitlistEntry` and `AppConfig` are new tables, they will be automatically created by `SQLModel.metadata.create_all` during backend startup.

---

## Open Questions

None. The requirements and technical architecture are fully aligned with the specs.
