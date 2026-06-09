# Upload Progress Improvement — Delta Specs

## Change: upload-progress-improvement

---

## ADDED Requirements

### Requirement: Presigned URL Generation

The system MUST provide an endpoint `POST /api/presigned-url` that generates a presigned PUT URL for direct R2 upload.

The endpoint SHALL accept:
- `filename` (string, required)
- `content_type` (string, required)
- `label_slug` (string, required)
- `file_size` (integer, required)

The endpoint SHALL return:
- `upload_url` (string): presigned PUT URL valid for 15 minutes
- `r2_key` (string): the R2 object key where the file will be stored
- `submission_id` (string): UUID for tracking

The presigned URL MUST enforce:
- Content-Type matching the requested type
- File size limit from label's sonic_signature (max 200MB)
- 15-minute expiration

#### Scenario: Valid presigned URL request

- GIVEN a valid label_slug with active subscription
- WHEN frontend requests presigned URL with filename="track.wav", content_type="audio/wav", file_size=50000000
- THEN system returns upload_url, r2_key="tracks/{submission_id}/original.wav", and submission_id
- AND the presigned URL accepts PUT requests with the specified Content-Type

#### Scenario: Presigned URL rejects oversized file

- GIVEN a label with max_upload_size_mb=100
- WHEN frontend requests presigned URL with file_size=250000000 (250MB)
- THEN system returns HTTP 413 with error message about size limit

#### Scenario: Presigned URL expires

- GIVEN a presigned URL was generated 16 minutes ago
- WHEN frontend attempts to upload using that URL
- THEN R2 returns HTTP 403 AccessDenied

---

### Requirement: Direct R2 Upload with Progress

The frontend MUST upload audio files directly to R2 using the presigned PUT URL with XMLHttpRequest to capture native upload progress.

The upload SHALL:
- Use PUT method (not POST)
- Set Content-Type header matching the presigned URL
- Track upload progress via XHR `upload.onprogress` event
- Report real-time percentage (0-100%) based on bytes sent / total bytes

The frontend MUST NOT send file data to the backend during this phase.

#### Scenario: Successful direct upload with progress

