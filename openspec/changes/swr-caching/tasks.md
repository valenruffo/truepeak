# Tasks: SWR Caching

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 400-550 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

## Phase 1: Foundation

- [x] 1.1 Install `swr` package in `frontend/package.json`
- [x] 1.2 Create `frontend/lib/swr-config.tsx` — `fetcher` reads JWT from localStorage, injects `Authorization: Bearer`, throws typed errors
- [x] 1.3 Create `frontend/store/label.ts` — Zustand store with `labelData` + `setLabelData` for cross-component label cache

## Phase 2: Dashboard Wiring

- [x] 2.1 Create `<SWRProvider>` component in `swr-config.tsx` with `SWRConfig` (revalidateOnFocus:false, dedupingInterval:5000, shouldRetryOnError:true)
- [x] 2.2 Wrap `frontend/app/(dashboard)/layout.tsx` children with `<SWRProvider>`
- [x] 2.3 Refactor `fetchLabel` in layout to `useSWR('/api/labels/{slug}')` synced to Zustand store; remove inline fetch

## Phase 3: Inbox Refactor

- [x] 3.1 Replace `fetchColumn`/`fetchSystem`/`fetchTrash` + `useEffect` loads with 5 `useSWRInfinite` calls (inbox, shortlist, rejected, auto_rejected, trash)
- [x] 3.2 Wire drag-drop `updateStatus` to call `mutate()` on source + destination column keys with optimistic update + rollback
- [x] 3.3 Remove `getCache`/`setCache` imports and localStorage persistence for inbox board data

## Phase 4: CRM & Templates Refactor

- [ ] 4.1 Replace `fetchData` useEffect in `frontend/app/(dashboard)/emails/page.tsx` with `useSWR('/api/submissions')` + conditional `useSWR` for email logs on contact select; remove `getCache`/`setCache`
- [ ] 4.2 Replace sequential fetches in `frontend/app/(dashboard)/emails/templates/page.tsx` with parallel `useSWR('/api/email/templates')` + `useSWR('/api/email/templates?defaults=true')`
- [ ] 4.3 Add `mutate()` calls after template CRUD operations (create/edit/delete/restore) for cache invalidation

## Phase 5: Verification

- [ ] 5.1 Verify no duplicate `/api/labels/{slug}` requests across page navigations
- [ ] 5.2 Verify inbox columns load correctly with `useSWRInfinite` and infinite scroll works
- [ ] 5.3 Verify drag-drop optimistic updates roll back on API error
- [ ] 5.4 Verify templates load in parallel with no waterfall
- [ ] 5.5 Run `npm run build` — confirm no TypeScript or lint errors
