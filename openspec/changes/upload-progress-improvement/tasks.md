# Tasks: Upload Progress Improvement

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 450-550 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

## Phase 1: Foundation — R2 Service

- [x] 1.1 Add `generate_presigned_url()` to `backend/app/services/r2.py` with 15min expiry and content-type enforcement
- [x] 1.2 Add `download_file_with_progress()` to `backend/app/services/r2.py` using boto3 Callback + asyncio.to_thread

## Phase 2: Core Backend

- [x] 2.1 Add `POST /api/presigned-url` route in `backend/app/api/upload.py` returning upload_url, r2_key, submission_id
- [x] 2.2 Refactor `POST /api/upload` in `backend/app/api/upload.py` to accept r2_key and emit SSE events instead of multipart
- [x] 2.3 Rewrite `convert_to_mp3()` in `backend/app/audio/converter.py` as async with asyncio.create_subprocess_exec + stderr progress parsing
- [x] 2.4 Refactor `process_submission()` in `backend/app/audio/lifecycle.py` to download from R2, pass duration to converter, parallel uploads, skip original

## Phase 3: Frontend Wiring

- [x] 3.1 Update `frontend/app/s/[slug]/page.tsx` with three-phase flow: presigned URL fetch → XHR PUT with onprogress → POST /api/analyze SSE
- [x] 3.2 Add fallback in frontend to legacy POST /api/upload if direct R2 upload fails

## Phase 4: Testing

- [x] 4.1 Unit test: presigned URL generation with correct bucket/key/expiry in r2.py
- [x] 4.2 Unit test: FFmpeg stderr parsing extracts time= and computes sub_pct correctly
- [x] 4.3 Unit test: async converter timeout raises ConversionError and cleans up partial output
- [x] 4.4 Integration test: three-phase flow with mocked R2 returns correct SSE events
