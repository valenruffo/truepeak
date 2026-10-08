# AI A&R pivot: integrated rollout guidance

**Everything below is rollout GUIDANCE, not proof.** The live gates in this
document are PENDING and human-scheduled. All automated evidence produced so
far is SQLite service-level; nothing here claims production verification.

## Purpose

This document collects, in one place, the ordered manual steps for rolling out
the Label DNA / AI A&R pivot units: migrations 009 through 013, their
environment variables, the flag-gated endpoints, and the three live gates that
must pass before any production enablement. It is a sibling of
`label-dna-storage.md`, which covers the storage unit in depth.

## Ordered migration steps (009 -> 013)

Run every migration through a client configured to stop on the first SQL error
(for `psql`, `-v ON_ERROR_STOP=1`), executing the entire file in one session.
Each file owns an explicit transaction and fails closed on partial or repeated
deployment; never use an autocommit-per-statement runner, and stop at the
first error for manual review. The deployed state is unknown; do not infer it
from source files. Each step requires the previous one.

### 009_label_dna_storage.sql

One-shot additive storage foundation: creates `public.label_reference_tracks`
and `public.music_embeddings` (pgvector `VECTOR(512)`), with RLS, owner-only
policies, and revoked public grants. Fail-closed preflight: refuses either
pre-existing private table and rejects unexpected fresh-table ACLs before any
change; a second attempt is rejected and rolls back.

### 010_reference_upload_identity.sql

Additive upload-identity row-shape checks: reservation idempotency key,
upload descriptor bounds, staging/final ETag identity pairs, and their CHECK
constraints on `label_reference_tracks`. Requires 009 applied and reviewed.
Fail-closed preflight: refuses when the table is missing or any expected
column/constraint name already exists. ETags are opaque validators, not
content-verification proofs.

### 011_reference_processing_claim.sql

Transactional prerequisite for processing: adds the
`processing_claim_token` column and its nonempty CHECK constraint.
Requires 010. Fail-closed preflight: locks the table, refuses if the claim
column already exists, and rejects an unexpected `status` column shape. This
source does not establish ACL/RLS or concurrency acceptance.

### 012_label_catalog_fit_scores.sql

Catalog fit scores cache: creates `public.label_catalog_fit_scores` with a
validated aggregate-xor check and Supabase owner policies. Requires 011.
Fail-closed preflight: refuses an existing cache table, missing
`label`/`submission`/`label_reference_tracks`, missing `auth.uid()` or
`anon`/`authenticated` roles, and a missing or unvalidated 011 claim-token
constraint marker.

### 013_label_ar_decisions.sql

Label A&R decision history: creates `public.label_ar_decisions` for
append-only human decisions. Requires 012. Fail-closed preflight: refuses an
existing decisions table, missing `label`/`submission`, missing Supabase
auth prerequisites, and a missing or unvalidated 012 aggregate-xor marker.

## Environment variables

All values below are PLACEHOLDERS. Flags are default-OFF: the gate accepts
only exact `true` or `1`; anything unset, blank, or other stays off and the
flag-gated endpoints return 404.

| Variable | Placeholder value | Notes |
|---|---|---|
| `LABEL_DNA_ENABLED` | `false` | Read API gate; default OFF. |
| `LABEL_DNA_UPLOADS_ENABLED` | `false` | Upload flow gate; default OFF. |
| `AR_EMBEDDING_PROVIDER` | `change-me` | Explicit identity; never inferred. |
| `AR_EMBEDDING_MODEL` | `change-me` | Explicit identity component. |
| `AR_EMBEDDING_VERSION` | `change-me` | Explicit identity component. |
| `AR_EMBEDDING_DIMENSION` | `512` | Explicit identity component. |
| `AR_EMBEDDING_PIPELINE_VERSION` | `change-me` | Preprocessing pipeline identity. |
| `POSTGRES_URL` | `postgresql://...` (placeholder) | Required by database startup. |
| `SUPABASE_URL` | `https://...` (placeholder) | Supabase JWT verification. |
| `SUPABASE_ANON_KEY` | `placeholder` | Supabase JWT verification. |
| `SUPABASE_SERVICE_ROLE_KEY` | `placeholder` | Server-side service access. |
| `CLOUDFLARE_R2_ENDPOINT` | `https://...` (placeholder) | Shared R2 endpoint. |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | `placeholder` | Shared R2 credential. |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | `placeholder` | Shared R2 credential. |
| `CLOUDFLARE_R2_BUCKET_NAME` | `placeholder` | Legacy/shared bucket name. |
| `CLOUDFLARE_R2_PUBLIC_URL` | `https://...` (placeholder) | Existing public audio URL base. |
| `LABEL_REFERENCE_R2_BUCKET_NAME` | `placeholder` | Private reference staging bucket. |
| `LABEL_REFERENCE_R2_PRIVATE_ACCESS_CONFIRMED` | `false` | Explicit privacy attestation. |
| `DATA_DIR` | `data` | Local writable data directory. |

There is no local `JWT_SECRET` in this backend: label tokens are Supabase
JWTs verified through the `SUPABASE_*` configuration above. The private R2
staging factory additionally validates endpoint shape, HTTPS scheme, and the
privacy attestation before constructing any client; constructing a client
never proves the bucket is private.

## Flag-gated endpoint inventory

All endpoints below live behind `LABEL_DNA_ENABLED` (the upload flow also
behind `LABEL_DNA_UPLOADS_ENABLED`) and return **404 "Not found."** while the
flag is OFF, its default. Owner visibility comes from token auth plus
label-scoped queries; storage errors redact as 503.

