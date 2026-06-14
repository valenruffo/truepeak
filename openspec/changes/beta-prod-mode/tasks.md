# Tasks: Beta/Prod Mode Toggle with Waitlist & Admin Dashboard

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 500-600 lines |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Backend models, routers, and API tests) → PR 2 (Frontend page CTA, SWR, modal, translations) → PR 3 (Admin dashboard and styling) |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Backend DB models and API endpoints | PR 1 | WaitlistEntry & AppConfig tables, /api/waitlist and /api/config routes |
| 2 | Landing page pricing and waitlist modal | PR 2 | Page.tsx integration, modal component, translations |
| 3 | Admin dashboard and password protection | PR 3 | Admin dashboard UI, login check, toggle switch, export |

---

## Phase 1: Backend Foundation

- [x] 1.1 Add `WaitlistEntry` and `AppConfig` models to `backend/app/models.py`.
- [x] 1.2 Import new models in `backend/app/database.py` to auto-create tables on startup.
- [x] 1.3 Create `backend/app/api/waitlist.py` with endpoints: `GET /api/config/app-mode`, `PUT /api/config/app-mode` (with admin auth), `POST /api/waitlist` (honeypot + slowapi), `GET /api/admin/waitlist` (paginated list), and `GET /api/admin/waitlist/export` (CSV stream).
- [x] 1.4 Mount `waitlist` router in `backend/app/main.py`.

---

## Phase 2: Frontend Integrations & UI

- [x] 2.1 Add API client functions and typings to `frontend/lib/api.ts`.
- [x] 2.2 Add Spanish and English waitlist translation keys to `frontend/lib/i18n.tsx`.
- [x] 2.3 Modify pricing buttons in `frontend/app/page.tsx` to conditionally redirect to Polar or trigger the early access waitlist modal based on SWR mode fetch.
- [x] 2.4 Add early access waitlist modal to `frontend/app/page.tsx` with email validation, honeypot field, success feedback, and error state.

---

## Phase 3: Admin Dashboard

- [x] 3.1 Create `frontend/app/admin/dashboard/page.tsx` with high-aesthetic login card asking for admin password.
- [x] 3.2 Add admin dashboard view showing waitlist statistics (total count), a list table of emails ordered by date, and a CSV export download button.
- [x] 3.3 Add live mode switch toggle (BETA / PROD) that calls `PUT /api/config/app-mode` to update the DB.

---

## Phase 4: Verification

- [x] 4.1 Write pytest integration tests for waitlist submission, rate limiting, and admin auth.
- [ ] 4.2 Verify modal submission and validation manually.
- [ ] 4.3 Verify admin toggle persists and correctly updates the landing page CTA behavior.
