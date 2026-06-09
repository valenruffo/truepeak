# Design: SWR Caching Implementation

## Technical Approach

Introduce SWR (`swr`) to the frontend dashboard to replace manual `useEffect` fetches and custom `getCache`/`setCache` utilities. This change will standardise data fetching, provide out-of-the-box stale-while-revalidate capabilities, and reduce boilerplate. We will wrap the dashboard in a global `SWRConfig` provider with an authenticated fetcher. For cross-component state that isn't purely API-driven (like the current active label data), we will sync SWR responses into a Zustand store. 

## Architecture Decisions

### Decision: Authenticated SWR Fetcher
**Choice**: Create a custom fetcher in `frontend/lib/swr-config.ts` that retrieves the JWT from `localStorage` (or Supabase session) and attaches it to the `Authorization` header.
**Alternatives considered**: Relying on the existing global `window.fetch` interceptor in `layout.tsx`.
**Rationale**: Explicitly defining the auth headers in the SWR fetcher makes the data layer decoupled from the layout lifecycle, ensuring no race conditions occur when components mount and immediately trigger SWR fetches.

### Decision: Dashboard SWRConfig
**Choice**: Wrap `frontend/app/(dashboard)/layout.tsx` in a new client component `<SWRProvider>` containing the `SWRConfig`.
**Alternatives considered**: Wrapping the root layout.
**Rationale**: SWR caching with auth is only relevant for the authenticated dashboard. We configure global options here (`revalidateOnFocus: false`, `dedupingInterval: 5000`) to prevent aggressive refetching during typical dashboard tab-switching.

### Decision: Zustand Label Store Integration
**Choice**: Create `frontend/store/label.ts` containing the label data state. Components will fetch label data via `useSWR('/api/labels/{slug}')`, and an effect will sync the result to Zustand (`useLabelStore.getState().setLabel(data)`).
**Alternatives considered**: Moving the fetch logic entirely into Zustand, or dropping Zustand and exclusively using SWR.
**Rationale**: Zustand provides a synchronous, easily accessible global state for non-fetching components (and outside React context if needed), while SWR handles the actual network request, caching, and deduplication perfectly.

### Decision: Inbox Refactor (5 calls vs 1 consolidated)
**Choice**: Use 5 separate `useSWRInfinite` calls for the Inbox columns (inbox, shortlist, rejected, system, trash).
**Alternatives considered**: A single `/api/submissions?status=all` endpoint.
**Rationale**: The Kanban columns require independent offset-based pagination. Consolidating the endpoint would break or severely complicate the infinite scrolling logic for individual columns.

## Data Flow

    Component (Inbox/CRM) ──→ useSWR / useSWRInfinite
                                 │
                            SWR Cache (Memory)
                                 │ (cache miss / stale)
                            SWR Fetcher (injects JWT)
                                 │
                                API
                                 │
    SWR Hook ─────────(Sync)──→ Zustand Label Store ──→ Other UI Components

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `frontend/lib/swr-config.ts` | Create | Contains the `fetcher` implementation and `SWRProvider` wrapper component. |
| `frontend/store/label.ts` | Create | Zustand store defining `LabelState` and `setLabel` action. |
| `frontend/app/(dashboard)/layout.tsx` | Modify | Wrap children with `<SWRProvider>`, refactor `fetchLabel` to use `useSWR` and sync with Zustand. |
| `frontend/app/(dashboard)/inbox/page.tsx` | Modify | Replace `fetchColumn` and `getCache` with 5 `useSWRInfinite` hooks. Handle `isValidating` for background indicators. |
| `frontend/app/(dashboard)/emails/page.tsx` | Modify | Replace `useEffect` fetching for submissions with `useSWR('/api/submissions')`. |
| `frontend/app/(dashboard)/emails/templates/page.tsx` | Modify | Replace manual fetches with 2 `useSWR` calls (`/api/email/templates` and `/api/email/templates?defaults=true`). |

## Cache Keys

- **Inbox Columns**: `(pageIndex, previousPageData) => previousPageData && !previousPageData.length ? null : \`/api/submissions?status={status}&offset=\${pageIndex * 20}&limit=20\``
- **CRM List**: `'/api/submissions'` (No pagination currently used on CRM)
- **Label Config**: `'/api/labels/{slug}'`
- **Templates**: `'/api/email/templates'`
- **Default Templates**: `'/api/email/templates?defaults=true'`

## Interfaces / Contracts

```typescript
// frontend/lib/swr-config.ts
export const fetcher = async (url: string) => {
  const token = localStorage.getItem("token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const error: any = new Error("An error occurred while fetching the data.");
    error.info = await res.json().catch(() => ({}));
    error.status = res.status;
    throw error;
  }
  return res.json();
};
```

```typescript
// frontend/store/label.ts
import { create } from 'zustand';

interface LabelState {
  labelData: any | null;
  setLabelData: (data: any) => void;
}

export const useLabelStore = create<LabelState>((set) => ({
  labelData: null,
  setLabelData: (data) => set({ labelData: data }),
}));
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integration | Inbox Data Loading | Verify that columns still load data and infinite scroll works correctly via `useSWRInfinite` (mocking API responses). |
| Integration | Token Injection | Ensure that `fetcher` correctly extracts `localStorage.getItem('token')` and appends it to requests. |
| E2E | Dashboard Navigation | Verify that switching between Inbox and CRM uses the SWR cache (`dedupingInterval`) and does not trigger redundant network waterfalls. |

## Migration / Rollout

- **Package Install**: `npm install swr`
- **Cleanup**: Remove `getCache` and `setCache` usages for `tp_inbox_board`, `tp_inbox_system`, `tp_inbox_trash`, and `tp_crm_contacts` in favour of SWR's native memory cache.
- No database migrations are required.

## Open Questions

- [ ] Will SWR's memory cache be sufficient to replace `getCache`/`setCache` (which might be hitting localStorage), or do we specifically need localStorage persistence between hard reloads? (Assuming memory cache is sufficient for SWR standard).
- [ ] For Inbox drag-and-drop optimistic updates, SWR's `mutate` function will need to be correctly scoped to the multi-page structure of `useSWRInfinite`.