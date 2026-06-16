# Apply Progress — Admin User Management

**Change Name**: admin-user-management  
**Status**: IN_PROGRESS  

## Completed Tasks

### Phase 1: Backend Development
- [x] 1.1 Update `PLAN_LIMITS` for 'pro' tier in `backend/app/api/labels.py` so `max_tracks_month` is 1000 instead of 500.
- [x] 1.2 Implement `GET /api/admin/users` in `backend/app/api/waitlist.py` to list labels with fields `id`, `name`, `slug`, `email`, `plan`, `status`, `created_at`, `track_limit`, `email_limit`, `hq_retention_days`, `role`.
- [x] 1.3 Implement `PUT /api/admin/users/{user_id}/status` in `backend/app/api/waitlist.py` to update plan ("free"|"indie"|"pro") and/or subscription status ("active"|"frozen"|"canceled").
  - When plan changes, apply the corresponding plan limits via `_apply_plan_limits`.
  - When status is set to active, clear `frozen_at`.
  - When status is frozen, set `frozen_at` to the current UTC timestamp.
- [x] 1.4 Add test cases in `backend/tests/test_waitlist.py` to verify GET and PUT user admin endpoints (verify auth header `X-Admin-Password`, verify updates correctly refresh plan limits).
- [x] 1.5 Run `pytest tests/test_waitlist.py` to verify backend tests pass.

### Phase 2: Frontend Client Integration
- [x] 2.1 Add type `AdminUser` and helper client methods `getAdminUsers` and `updateUserStatus` to `frontend/lib/api.ts`.

### Phase 3: Frontend Dashboard UI
- [x] 3.1 Implement navigation tabs ("waitlist" and "users") in `frontend/app/admin/dashboard/page.tsx` with proper layout container structure.
- [x] 3.2 Fetch users using SWR when the "users" tab is active.
- [x] 3.3 Display the users in a table with columns: Name/Slug, Email, Plan (as a dropdown selector), Status (as a dropdown selector), Track Limit, and Created At.
- [x] 3.4 Wire up the dropdown selectors to call `updateUserStatus`, trigger SWR revalidation (via optimistic updates), and show success/error toast alerts.
- [x] 3.5 Verify frontend TypeScript type-checking (`npx tsc --noEmit`).

---

## Files Changed
- `backend/app/api/labels.py`
- `backend/app/api/waitlist.py`
- `backend/tests/test_waitlist.py`
- `frontend/lib/api.ts`
- `frontend/app/admin/dashboard/page.tsx`

---

## Deviations
- None. All tasks have been implemented strictly according to the implementation plan and task lists.
- Pre-existing failures in the backend test suite (`test_trash_restore_r2.py` and `test_validation_severity.py`) are due to mock sessions lacking the recently introduced track expiration lifecycle mocks. These are unrelated to the admin user management changes, which pass perfectly in isolation.

---

## Next Steps
- Verify production build completes successfully.
- Prepare single PR for the changes.
