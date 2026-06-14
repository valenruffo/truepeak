# Exploration: beta-prod-mode

> Generated: 2026-06-14 | Change: `beta-prod-mode` | Project: `dentalux-landing`

## Current State

### Pricing Component (`frontend/app/page.tsx` L1678-1763)

The `Pricing()` function renders 3 tiers (Free, Indie, Pro) defined as a `tiers` array. Key observations:

- **All 3 buttons link to `/register`** via `tier.href` — no external links currently.
- CTA text comes from i18n keys: `pricing.free_cta`, `pricing.indie_cta`, `pricing.pro_cta`.
- Uses `useLanguage()` hook for translations.
- Button rendering has a conditional: internal links use `<Link>`, external use `<a target="_blank">` — **this pattern already supports external checkout URLs**.
- The component is a local function inside the 1852-line `page.tsx` monolith (not extracted).

### Backend Architecture

- **Database**: PostgreSQL via Supabase (NOT SQLite as assumed). `POSTGRES_URL` env var required. Uses SQLModel + SQLAlchemy.
- **Models** (`backend/app/models.py`): 5 models — `Label`, `Submission`, `EmailLog`, `EmailTemplate`, `Notification`. All use UUID primary keys with `uuid4()`.
- **Auth** (`backend/app/services/auth.py`): Supabase JWT verification via HTTP call to `{SUPABASE_URL}/auth/v1/user`. Returns `{label_id, email}`.
- **Auth helper** (`backend/app/api/labels.py` L47-69): `_get_label_from_token()` extracts JWT from Authorization header, X-Label-Token header, or cookie.
- **Rate limiting**: Uses `slowapi` with `get_remote_address`.
- **API structure**: Routers at `/api/labels`, `/api/upload`, `/api/submissions`, `/api/email`, `/api/health`, `/api/polar-webhook`.
- **Migrations**: Inline idempotent ALTER TABLE in `init_db()` — no Alembic.

### Frontend Architecture

- **Framework**: Next.js with TypeScript, deployed on Vercel.
- **UI library**: shadcn/ui components including **`Dialog`** (custom implementation, not Radix — simple open/close with backdrop blur).
- **Components**: `components/ui/` has dialog, button, input, card, table, toast, etc.
- **Routing**: App Router with `(auth)/login`, `(auth)/register`, `(dashboard)/inbox|config|emails|settings|link|guide`.
- **i18n**: Custom `useLanguage()` hook from `@/lib/i18n`.
- **Config**: `next.config.ts` uses `NEXT_PUBLIC_API_URL` for backend proxy.
- **No `.env` files in repo** — managed via Vercel environment variables.

### Payments (Polar)

- Polar webhook handler exists at `/api/polar-webhook` for subscription lifecycle events.
- Labels already have `polar_customer_id` and `polar_subscription_id` fields.
- `POLAR_WEBHOOK_SECRET` env var for signature verification.
- Plans defined in `PLAN_LIMITS` dict: free, indie, pro.

## Affected Areas

- `frontend/app/page.tsx` — Pricing component needs mode-aware button behavior (modal vs redirect)
- `frontend/components/ui/dialog.tsx` — Reuse existing Dialog for waitlist modal
- `frontend/lib/i18n.tsx` — New translation keys for beta modal text
- `frontend/next.config.ts` — May need env var exposure (`NEXT_PUBLIC_APP_MODE`)
- `backend/app/models.py` — New `WaitlistEntry` + `AppConfig` models
- `backend/app/database.py` — `init_db()` will auto-create new tables
- `backend/app/main.py` — Register new `waitlist` and `admin` routers
- `backend/app/api/` — New files: `waitlist.py`, `admin.py`
- `frontend/app/admin/` — New protected admin dashboard route

## Approaches

### 1. Environment Variable Only (Simple)

BETA/PROD mode controlled purely by `NEXT_PUBLIC_APP_MODE` env var on the frontend.

- **Pros**: Zero backend complexity for mode switching. Instant deploys via Vercel env change. No DB config table needed.
- **Cons**: Changing mode requires Vercel redeploy. No live toggle from admin dashboard. Can't override per-request.
- **Effort**: Low

### 2. DB Config Table + Admin Override (Full)

New `AppConfig` table stores key-value config. Admin dashboard reads/writes `app_mode`. Frontend fetches current mode from API on load, with `NEXT_PUBLIC_APP_MODE` as fallback default.

- **Pros**: Live mode switching without redeploy. Admin dashboard has full control. Mode persists across restarts.
- **Cons**: Extra API call on landing page load (latency). More backend surface area. Requires admin auth.
- **Effort**: Medium

### 3. Hybrid: Env Var Default + Admin Override (Recommended)

`NEXT_PUBLIC_APP_MODE` sets the build-time default. An API endpoint `/api/config/mode` returns the current mode from DB (if overridden) or the env var value. Frontend checks this API endpoint with the env var as immediate fallback.

