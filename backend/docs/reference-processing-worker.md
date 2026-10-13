# Reference processing worker

This internal seam processes a claim already authorized by a trusted caller. The immutable claim
receipt describes one attempt; it is not external authorization.

## Contract

- The caller constructs and supplies the bounded provider; the worker does not configure a model.
- The reader receives the claimed label, reference, upload, and final ETag for exact-object reading.
- Original reading and inference run outside service sessions and database transactions.
- Success uses the existing atomic publication transaction to store the embedding and mark the
  exact active claim READY.
- Read or inference errors attempt failure completion once with the same receipt. The original
  error remains raised; a failure-completion conflict or error is chained as evidence.
- Publication errors never trigger failure completion because the database commit may be ambiguous.
- The worker does not authorize, claim, retry, resume, poll, or automatically overwrite a claim.

## Production wiring (finalize-triggered processing)

Finalizing an upload now schedules the fenced worker as an in-process FastAPI background task
(`app/services/reference_worker_runtime.py`). The finalize response returns immediately; processing
runs after the response. The claim is the fence: conflicts are logged and skipped, and the original
finalize response schema is unchanged.

| Topic | Decision |
| --- | --- |
| Execution model | Background task inside the single API container; no queue or separate worker process. |
| First-upload cost | The first upload per process pays the OpenL3/TensorFlow load (about 90s); later uploads reuse the cached provider. |
| Bounds (numbers) | `LABEL_REFERENCE_MAX_DECODED_FRAMES` (default `8640000` = 180s at 48kHz), `LABEL_REFERENCE_MAX_DECODED_CHANNELS` (default `2`). |
| R2 config (strings/booleans) | `LABEL_REFERENCE_R2_*` plus `LABEL_REFERENCE_R2_PRIVATE_ACCESS_CONFIRMED` (`true`/`1`) via the existing R2 factories. |
| Failure semantics | At-least-once is NOT provided and there is no automatic retry: read/inference failures land the reference in `failed`; publication errors never fail-complete. Manual resume uses the existing resumption service. |
| Misconfiguration | Runtime construction errors are logged and processing is skipped; the finalize response still succeeds. |
| Pipeline version | `LABEL_DNA_OPENL3_V1`. |
