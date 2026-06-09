# Frontend Caching Specification

## Purpose

Client-side caching, request deduplication, and stale-while-revalidate data fetching for the True Peak dashboard. Eliminates redundant API calls when navigating between pages and provides instant page transitions for previously visited data.

---

## Requirements

### Requirement: SWR Global Provider & Authenticated Fetcher

The system MUST provide a centralized SWR configuration module (`frontend/lib/swr-config.ts`) that exports a React context provider wrapping the dashboard layout.

The provider SHALL:
- Export an authenticated `fetcher` function that reads the JWT from Supabase session (or `localStorage.getItem("token")`) and injects it as `Authorization: Bearer <token>`
- Set `revalidateOnFocus: false` to prevent refetch on tab switch
- Set `dedupingInterval: 5000` (ms) to collapse identical concurrent requests
- Set `revalidateOnReconnect: true` to refresh data when network returns
- Set `refreshInterval: 0` (no polling by default)
- Set `shouldRetryOnError: true` with max 2 retries

The dashboard layout (`frontend/app/(dashboard)/layout.tsx`) MUST wrap `{children}` with `<SWRConfig value={...}>` so all descendant `useSWR` calls inherit the global fetcher and settings.

#### Scenario: SWR provider wraps dashboard

- GIVEN a user navigates to any `/dashboard/*` route
- WHEN the layout renders
- THEN all child components have access to the SWR context
- AND any `useSWR(key)` call uses the authenticated fetcher automatically without passing a custom fetcher

#### Scenario: Fetcher injects JWT token

- GIVEN a `useSWR("/api/submissions?status=inbox")` call is made
- WHEN SWR invokes the fetcher
- THEN the fetcher reads the current Supabase session token
- AND the outgoing request includes `Authorization: Bearer <token>`
- AND `credentials: "include"` is set for cookie-based fallback

#### Scenario: Token refresh mid-session

- GIVEN a user's Supabase session token has been refreshed (e.g. after 1 hour)
- WHEN a subsequent `useSWR` revalidation fires
- THEN the fetcher reads the LATEST token from Supabase (not a stale closure)
- AND the request succeeds with the new token

---

### Requirement: Global Label Data Cache (Zustand)

The system MUST provide a Zustand store (`frontend/store/label-cache.ts` or extend `frontend/lib/store.ts`) that caches the `/api/labels/{slug}` response globally.

The store SHALL:
- Expose `labelData: LabelConfig | null` and `setLabelData(data)` 
- Expose `labelLoading: boolean` and `labelError: string | null`
- Be populated ONCE by the dashboard layout on mount
- Be consumed by: layout sidebar, inbox page, CRM page, templates page, link page
- Replace the per-page `fetch(/api/labels/${slug})` calls that currently duplicate this request 4+ times per session

The store MUST use SWR internally (via a `useLabelData()` hook) so the label config benefits from deduplication and stale-while-revalidate.

#### Scenario: Label fetched once across pages

- GIVEN a user navigates from Inbox → CRM → Templates
- WHEN each page mounts and reads label data
- THEN `/api/labels/{slug}` is fetched exactly ONCE (on first mount or layout init)
- AND subsequent pages read from the Zustand store / SWR cache instantly
- AND no duplicate network requests appear in DevTools

#### Scenario: Label data available to all consumers

- GIVEN the layout has populated the label cache
- WHEN the CRM page mounts and calls `useLabelData()`
- THEN it receives `{ name, plan, subscription_status, reply_to_email, ... }` immediately from cache
- AND no loading spinner is shown for label-dependent UI

#### Scenario: Label revalidation on reconnect

- GIVEN the user's network drops and reconnects
- WHEN SWR detects `revalidateOnReconnect`
- THEN the label data is silently re-fetched in the background
- AND the Zustand store is updated with fresh data
- AND all consumers re-render with updated values

---

### Requirement: Inbox Page SWR Integration

The inbox page (`frontend/app/(dashboard)/inbox/page.tsx`) MUST replace its manual `fetchColumn()` useCallback pattern with `useSWR` for each board column.