- GIVEN frontend has received presigned URL for a 50MB WAV file
- WHEN user submits the form
- THEN frontend uploads directly to R2 via XHR PUT
- AND progress bar updates from 0% to 100% reflecting actual network speed
- AND upload completes in ~10-30 seconds (depending on user's upload bandwidth)

#### Scenario: Upload fails with network error

- GIVEN frontend is uploading to R2
- WHEN network connection drops mid-upload
- THEN XHR `onerror` fires
- AND frontend displays user-friendly error message
- AND no partial data remains in R2 (R2 atomic PUT)

---

### Requirement: Async FFmpeg Conversion with Progress Parsing

The system MUST replace `subprocess.run` with `asyncio.create_subprocess_exec` for MP3 conversion to prevent blocking the event loop.

The conversion SHALL:
- Parse FFmpeg stderr output in real-time
- Extract `time=HH:MM:SS` progress marker using regex
- Calculate percentage based on track duration (from metadata or analysis)
- Yield progress events via callback: `on_progress("Convirtiendo a MP3...", sub_pct)`

The conversion MUST NOT block the asyncio event loop for >100ms at a time.

#### Scenario: Async FFmpeg with smooth progress

- GIVEN a 5-minute WAV file (300 seconds duration)
- WHEN async FFmpeg conversion starts
- THEN system parses stderr and yields progress events
- AND progress advances smoothly from 0% to 100% over the conversion duration
- AND event loop remains responsive (no freezes >100ms)

#### Scenario: FFmpeg stderr parsing fallback

- GIVEN FFmpeg output does not match expected `time=` pattern
- WHEN conversion is in progress
- THEN system falls back to stage-level progress (0% at start, 100% at end)
- AND conversion still completes successfully

#### Scenario: FFmpeg conversion timeout

- GIVEN a corrupted or extremely large audio file
- WHEN FFmpeg runs for >60 seconds
- THEN system raises ConversionError with timeout message
- AND partial output file is cleaned up

---

### Requirement: Parallel R2 Uploads

The system MUST upload MP3 and waveform JSON to R2 concurrently using `asyncio.gather()`.

The uploads SHALL:
- Execute in parallel (not sequential)
- Report combined progress (e.g., 50% when one completes, 100% when both complete)
- Fail fast: if either upload fails, cancel the other

The original WAV file is already on R2 (uploaded directly by frontend) and MUST NOT be re-uploaded.

#### Scenario: Parallel MP3 and JSON upload

- GIVEN MP3 conversion completed successfully
- WHEN system uploads preview.mp3 and waveform.json to R2
- THEN both uploads execute concurrently via asyncio.gather()
- AND total upload time is max(mp3_time, json_time), not sum
- AND progress advances from 60% to 80% during this phase

#### Scenario: One upload fails

- GIVEN parallel uploads are in progress
- WHEN MP3 upload succeeds but JSON upload fails (network error)
- THEN system raises RuntimeError
- AND MP3 file is cleaned up from R2 (rollback)
- AND user receives error message

---

### Requirement: Streaming R2 Download with Progress

The backend MUST stream the original file from R2 to `/tmp` with progress reporting via SSE.

The download SHALL:
- Use boto3 `download_file` with Callback for progress tracking
- Report progress every 5% increment (or every 1MB for large files)
- Yield SSE events: `{"stage": "Descargando original...", "pct": 15}`

The download MUST NOT block the event loop (run in thread pool).

#### Scenario: Streaming download with progress

- GIVEN frontend triggered analysis with r2_key
- WHEN backend downloads 100MB WAV from R2 to /tmp
- THEN system yields SSE progress events: 5%, 10%, 15% ... 100%
- AND progress bar advances smoothly during download phase
- AND download completes in ~2-5 seconds (Oracle VPS to Cloudflare R2)

#### Scenario: Download fails

- GIVEN R2 is temporarily unavailable
- WHEN backend attempts to download the file
- THEN system raises RuntimeError after 3 retries
- AND user receives error message via SSE: `{"error": "Failed to download original file"}`

---

## MODIFIED Requirements

### Requirement: Demo Submission Flow

The frontend submission flow MUST be refactored from a single POST with FormData to a three-phase process: (1) request presigned URL, (2) direct R2 upload with native progress, (3) trigger analysis via POST with r2_key.

The flow SHALL:
- Phase 1: POST `/api/presigned-url` → receive upload_url, r2_key, submission_id
- Phase 2: XHR PUT to upload_url with file data → track native progress 0-50%
- Phase 3: POST `/api/analyze` with `{r2_key, submission_id, metadata}` → receive SSE stream for 50-100%

The frontend MUST maintain backward compatibility: if presigned upload fails, fall back to old `/api/upload` endpoint (but log warning).

(Previously: Single POST to `/api/upload` with FormData, backend handled entire upload + analysis, progress was simulated with timers.)

#### Scenario: New three-phase submission flow

- GIVEN user selects a 50MB WAV file and fills metadata
- WHEN user clicks "Submit"
- THEN Phase 1: frontend requests presigned URL (200ms)
- AND Phase 2: frontend uploads directly to R2 with XHR progress (10-30s, real network speed)
- AND Phase 3: frontend triggers analysis, receives SSE stream for download/convert/upload phases (15-30s)
- AND total time is ~30-60 seconds with continuous progress (no freezes >3s)

#### Scenario: Presigned upload fails, fallback to legacy

- GIVEN presigned URL generation succeeds
- WHEN direct R2 upload fails (CORS error, network issue)
- THEN frontend logs warning to console
- AND frontend falls back to old POST `/api/upload` with FormData
- AND user sees legacy progress animation (simulated)
- AND submission completes successfully

#### Scenario: SSE stream provides granular progress

- GIVEN analysis is running via SSE
- WHEN backend downloads from R2, converts to MP3, uploads results
- THEN SSE events include sub-progress: `{"stage": "Descargando original...", "pct": 52}`, `{"stage": "Convirtiendo a MP3...", "pct": 65}`, etc.
- AND frontend progress bar advances smoothly from 50% to 100%
- AND no stage lasts >5 seconds without progress update

---

### Requirement: Audio Analysis Pipeline

The `process_submission` function in `lifecycle.py` MUST be refactored to:
1. Accept `r2_key` instead of `file_path` (file is already on R2)
2. Download file from R2 to `/tmp` with progress callback
3. Run async FFmpeg conversion with progress parsing
4. Upload MP3 and JSON to R2 in parallel (not sequential)
5. Skip original WAV upload (already on R2 from frontend)

The pipeline SHALL maintain the same output structure and DB persistence logic.

(Previously: Accepted local file_path, uploaded original WAV to R2 sequentially, ran sync FFmpeg, uploaded MP3 and JSON sequentially.)

#### Scenario: Pipeline with R2 download and async FFmpeg

- GIVEN r2_key="tracks/abc123/original.wav" on R2
- WHEN process_submission is called
- THEN system downloads file from R2 to /tmp/abc123.wav with progress events
- AND system runs async FFmpeg conversion with stderr parsing
- AND system uploads preview.mp3 and waveform.json in parallel
- AND system cleans up local /tmp files
- AND returns same result structure as before

#### Scenario: Pipeline skips original upload

- GIVEN file was uploaded directly to R2 by frontend
- WHEN process_submission runs
- THEN system does NOT call `upload_file_to_r2` for the original WAV
- AND system only uploads preview.mp3 and waveform.json
- AND total R2 upload time is reduced by ~33%

---

## REMOVED Requirements

### Requirement: Synchronous FFmpeg Subprocess

(Reason: Replaced by async FFmpeg with progress parsing to prevent event loop blocking and provide granular progress.)
(Migration: `convert_to_mp3` function is replaced by `convert_to_mp3_async` with progress callback. Old function is deleted.)

---

### Requirement: Sequential R2 Uploads in Lifecycle

(Reason: Replaced by parallel uploads via asyncio.gather() to reduce total processing time.)
(Migration: Sequential `await upload_file_to_r2(...)` calls are replaced by `await asyncio.gather(upload_mp3(), upload_json())`.)

---

## RENAMED Requirements

### Requirement: `/api/upload` Endpoint → `/api/analyze` Endpoint

(Reason: The endpoint no longer accepts file uploads; it accepts an R2 key and triggers analysis. File upload is handled by presigned URL directly to R2.)
(Migration: Frontend must update to call `/api/presigned-url` first, then `/api/analyze` with r2_key. Old `/api/upload` endpoint is kept for fallback but marked deprecated.)

---

## Coverage Summary

- **Happy paths**: ✅ All covered (presigned URL generation, direct upload, async FFmpeg, parallel uploads, streaming download, three-phase flow)
- **Edge cases**: ✅ Covered (upload failures, FFmpeg parsing fallback, timeout, CORS errors, network drops)
- **Error states**: ✅ Covered (oversized files, expired URLs, R2 unavailability, conversion failures, partial upload rollback)

---

## Next Step

Ready for design (sdd-design) to define the technical implementation: presigned URL generation logic, async FFmpeg stderr parsing regex, asyncio.gather() structure, XHR progress tracking, SSE event format.
