# Proposal: Beta/Prod Mode Toggle with Waitlist & Admin Dashboard

## Intent

TruePeak is in closed beta but needs a production-ready pricing flow for launch. The landing page must support two modes: **Beta** (collect waitlist emails via modal) and **Prod** (redirect to Polar checkout). An admin dashboard lets the operator toggle modes and manage waitlist entries without code deploys.

## Scope

### In Scope
- `AppConfig` and `WaitlistEntry` SQLModel tables for mode persistence and email collection
- Public API: `GET /config/app-mode` (mode fetch), `POST /waitlist` (submit email)
- Admin API: `PUT /config/app-mode` (toggle), `GET /waitlist` (list + export)
- Admin dashboard page with password auth (`ADMIN_PASSWORD` env var)
- Pricing button behavior: Beta → open waitlist modal, Prod → Polar checkout links
- Waitlist modal with honeypot spam protection
- Rate limiting on `POST /waitlist` via slowapi (already a dependency)

### Out of Scope
- User registration/JWT auth changes
- Email notification/confirmation for waitlist entries
- Polar webhook modifications
- Multi-language admin dashboard (Spanish landing only)

## Capabilities

### New Capabilities
- `app-mode-toggle`: DB-backed beta/prod mode with env var fallback (`APP_MODE`)
- `waitlist-collection`: Email capture with honeypot + rate limiting, stored in SQLite
- `admin-dashboard`: Password-protected page for mode toggle, waitlist view, CSV export

### Modified Capabilities
- `pricing-buttons`: Conditional behavior — modal (beta) or Polar checkout link (prod)

## Approach

Add two SQLModel tables (`AppConfig`, `WaitlistEntry`). Create a new FastAPI router at `backend/app/api/waitlist.py` with public and admin endpoints. Admin auth uses a simple password check against `ADMIN_PASSWORD` env var — separate from existing JWT user auth. Frontend fetches mode via SWR from `/config/app-mode` with `APP_MODE` env var as fallback. Pricing buttons in `page.tsx` conditionally open an inline waitlist modal (beta) or navigate to Polar checkout URLs (prod). Admin dashboard is a new Next.js page behind client-side password gate.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/app/models.py` | Modified | Add `WaitlistEntry` + `AppConfig` SQLModel classes |
| `backend/app/database.py` | Modified | Register new tables in engine metadata |
| `backend/app/api/waitlist.py` | **New** | Router: POST /waitlist, GET /waitlist, GET/PUT /config/app-mode |
| `backend/app/main.py` | Modified | Mount waitlist router |
| `frontend/app/page.tsx` | Modified | Pricing button logic + inline waitlist modal component |
| `frontend/app/admin/page.tsx` | **New** | Admin dashboard: mode toggle, waitlist table, CSV export |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Spam waitlist submissions | Medium | Honeypot field + slowapi rate limiting (5/min per IP) |
| Admin password brute force | Low | Rate limiting on admin endpoints + env var rotation |
| Mode desync (cache vs DB) | Low | SWR revalidation on focus + short stale time (30s) |
| SQLite table migration on deploy | Low | SQLModel `create_all` handles additive schema |

## Rollback Plan

1. Remove waitlist router mount from `main.py`
2. Revert `models.py` and `database.py` to remove new tables
3. Revert `page.tsx` pricing buttons to static `/register` links
4. Delete `admin/page.tsx` and `api/waitlist.py`
5. Tables remain in SQLite (harmless) — drop manually if needed

## Dependencies

- `slowapi` (already installed)
- Polar checkout URLs for Indie ($25/mo) and Pro ($49/mo) plans
- `ADMIN_PASSWORD` env var configured in deployment
- `APP_MODE` env var as optional fallback (defaults to `beta`)

## Success Criteria

- [ ] Beta mode: all pricing buttons open waitlist modal, email is stored in DB
- [ ] Prod mode: Indie/Pro buttons redirect to correct Polar checkout URLs
- [ ] Admin dashboard: password login, toggle mode, view waitlist with count
- [ ] Admin dashboard: CSV export of waitlist emails
- [ ] Honeypot field rejects bot submissions silently
- [ ] Rate limit returns 429 after 5 requests/min from same IP
- [ ] Mode toggle persists across server restarts (DB-backed)
