# Proposal: Add SWR Caching to Frontend Dashboard

## Intent

Eliminate redundant network requests and repeated loading states across dashboard pages by introducing a client-side caching layer, improving perceived performance and reducing backend load.

## Scope

### In Scope
- Install `@vercel/swr`
- Create centralized SWR fetcher with auth injection
- Create global Zustand store for label data
- Refactor Inbox, CRM, and Templates pages to use `useSWR`
- Configure global SWR settings (deduping, stale time, no focus revalidation)

### Out of Scope
- Backend API modifications
- Pagination logic changes

## Capabilities

### New Capabilities
- `frontend-caching`: Client-side caching, request deduplication, and stale-while-revalidate data fetching behavior.

### Modified Capabilities
- None

## Approach

Introduce `@vercel/swr` globally. Create a generic authenticated fetcher in `frontend/lib/swr-config.ts`. Combine SWR with a new Zustand store to cache `/api/labels/{slug}` globally for use across the layout and sub-pages. Refactor individual dashboard pages (Inbox, CRM, Templates) to swap `useEffect`/raw fetches with `useSWR`, minimizing boilerplate and deduplicating identical requests.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `frontend/package.json` | Modified | Add `swr` dependency |
| `frontend/lib/swr-config.ts` | New | SWR global provider and fetcher |
| `frontend/store/` | Modified | Add/update Zustand store for label caching |
| `frontend/app/(dashboard)/layout.tsx` | Modified | Use global label cache |
| `frontend/app/(dashboard)/inbox/page.tsx` | Modified | Replace manual fetch with `useSWR` |
| `frontend/app/(dashboard)/emails/page.tsx` | Modified | Replace manual fetch with `useSWR` |
| `frontend/app/(dashboard)/emails/templates/page.tsx`| Modified | Replace manual fetch with `useSWR` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Stale data shown to user | Low | Configure `staleTime` and revalidation intervals appropriately (e.g., 30s) |
| SSR hydration mismatch | Low | Use SWR fallback or ensure client-side only fetching where appropriate |
| i18n breakage | Low | Ensure fetcher maintains i18n context/headers |

## Rollback Plan

Revert the commits introducing SWR, restoring `useEffect`-based fetching in the dashboard pages and removing the `swr` dependency.

## Dependencies

- `@vercel/swr` npm package

## Success Criteria

- [ ] Navigating between Inbox, CRM, and Templates does not trigger full loading spinners for already fetched data.
- [ ] Network tab shows `304 Not Modified` or no new requests for identical data within the deduping interval.
- [ ] `/api/labels/{slug}` is fetched exactly once per session/revalidation period, not 4+ times concurrently.