- **Pros**: Works immediately without API (SSR-friendly). Admin can override live. Graceful degradation if API is down. Clean separation of concerns.
- **Cons**: Slight complexity in mode resolution logic. Two sources of truth to reason about.
- **Effort**: Medium

### Admin Auth Approaches

#### A. Separate Admin Password (Simple)
- `ADMIN_PASSWORD` env var on backend.
- Admin login page sends password, gets a short-lived admin JWT.
- **Pros**: Dead simple. No Supabase dependency. Independent from label auth.
- **Cons**: Single shared password. No audit trail of who accessed.
- **Effort**: Low

#### B. Reuse Supabase JWT + Admin Email Allowlist
- `ADMIN_EMAILS` env var (comma-separated).
- Reuse existing `_get_label_from_token()` auth, check if email is in allowlist.
- **Pros**: Reuses existing auth. Individual accountability.
- **Cons**: Requires user to have a label account to access admin. More coupling.
- **Effort**: Low

### Modal Approach

#### A. Inline in Pricing Component
- Add modal state + form directly inside `Pricing()` function.
- **Pros**: Self-contained. No new files for the landing page.
- **Cons**: `page.tsx` is already 1852 lines. Further bloat.
- **Effort**: Low

#### B. Separate `BetaWaitlistModal` Component (Recommended)
- New file `frontend/components/BetaWaitlistModal.tsx`.
- Uses existing `Dialog` component from `components/ui/dialog.tsx`.
- Pricing component just manages open/close state.
- **Pros**: Clean separation. Reusable. Doesn't bloat the monolith further.
- **Cons**: One more file to create.
- **Effort**: Low

## Recommendation

**Approach 3 (Hybrid) + Admin Auth A (Simple password) + Modal B (Separate component)**

Rationale:
1. **Hybrid mode**: Env var provides a fast, SSR-compatible default that works without backend. Admin override adds the live toggle. Best of both worlds with graceful degradation.
2. **Simple admin password**: The admin dashboard is internal-only tooling. A shared password via env var is sufficient for an MVP. Can upgrade to email allowlist later.
3. **Separate modal component**: The landing page is already a 1852-line monolith. Adding modal + form inline would make it worse. A `BetaWaitlistModal.tsx` is cleaner.

### Proposed New Models

```python
class WaitlistEntry(SQLModel, table=True):
    __tablename__ = "waitlist_entry"
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    email: str = Field(index=True, unique=True)
    tier: str  # "free" | "indie" | "pro"
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    source: str = Field(default="landing")  # for tracking

class AppConfig(SQLModel, table=True):
    __tablename__ = "app_config"
    key: str = Field(primary_key=True)
    value: str
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
```

### New Files Needed

| File | Purpose |
|------|---------|
| `backend/app/api/waitlist.py` | POST `/api/waitlist` (submit email), GET `/api/waitlist` (admin list) |
| `backend/app/api/admin.py` | POST `/api/admin/login`, GET `/api/admin/dashboard`, PUT `/api/admin/config/mode` |
| `frontend/components/BetaWaitlistModal.tsx` | Modal with email form for beta signups |
| `frontend/app/admin/dashboard/page.tsx` | Admin dashboard to view waitlist + toggle mode |
| `frontend/app/admin/layout.tsx` | Admin layout with auth guard |

### Polar Checkout URLs

For PROD mode, each tier's `href` should point to Polar checkout links. These will need to be provided by the user or configured as env vars:
- `NEXT_PUBLIC_POLAR_FREE_URL` (or keep as `/register` since free is free)
- `NEXT_PUBLIC_POLAR_INDIE_URL`
- `NEXT_PUBLIC_POLAR_PRO_URL`

### Spam Protection

- Rate limiting via `slowapi` (already in the stack) — e.g., 3 waitlist submissions per IP per hour.
- Email format validation via Pydantic `EmailStr`.
- Optional: simple honeypot field in the form.

## Risks

- **page.tsx monolith**: At 1852 lines, modifying Pricing inline risks merge conflicts. Extracting to a component is safer but adds scope.
- **Mode resolution race**: If the frontend loads before the API responds, users might briefly see the wrong mode. Mitigate by using env var as SSR default and API as client-side override.
- **No .env files in repo**: All env vars are on Vercel. New vars (`NEXT_PUBLIC_APP_MODE`, `ADMIN_PASSWORD`, Polar URLs) need to be added to Vercel dashboard.
- **PostgreSQL (not SQLite)**: The existing DB is Supabase PostgreSQL, not SQLite. This is actually better (real constraints, real unique indexes), but the exploration request assumed SQLite.
- **Admin route protection**: Next.js middleware or client-side auth check needed. No existing admin pattern to follow — this is a new concern.
- **CORS for admin routes**: Admin dashboard will be same-origin (Vercel), but API calls need the existing CORS config to cover them.

## Ready for Proposal

**Yes** — The codebase is well understood. The feature scope is clear with 3 distinct slices: (1) mode-aware pricing + waitlist modal, (2) backend waitlist API + model, (3) admin dashboard. Ready to proceed to proposal phase.
