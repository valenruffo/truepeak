# Design: Upload Progress Improvement

## Technical Approach

We are refactoring the file upload flow from a monolithic multipart POST to a three-phase presigned R2 upload architecture. This enables real progress tracking for the upload phase (via XHR) and provides sub-progress granularity for large backend operations (download, ffmpeg, parallel uploads) using SSE.

## Architecture Decisions

### Decision: Presigned URL Upload vs Multipart
**Choice**: Three-phase frontend flow: presigned URL -> direct XHR upload to R2 -> SSE analysis.
**Alternatives considered**: WebSocket upload, chunked uploads via backend.
**Rationale**: Direct R2 upload removes the backend bottleneck, avoids dropping large connections, and allows accurate 0-100% upload progress natively in the browser via `XMLHttpRequest.upload.onprogress`.

### Decision: Async FFmpeg with Stderr Parsing
**Choice**: Replace synchronous `subprocess.run` with `asyncio.create_subprocess_exec` and parse FFmpeg's `stderr` for `time=HH:MM:SS` to calculate sub-progress.
**Alternatives considered**: Using `ffmpeg-python` with progress sockets.
**Rationale**: Standard subprocess parsing is lightweight, requires no extra dependencies, and integrates easily with our custom SSE progress generator.

### Decision: Parallel R2 Uploads
**Choice**: Use `asyncio.gather()` to upload the generated MP3 preview and JSON peaks concurrently.
**Alternatives considered**: Sequential uploads.
**Rationale**: Since the original file is already in R2 from the direct upload, we only need to upload the generated assets. Doing so in parallel saves wall-clock time and improves the user experience at the end of the pipeline.

## Data Flow

    Frontend ──(1) POST /api/presigned-url ──→ Backend
         │                                       │
    (2) XHR PUT to R2 (Upload Progress)          │
         │                                       │
         └─(3) POST /api/analyze ───────────────→ Backend
                                                 │
      R2 ◄──(4) Streaming Download (SSE) ────────┘
                                                 │
           (5) Analyze & Async FFmpeg (SSE) ─────┤
                                                 │
      R2 ◄──(6) Parallel Uploads (MP3/JSON) ─────┘
                                                 │
    Frontend ◄──(7) SSE Completion Event ────────┘

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/app/api/upload.py` | Modify | Add `POST /presigned-url` endpoint for R2 URLs. Change `POST /upload` (or new `/analyze`) to accept `r2_key` and stream SSE events instead of receiving multipart files. |
| `backend/app/audio/lifecycle.py` | Modify | Add R2 streaming download step. Change FFmpeg call to pass duration. Replace sequential MP3/Peaks uploads with `asyncio.gather()`. Skip original file upload. |
| `backend/app/audio/converter.py` | Modify | Make `convert_to_mp3` async. Use `asyncio.create_subprocess_exec`. Parse stderr for `time=` to yield `sub_pct` progress. |
| `backend/app/services/r2.py` | Modify | Add `generate_presigned_url`. Add `download_file_with_progress` using boto3 `Callback` and `asyncio.to_thread`. |
| `frontend/app/s/[slug]/page.tsx` | Modify | Implement 3-phase flow: fetch presigned URL, XHR PUT with `onprogress` for accurate 0-50% bar, then fetch `/api/analyze` and consume SSE for 50-100%. |

## Interfaces / Contracts

### POST /api/presigned-url
**Request**:
```json
{
  "label_slug": "string",
  "filename": "string",
  "content_type": "string",
  "file_size": 123456
}
```
**Response**:
```json
{
  "upload_url": "https://...",
  "r2_key": "tracks/UUID/original.wav",
  "submission_id": "UUID"
}
```

### POST /api/analyze (Multipart or JSON)
**Request**:
Passes `r2_key`, `submission_id`, `producer_name`, `track_name`, etc.
**Response**: SSE stream `text/event-stream`
```json
// SSE Data format
{"stage": "Descargando original...", "pct": 55, "sub_pct": 30}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | FFmpeg stderr parsing | Mock `stderr.readline()` with regex matches to ensure `sub_pct` is computed correctly. |
| Unit | Boto3 presigned URLs | Mock `s3_client.generate_presigned_url` to ensure correct bucket/key arguments. |
| Integration | 3-Phase Upload Flow | API test requesting presigned URL, mocking R2 PUT, then calling `/analyze` and validating SSE stream. |

## Migration / Rollout

No database schema migration is required. Ensure Cloudflare R2 CORS settings allow `PUT` from the frontend domain to enable direct browser uploads.

## Open Questions

- [ ] Will the Cloudflare R2 CORS policy need explicit `Expose-Headers` for any specific ETag checks?