| Endpoint | Purpose |
|---|---|
| `GET /api/labels/me/label-dna` | Explicit-pipeline catalog readiness counts, no embedding details. |
| `GET /api/labels/me/reference-catalog` | The label's own reference metadata; no storage or embedding data. |
| `POST /api/labels/me/reference-uploads` | Declaration-only upload reservation with idempotency key. |
| `POST /api/labels/me/reference-uploads/{reference_id}/presign` | Staging PUT signing for an owned active reference. |
| `POST /api/labels/me/reference-uploads/{reference_id}/observe` | Stage-observation (conditional COPY) recording. |
| `POST /api/labels/me/reference-uploads/{reference_id}/finalize` | Finalization and promotion to ready. |
| `GET /api/labels/me/ar-decisions` | Per-submission decision history, last element wins. |
| `POST /api/labels/me/ar-decisions` | Append one human shortlist/rejected decision. |
| `GET /api/labels/me/ranked-inbox` | Read-only ranked inbox (`preference` or `catalog` mode); never hides a demo. |

## Live gates — all PENDING

Each gate is **PENDING — not yet executed**. Do not enable flags in production
before all three pass and a human schedules the rollout.

### PostgreSQL gate (PENDING — not yet executed)

- [ ] Migrations 009 -> 013 applied once, in order, in isolated
      Supabase-compatible PostgreSQL, each with stop-on-error and manual
      review of exit status; each repeat attempt rejected by preflight.
- [ ] pgvector adapter verified: `music_embeddings.embedding` is
      `vector(512)` in the extension's original schema; a real bind/result
      round trip with finite normalized 512D input succeeds.
- [ ] ACL/RLS spot checks: `pg_policies`, `relrowsecurity`, and
      `role_table_grants` inspected for all four new tables; cross-label
      authenticated access rejected; `anon` has no table privileges; checked
      with the actual application-equivalent non-owner role.

### Private R2 gate (PENDING — not yet executed)

- [ ] Staging PUT succeeds against the configured private bucket with the
      `LABEL_REFERENCE_R2_*` variables only.
- [ ] Stage observation's conditional COPY behaves as specified (copy-once
      semantics; mismatched ETag rejected).
- [ ] GET of stored originals returns byte-identical content; anonymous and
      public access to the bucket is rejected.

### OpenL3 ARM64 gate (PENDING — not yet executed)

- [ ] OpenL3 inference runs natively on the target ARM64 environment and
      produces finite normalized 512D embeddings.
- [ ] Produced embeddings carry exactly the configured
      `AR_EMBEDDING_*` identity tuple end to end.
- [ ] No synthetic or canned vectors are used in this check.

## Rollback notes

No down-migrations exist. Every migration in 009 -> 013 is additive and
one-shot; rollback is a separate manual review, never automatic. Manual
reversal considerations, to be reviewed per deployment by a human:

- Dropping the new tables (`label_ar_decisions`, `label_catalog_fit_scores`,
  `music_embeddings`, `label_reference_tracks`) loses their recorded data;
  confirm nothing else depends on them first.
- Column additions (010/011 on `label_reference_tracks`) and their checks
  would need explicit, reviewed `ALTER TABLE ... DROP` statements; never
  delete stored data as rollback.
- Restoring any changed grant or policy must be done by explicit inspection
  of `pg_policies` / `role_table_grants`, not assumed symmetric.
- Because flags default OFF, the safest operational rollback is keeping the
  flags OFF; schema state can remain in place unexercised.

## Known limitations

- All automated evidence to date is SQLite service-level; PostgreSQL, RLS,
  R2, and inference behavior are asserted structurally or pending live gates.
- 56 informational review advisories are recorded and pending triage.
- No live OpenL3 inference has run in this repository's verification.
- Soft-deleted-inbox membership and duplicate-aggregate handling remain open
  questions deferred to the T08-UI work.
- dBTP (loudness feature) is deferred and not part of this pivot.

## Backfill pointers

The catalog-fit backfill is a resumable, service-level runner
(`app/ar_matching/catalog_fit_backfill.py`) that recomputes fit caches from
existing embeddings under a fixed identity tuple. It does not create
embeddings. For synthetic data, the demo seed service
(`seed_demo_catalog_data`) writes a deterministic demo label, references, and
one aggregate submission embedding suited to local exercises; the SQLite
smoke test `tests/test_integrated_chain_smoke.py` demonstrates the full
service-level composition. Both are evidence tools only; neither proves
production behavior.

## Provider-swap guidance

The full identity tuple — provider, model, version, dimension, and pipeline
version — gates every fit score, preference vector, and ranked-inbox
aggregation: embeddings are matched only when all five components match
exactly. Swapping any component therefore orphans prior embeddings for
matching purposes and requires re-analysis (re-embedding references and
demos, then recomputing fit caches and label preferences) before the new
identity becomes readable. Old-identity rows coexist by design; they are not
mixed into new-identity results.

## UI handoff notes

- The endpoints above are ready for frontend consumption once the flags are
  deliberately enabled in a given environment; the default-OFF 404 is
  intentional and should not be worked around client-side.
- Ranked-inbox responses carry neutral detail/mode codes
  (`preference`, `catalog`, `chronological_fallback`, `unscored`) intended as
  stable keys for frontend i18n; do not parse human-readable text.
- The inbox never hides a demo: clients must render unscored items rather
  than treating them as errors.
- Frontend work is gated on the framework guides review; no frontend changes
  are part of this unit.