The page SHALL use one `useSWR` call per column:
- `useSWR(["/api/submissions", { status: "inbox", offset, limit: PAGE_SIZE }])` → inbox column
- `useSWR(["/api/submissions", { status: "shortlist", offset, limit: PAGE_SIZE }])` → shortlist column
- `useSWR(["/api/submissions", { status: "rejected", offset, limit: PAGE_SIZE }])` → rejected column
- `useSWR(["/api/submissions", { status: "auto_rejected", offset, limit: PAGE_SIZE }])` → system/auto-rejected
- `useSWR(["/api/submissions", { include_deleted: true, offset, limit: PAGE_SIZE }])` → trash

Each SWR key MUST be unique per column+offset combination to support pagination (load more).

The page MUST maintain:
- localStorage fallback via `getCache("tp_inbox_board")` as `fallbackData` for instant hydration
- Existing drag-and-drop functionality (status transitions via `mutate()`)
- Optimistic updates: on drag-drop status change, call `mutate(key, optimisticData, { rollbackOnError: true })`
- "Load more" pagination: increment offset, triggering a new SWR key

#### Scenario: Inbox loads from cache on remount

- GIVEN a user visited inbox, navigated away, then returns
- WHEN the inbox page remounts
- THEN SWR returns cached board data immediately (no loading spinner)
- AND SWR triggers a background revalidation to check for new submissions
- AND the UI updates seamlessly when fresh data arrives

#### Scenario: Optimistic drag-and-drop status change

- GIVEN a submission is in the "inbox" column
- WHEN the user drags it to "shortlist"
- THEN SWR `mutate` is called with optimistic data (item removed from inbox, added to shortlist)
- AND both SWR keys are updated: `mutate(["/api/submissions", { status: "inbox", ... }])` and `mutate(["/api/submissions", { status: "shortlist", ... }])`
- AND if the backend call fails, the optimistic update is rolled back

#### Scenario: Pagination with load more

- GIVEN inbox column has `hasMore: true` and current offset is 0
- WHEN user clicks "Load more"
- THEN a new SWR request fires with `offset: PAGE_SIZE`
- AND results are appended to the existing column data
- AND the offset state is updated for subsequent loads

---

### Requirement: CRM/Emails Page SWR Integration

The CRM page (`frontend/app/(dashboard)/emails/page.tsx`) MUST replace its `useEffect` + manual fetch pattern with `useSWR`.

The page SHALL:
- Replace `fetch(/api/submissions)` with `useSWR("/api/submissions")` for the contacts list
- Replace `fetch(/api/labels/${slug})` with the global `useLabelData()` hook (from the Zustand/SWR label cache)
- Keep per-contact email log fetches (`/api/submissions/{id}/emails`) as on-demand `useSWR` calls triggered only when a contact is selected (using `useSWR(key, fetcher, { fallback: null })` with conditional key)

The page MUST maintain:
- localStorage fallback via `getCache("tp_crm_contacts")` as `fallbackData`
- Existing email composition, drag-and-drop variables, and send functionality
- Highlight-from-URL behavior (`?highlight=<id>`)

#### Scenario: CRM loads contacts from cache

- GIVEN a user visited CRM, navigated to inbox, then returns to CRM
- WHEN the CRM page remounts
- THEN `useSWR("/api/submissions")` returns cached contacts immediately
- AND background revalidation checks for new submissions
- AND no full-page loading spinner is shown

#### Scenario: Label data shared without refetch

- GIVEN the dashboard layout already fetched `/api/labels/{slug}`
- WHEN the CRM page mounts
- THEN it calls `useLabelData()` and receives cached label config
- AND no additional `/api/labels/{slug}` request is made

#### Scenario: Email logs loaded on demand

- GIVEN a contact list is displayed
- WHEN the user selects a contact
- THEN `useSWR(["/api/submissions", contactId, "emails"])` fires to load that contact's email history
- AND other contacts' email logs are NOT pre-fetched

---

### Requirement: Templates Page SWR Integration

The templates page (`frontend/app/(dashboard)/emails/templates/page.tsx`) MUST replace its sequential `fetchDefaultTemplates().then(() => fetchTemplates())` with parallel `useSWR` calls.

