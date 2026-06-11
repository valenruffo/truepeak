# Tasks: seo-optimization

## Phase 1: Backend API Development
- [x] 1.1 Create `backend/tests/test_labels_public.py` to test the new public slugs endpoint (frozen filter, empty results handling).
- [x] 1.2 Implement route `GET /api/labels/public/slugs` in `backend/app/api/labels.py` to retrieve non-frozen label slugs.
- [x] 1.3 Run `$env:POSTGRES_URL="postgresql://localhost/dummy"; python -m pytest` inside `backend/` to verify tests pass successfully.

## Phase 2: Frontend Robots & Sitemap
- [x] 2.1 Create `frontend/app/robots.ts` to expose `robots.txt` configuration, disallowing `/crm`, `/inbox`, and `/config`.
- [x] 2.2 Create `frontend/app/sitemap.ts` to dynamically fetch public slugs and output static + dynamic sitemap entries.
- [x] 2.3 Run typecheck `npx.cmd tsc --noEmit` in `frontend/` to verify robots and sitemap TypeScript compilation.

## Phase 3: Metadata & Static Page Updates
- [x] 3.1 Update layout metadata base, openGraph, twitter, and keywords fields in `frontend/app/layout.tsx`.
- [x] 3.2 Add page-specific metadata exports to `frontend/app/privacy-policy/page.tsx`.
- [x] 3.3 Add page-specific metadata exports to `frontend/app/refund-policy/page.tsx`.
- [x] 3.4 Add page-specific metadata exports to `frontend/app/terms-of-service/page.tsx`.
- [x] 3.5 Run `npm run build` in `frontend/` to confirm that the static production build succeeds without issues.

## Phase 4: Discovery Files for LLM & AI Bots
- [x] 4.1 Create `frontend/public/llms.txt` detailing project features, stack, and API endpoints for AI consumption.
- [x] 4.2 Create `frontend/public/pricing.md` describing Free, Indie ($29/mo), and Pro ($79/mo) plans, features, and limits.

---

### Review Workload Forecast
- **Estimated Lines of Code Changed**: ~150 lines
- **400-Line Budget Risk**: Low
- **Chained PRs Recommended**: No
- **Delivery Strategy**: single-pr
