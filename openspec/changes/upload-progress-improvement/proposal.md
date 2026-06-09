# Proposal: Upload and Analysis Flow Improvement

## Intent
The current demo submission flow takes 3-5 minutes, during which the progress bar freezes for long periods (up to 30s), leading to a poor user experience. Backend bottlenecks, synchronous event loop blocking, and sequential cloud uploads contribute to this delay. This change aims to provide continuous, granular progress to the user and reduce overall processing time by offloading the initial upload to the client and parallelizing backend tasks.

## Scope

### In Scope
- Implement presigned R2 uploads directly from the frontend (bypassing Next.js/Oracle proxy for the initial file transfer).
- Update frontend to display native, granular upload progress for the R2 upload.
- Replace `subprocess.run` with `asyncio.create_subprocess_exec` in the FFmpeg MP3 conversion to prevent blocking the event loop.
- Parse FFmpeg `stderr` output to stream granular conversion progress via SSE.
- Parallelize R2 uploads (MP3 and JSON) using `asyncio.gather`.
- Stream the original file from R2 to the backend `/tmp` with progress reporting.

### Out of Scope
- Refactoring the core audio analysis logic (BPM, LUFS, Phase).
- Moving from Server-Sent Events (SSE) to WebSockets.
- Modifying the existing frontend i18n system or overall UI layout.

## Capabilities

### New Capabilities
- `direct-s3-upload`: Generating presigned URLs and handling direct-to-cloud client uploads.

### Modified Capabilities
- `audio-analysis-pipeline`: Modifying the pipeline to download from R2, run async FFmpeg, parse progress, and upload results concurrently.
- `demo-submission`: Updating the frontend to handle presigned uploads and render granular SSE progress events without breaking i18n.

## Approach
1. **Frontend Upload**: Instead of POSTing `FormData` to `/api/upload`, the frontend will first request a presigned R2 PUT URL from the backend.
2. **Direct to R2**: The frontend uploads the file directly to R2 using `XMLHttpRequest` to capture real-time upload progress.
3. **Trigger Pipeline**: Once uploaded, the frontend calls `POST /api/analyze` with the R2 key. This endpoint returns the SSE stream.
4. **Backend Download**: The backend streams the file from R2 to `/tmp`, yielding download progress via SSE to mitigate the perceived delay before `librosa` loads it.
5. **Async FFmpeg**: MP3 conversion will use `asyncio.create_subprocess_exec`. The backend will read FFmpeg's `stderr` asynchronously, parse the `time=XX:XX:XX` output, calculate percentage based on track duration, and yield granular SSE progress.
6. **Parallel Uploads**: After conversion, the MP3 and JSON files are uploaded to R2 concurrently using `asyncio.gather()`. The original file is already on R2 and does not need to be re-uploaded.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `frontend/app/s/[slug]/page.tsx` | Modified | Split upload into presigned URL fetch + direct S3 upload + SSE analysis trigger. |
| `backend/app/api/upload.py` | Modified | Add endpoint for presigned URLs. Refactor SSE endpoint to accept R2 key instead of file payload. |
| `backend/app/audio/lifecycle.py` | Modified | Remove original WAV upload. Parallelize MP3/JSON uploads. Add streaming R2 download step. |
| `backend/app/audio/converter.py` | Modified | Switch to `asyncio.create_subprocess_exec` and add progress callback/yield. |
| `backend/app/services/r2.py` | Modified | Add `generate_presigned_url` and streaming download functions. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Presigned upload CORS issues | Medium | Ensure Cloudflare R2 CORS rules are correctly configured for the frontend domains. |
| FFmpeg stderr parsing breaks | Low | Use robust regex for `time=` and fallback to stage-level progress if parsing fails. |
| R2 download adds processing time | Low | Oracle VPS to Cloudflare R2 is typically very fast. Streaming download offsets perceived delay. |

## Rollback Plan
Keep the old `/api/upload` endpoint and frontend logic intact but unused. If presigned uploads or async FFmpeg fail in production, we can quickly revert the frontend to hit the old synchronous `/api/upload` endpoint and bypass the new pipeline.

## Dependencies
- Cloudflare R2 bucket must have appropriate CORS configuration to accept PUT requests from the frontend domain.
- `boto3` support for generating presigned URLs.

## Success Criteria
- [ ] Upload progress bar reflects actual network upload speed natively on the client.
- [ ] No progress bar freezes > 3 seconds during the entire flow.
- [ ] MP3 conversion step shows smooth sub-progress (e.g., 0-100% of the conversion phase).
- [ ] Event loop is not blocked by FFmpeg `subprocess.run()`.
- [ ] R2 MP3 and JSON uploads execute concurrently.