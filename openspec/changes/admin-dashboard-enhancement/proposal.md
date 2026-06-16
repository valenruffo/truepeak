# Proposal: Admin Dashboard Enhancement

## Intent
The existing admin dashboard requires manual refreshes, lacks visibility into user activity (submissions and emails), and doesn't sync plan updates back to Supabase Auth. This change will introduce realtime updates, add activity tracking, and propagate plan changes to Supabase metadata to improve admin operational efficiency and ensure data consistency.

## Scope

### In Scope
- Supabase Realtime subscriptions for instant user registration and plan/status updates.
- New "Activity" tab and row indicators showing submission counts, last activity date, and email limits.
- Plan change propagation to Supabase user metadata via Service Role Key.
- Dashboard UX improvements: search, filtering, sorting, and visual plan indicators.

### Out of Scope
- Sentry integration.
- User creation directly from the admin dashboard (use Supabase dashboard).
- Billing and subscription management (handled via Polar).

## Capabilities

> This section is the CONTRACT between proposal and specs phases.
> The sdd-spec agent reads this to know exactly which spec files to create or update.

### New Capabilities
- `admin-dashboard-activity`: Viewing user submission and email activity logs.
- `admin-user-management`: Realtime syncing, filtering, and Supabase Auth metadata propagation for admin operations.

### Modified Capabilities
- None

## Approach
Enable Supabase Realtime for the `label` table to push `INSERT` and `UPDATE` events to the frontend, updating the SWR cache. Expose a new `GET /api/admin/activity` endpoint retrieving aggregated submission and email metrics. Update `backend/app/services/auth.py` to sync `plan`, `subscription_status`, and `max_tracks_month` to Supabase user metadata when changed via the dashboard. Implement client-side search, filtering, and sorting in the React component.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `frontend/app/admin/dashboard/page.tsx` | Modified | Add Realtime subscription, Activity tab, search/filter/sort UX |
| `frontend/lib/api.ts` | Modified | Add activity fetcher endpoint |
| `backend/app/api/waitlist.py` | Modified | Add `/activity` endpoint, enable Realtime schema configurations |
| `backend/app/services/auth.py` | Modified | Sync plan updates to Supabase Auth metadata |
| `backend/app/main.py` | Modified | Mount activity router if isolated |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Admin password auth gets bypassed by Realtime | Low | Realtime RLS policies must strictly enforce admin role/auth logic. Fallback is retaining API endpoints for actual changes. |
| Supabase Auth Service Role Key exposed | Low | Validate environment variable configurations to ensure the key remains server-side only. |
| Incomplete real-time synchronization | Med | Use SWR 30s revalidation as a fallback layer for eventual consistency. |

## Rollback Plan
1. Revert `frontend/app/admin/dashboard/page.tsx` and `lib/api.ts` to their pre-enhancement commits.
2. Disable Supabase Realtime on the `label` table.
3. Remove the Service Role Key integration from `auth.py`.

## Dependencies
- Supabase project configured with Realtime enabled for the `label` table.
- Supabase Service Role Key available in backend environment variables.

## Success Criteria
- [ ] New user appears in admin dashboard within 2 seconds of registration.
- [ ] Plan change propagates to Supabase Auth metadata within 1 second.
- [ ] Admin can view submission counts and last activity per user.
- [ ] Search/filter functionally works across name, email, slug, and plan.
- [ ] No breaking changes to the existing admin login or functionality.