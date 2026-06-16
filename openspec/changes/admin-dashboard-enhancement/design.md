# Design: Admin Dashboard Enhancement

## Technical Approach

Enhance the admin dashboard to provide real-time updates, activity metrics, and seamless plan synchronization with Supabase Auth. This involves setting up a Supabase Realtime subscription on the frontend, exposing a new activity endpoint for submission metrics, and propagating plan changes to Supabase Auth metadata using the Service Role Key.

## Architecture Decisions

### Decision: Supabase Realtime for Label Updates

**Choice**: Use Supabase Realtime on the `label` table for instant frontend updates.
**Alternatives considered**: Polling (SWR/React Query intervals) or WebSockets via FastAPI.
**Rationale**: Supabase Realtime is built-in and requires minimal backend changes. Polling adds unnecessary server load, and building a custom WebSocket solution is over-engineering given Supabase's out-of-the-box support.

### Decision: Separate Activity Endpoint vs Included in Users List

**Choice**: Expose a separate `GET /api/admin/activity?label_id={id}` endpoint.
**Alternatives considered**: Join submission counts and max dates directly into the main users list query.
**Rationale**: Keeping it separate prevents the main user list query from becoming slow as the `submission` table grows. It allows the dashboard to load users instantly and fetch activity metrics asynchronously.

### Decision: Supabase Auth Metadata Synchronization

**Choice**: Call the Supabase Admin API from the backend using `SUPABASE_SERVICE_ROLE_KEY` after a label plan update.
**Alternatives considered**: Updating metadata directly from the frontend or using database triggers.
**Rationale**: Security. The frontend cannot be trusted with plan changes or the service role key. Database triggers obscure application logic and make debugging harder; handling it in the backend service layer keeps business logic centralized.

## Data Flow

    Admin Dashboard (Frontend)
         │           │           │
         │ (Realtime)│           │ (Plan Update)
         │           │           │
         ▼           ▼           ▼
    Supabase      Backend     Backend
    (label)      (Activity)    (Auth)
                     │           │
                     ▼           ▼
                  Postgres    Supabase Admin API
                 (submission) (User Metadata)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `frontend/app/admin/dashboard/page.tsx` | Modify | Add Realtime subscription, activity fetch, search/sort logic, and UI badges. |
| `frontend/lib/api.ts` | Modify | Add client function for the new activity endpoint. |
| `backend/app/api/waitlist.py` | Modify | Expose `GET /api/admin/activity?label_id={id}` for submission metrics. |
| `backend/app/services/auth.py` | Modify | Implement `sync_plan_to_supabase` using Service Role Key. |

## Interfaces / Contracts

### Activity Endpoint Response
```json
{
  "total_submissions": 42,
  "last_submission_at": "2026-06-12T14:20:00Z"
}
```

### Supabase Admin API Payload (Metadata)
```json
{
  "user_metadata": {
    "plan": "indie",
    "subscription_status": "active",
    "max_tracks_month": 100
  }
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Plan Synchronization | Mock `SUPABASE_SERVICE_ROLE_KEY` requests and verify metadata payload format. |
| Integration | Activity Endpoint | Insert test submissions and verify correct count and max date are returned. |
| E2E | Realtime Updates | Update label in DB and assert UI updates without a page reload. |

## Migration / Rollout

No database schema migration required (Label model already contains the necessary fields). Must ensure `SUPABASE_SERVICE_ROLE_KEY` is added to the backend environment variables before deployment.

## Open Questions

- [ ] Does the Supabase Service Role key need rotation handling?
- [ ] Should we paginate the main users list if the number of labels grows significantly, or is client-side searching sufficient for now?