The page SHALL use two `useSWR` calls:
- `useSWR("/api/email/templates")` → user's custom templates
- `useSWR("/api/email/templates?defaults=true")` → hardcoded default templates (for restore comparison)

Both calls MUST fire in parallel (not sequential) since they are independent.

The page MUST maintain:
- Template CRUD operations (create, edit, delete) with SWR `mutate` for cache invalidation
- Restore-to-default functionality
- Loading states for initial render only (subsequent visits use cache)

#### Scenario: Templates load in parallel

- GIVEN the templates page mounts
- WHEN both SWR calls fire
- THEN `/api/email/templates` and `/api/email/templates?defaults=true` execute concurrently
- AND total load time is max(request_1, request_2), not sum
- AND loading state clears when both resolve

#### Scenario: Template created, cache invalidated

- GIVEN the user creates a new template via the form
- WHEN the POST `/api/email/templates` succeeds
- THEN `mutate("/api/email/templates")` is called to revalidate the templates list
- AND the new template appears in the list without a full page refresh

#### Scenario: Templates page revisited from cache

- GIVEN a user visited templates, navigated away, then returns
- WHEN the templates page remounts
- THEN SWR returns cached templates immediately
- AND background revalidation fetches fresh data
- AND no loading spinner blocks the UI

---

### Requirement: Cache Invalidation on Mutations

Any operation that modifies server-side data MUST invalidate the corresponding SWR cache key to ensure consistency.

The system SHALL:
- Call `mutate(key)` (revalidation trigger) after successful POST/PUT/DELETE operations
- Use optimistic updates with rollback for drag-and-drop status changes
- Revalidate dependent keys when related data changes (e.g., status change affects both source and destination column keys)

Invalidation points:
| Mutation | Keys to Invalidate |
|----------|-------------------|
| Submission status change (drag-drop) | Source column SWR key + destination column SWR key |
| Template create/edit/delete | `"/api/email/templates"` |
| Template restore to default | `"/api/email/templates"` + `"/api/email/templates?defaults=true"` |
| Label settings update | Label cache Zustand store + `"/api/labels/{slug}"` |

#### Scenario: Status change invalidates both columns

- GIVEN a submission is moved from "inbox" to "rejected"
- WHEN the backend PATCH succeeds
- THEN SWR revalidates both the inbox key and the rejected key
- AND the inbox column no longer shows the submission
- AND the rejected column shows the submission

#### Scenario: Optimistic update rolls back on error

- GIVEN a drag-and-drop optimistic update is applied
- WHEN the backend returns an error (e.g., 500)
- THEN SWR rolls back to the pre-mutation cached data
- AND the submission returns to its original column
- AND an error toast is displayed to the user

---

### Requirement: SSR Hydration Safety

All SWR usage MUST be safe for Next.js App Router with client components.

The system SHALL:
- Use `"use client"` directive on all components that call `useSWR`
- Provide `fallbackData` from localStorage where available to avoid flash of empty content
- NOT rely on SWR for initial SSR rendering (SWR is client-side only)
- Ensure no hydration mismatch between server-rendered HTML and client-hydrated state

#### Scenario: No hydration mismatch

- GIVEN the dashboard layout renders on the server
- WHEN the client hydrates
- THEN SWR-dependent sections show either `fallbackData` or a loading skeleton
- AND no React hydration mismatch warnings appear in the console

#### Scenario: localStorage fallback for instant hydration

- GIVEN a user has previously visited the inbox page
- WHEN the inbox page loads (cold start / hard refresh)
- THEN `getCache("tp_inbox_board")` provides fallbackData to SWR
- AND the board renders immediately with cached data
- AND SWR revalidates in the background

---

## Coverage Summary

- **Happy paths**: ✅ All covered (provider setup, label cache, inbox columns, CRM contacts, templates parallel load, cache invalidation, hydration safety)
- **Edge cases**: ✅ Covered (token refresh mid-session, pagination with load more, on-demand email logs, optimistic rollback)
- **Error states**: ✅ Covered (network failure with retry, backend error rollback, stale cache fallback)

---

## Next Step

Ready for design (sdd-design) to define: SWRConfig provider structure, authenticated fetcher implementation, Zustand store shape, useSWR key conventions, optimistic update patterns, and migration strategy per page.
