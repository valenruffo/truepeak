# Spec: Admin Dashboard Enhancement

**Change**: admin-dashboard-enhancement
**Type**: New Capabilities
**Domains**: admin-dashboard-activity, admin-user-management

---

## Domain: admin-dashboard-activity

Viewing user submission and email activity logs from the admin dashboard.

### Requirement: Admin Activity Endpoint

`GET /api/admin/activity?label_id={id}` MUST return aggregated activity metrics for a single label. The response MUST include `total_submissions` (integer), `last_submission_at` (ISO 8601 string or null), `emails_sent_this_month` (integer), and `max_emails_month` (integer). The endpoint MUST require admin authentication via `X-Admin-Password` header.

#### Scenario: Label with submissions

- GIVEN a label with id=42 has 15 submissions, the most recent at 2026-06-10T14:00:00Z
- AND the label has sent 30 emails this month with a max of 100
- WHEN admin calls `GET /api/admin/activity?label_id=42`
- THEN response MUST be `{ "total_submissions": 15, "last_submission_at": "2026-06-10T14:00:00Z", "emails_sent_this_month": 30, "max_emails_month": 100 }`

#### Scenario: Label with no submissions

- GIVEN a label with id=99 has zero submissions
- WHEN admin calls `GET /api/admin/activity?label_id=99`
- THEN response MUST include `"total_submissions": 0` and `"last_submission_at": null`

#### Scenario: Unauthenticated request

- GIVEN no `X-Admin-Password` header is provided
- WHEN any request is sent to `/api/admin/activity`
- THEN response status MUST be 401

### Requirement: Recent Activity Endpoint

`GET /api/admin/recent-activity?page={page}&per_page={per_page}` MUST return paginated recent submissions across all labels, ordered by `created_at` DESC. Each entry MUST include `id`, `label_id`, `producer_name`, `track_title`, `status`, `created_at`. Default pagination: page=1, per_page=20. MUST require admin authentication.

#### Scenario: Fetch first page of recent activity

- GIVEN 50 submissions exist across multiple labels
- WHEN admin calls `GET /api/admin/recent-activity?page=1&per_page=20`
- THEN response MUST contain 20 entries ordered by `created_at` DESC
- AND response MUST include `total` count of 50

#### Scenario: Fetch beyond available pages

- GIVEN 50 submissions exist (3 pages at per_page=20)
- WHEN admin calls `GET /api/admin/recent-activity?page=4&per_page=20`
- THEN response MUST contain an empty entries array and `total: 50`

### Requirement: Activity Tab UI

The admin dashboard MUST include an "Activity" tab alongside existing tabs. When active, it MUST display a paginated table of recent submissions across all labels (20 per page). Each row MUST show: producer name, track title, label name/email, status, and submission date.

#### Scenario: Activity tab renders

- GIVEN admin is authenticated and clicks the "Activity" tab
- WHEN the tab becomes active
- THEN the system MUST fetch and display recent submissions
- AND show pagination controls if total exceeds 20

---

## Domain: admin-user-management

Realtime syncing, filtering, and Supabase Auth metadata propagation for admin operations.

### Requirement: Supabase Realtime Subscription

The frontend MUST subscribe to the `label` table via `supabase.channel('admin-labels')` for INSERT, UPDATE, and DELETE events. On INSERT: the new row MUST be prepended to the user list. On UPDATE: the matching row (by id) MUST be updated in-place. On DELETE: the matching row MUST be removed. The subscription MUST respect RLS policies (admin role only).

#### Scenario: New user registration appears in realtime

- GIVEN admin dashboard is open and Realtime is connected
- WHEN a new label row is inserted into the database
- THEN the new user MUST appear at the top of the list within 2 seconds

#### Scenario: Plan update reflects in realtime

- GIVEN admin dashboard is open and a label's plan is updated externally
- WHEN the UPDATE event is received
- THEN the corresponding row MUST reflect the new plan value immediately

#### Scenario: Realtime connection drops

- GIVEN the Realtime WebSocket disconnects unexpectedly
- WHEN no events are received for 30 seconds
- THEN the system MUST fall back to SWR revalidation every 30 seconds
- AND MUST attempt to re-establish the Realtime subscription

### Requirement: Plan Change Propagation to Supabase Auth

When an admin updates a user's plan via the dashboard, the backend MUST:
1. Update the `label` table (existing behavior)
2. Call Supabase Admin API: `PUT /auth/v1/admin/users/{user_id}` with `user_metadata` containing `plan`, `subscription_status`, and `max_tracks_month`
3. Use the `SUPABASE_SERVICE_ROLE_KEY` environment variable for authentication

If the Supabase Admin API call fails, the backend MUST log the error but MUST NOT rollback the label table update.

#### Scenario: Successful plan change propagation

- GIVEN admin changes a user's plan from "free" to "indie"
- WHEN the PUT `/api/admin/users/{user_id}/status` endpoint is called
- THEN the label table MUST be updated
- AND Supabase Auth user metadata MUST include `{ "plan": "indie", "subscription_status": "active", "max_tracks_month": 100 }`
- AND the propagation MUST complete within 1 second

#### Scenario: Supabase Admin API failure

- GIVEN the Supabase Admin API returns a 500 error
- WHEN admin changes a user's plan
- THEN the label table update MUST succeed
- AND the error MUST be logged with the user_id and error details
- AND the response to the admin MUST indicate partial success (label updated, metadata sync failed)

#### Scenario: Rate limit handling

- GIVEN Supabase Admin API returns 429 (rate limit)
- WHEN a plan change is attempted
- THEN the backend MUST retry with exponential backoff (max 3 retries)
- AND if all retries fail, MUST log the error

### Requirement: Client-Side Search

The admin dashboard MUST include a search input that filters the user list by name, email, and slug. Filtering MUST be case-insensitive and MUST operate client-side on the current dataset.

#### Scenario: Search by email

- GIVEN the user list contains "john@example.com" and "jane@example.com"
- WHEN admin types "john" in the search input
- THEN only the row with "john@example.com" MUST be visible

#### Scenario: Case-insensitive search

- GIVEN a user with name "Alice"
- WHEN admin types "alice" (lowercase)
- THEN the row MUST be visible

#### Scenario: Empty search

- GIVEN search has filtered to 1 result
- WHEN admin clears the search input
- THEN all users MUST be visible again

### Requirement: Client-Side Sort

The dashboard MUST provide a sort dropdown with options: created_at (newest/oldest), plan (free/indie/pro), submission_count. Selecting a sort option MUST reorder the list immediately.

#### Scenario: Sort by newest

- GIVEN users created on different dates
- WHEN admin selects "Newest first"
- THEN the list MUST be ordered by `created_at` DESC

#### Scenario: Sort by plan tier

- GIVEN users with plans: free, pro, indie
- WHEN admin selects "Plan" sort
- THEN the list MUST be ordered: free, indie, pro

### Requirement: Visual Plan and Status Badges

The dashboard MUST display plan and status as colored badges instead of plain text.

| Badge | Color |
|-------|-------|
| Plan: free | gray |
| Plan: indie | blue |
| Plan: pro | green |
| Status: active | green |
| Status: frozen | yellow |
| Status: canceled | red |
| Status: suspended | red |

#### Scenario: Plan badge renders correctly

- GIVEN a user with plan="indie"
- WHEN the user row renders
- THEN a blue badge with text "indie" MUST be displayed

#### Scenario: Status badge renders correctly

- GIVEN a user with status="frozen"
- WHEN the user row renders
- THEN a yellow badge with text "frozen" MUST be displayed

### Requirement: Last Active Column

The user table MUST include a "Last Active" column showing relative time (e.g., "2 days ago") based on `last_submission_at`. If the user has no submissions, it MUST display "Never".

#### Scenario: User with recent activity

- GIVEN a user whose last submission was 2 days ago
- WHEN the user row renders
- THEN "Last Active" MUST show "2 days ago"

#### Scenario: User with no submissions

- GIVEN a user with no submissions ever
- WHEN the user row renders
- THEN "Last Active" MUST show "Never"
