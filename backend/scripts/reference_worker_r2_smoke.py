"""Authorized operator-run R2 smoke harness for the reference worker pipeline.

One real pass against the operator-attested private reference bucket: reserve,
staging PUT (IfNoneMatch="*"), observation, promotion COPY, HEAD verification,
claim, real OpenL3 embedding to READY, retention evidence, then deletion of
exactly the two recorded keys. Secrets are never printed. Exit codes:
0 success+cleaned, 2 refused, 3 success+retained, 4 failure+retained.
"""

from __future__ import annotations

import argparse
import io
import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from uuid import uuid4

_REFERENCE_BUCKET_DEFAULT = "truepeak-label-references"
_ATTESTATION_ENV = "LABEL_REFERENCE_R2_PRIVATE_ACCESS_CONFIRMED"
_REFERENCE_BUCKET_ENV = "LABEL_REFERENCE_R2_BUCKET_NAME"
_REQUIRED_ENVS = (
    "CLOUDFLARE_R2_BUCKET_NAME",
    "CLOUDFLARE_R2_ENDPOINT",
    "CLOUDFLARE_R2_ACCESS_KEY_ID",
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
)
_WAV_FILENAME = "smoke-reference.wav"
_WAV_SAMPLE_RATE, _WAV_SECONDS = 48_000, 2
_WAV_MAX_BYTES = 256 * 1024
_PROVIDER_FRAMES, _PROVIDER_CHANNELS = 200_000, 2
_PIPELINE_VERSION = "r2-smoke-1"
EXIT_CLEANED, EXIT_REFUSED = 0, 2
EXIT_SUCCESS_RETAINED, EXIT_FAILURE_RETAINED = 3, 4


class SmokeRefusalError(Exception):
    """The operator environment refused the run before any cloud I/O."""


@dataclass(frozen=True, slots=True)
class CleanupPlan:
    """Exact object deletes, or full retention reporting the exact retained keys."""

    deletes: tuple[tuple[str, str | None], ...]
    retained_keys: tuple[str, ...]
    retained_reason: str | None


def parse_smoke_config(environ: Mapping[str, str], reference_bucket: str) -> dict[str, str]:
    """Refuse before any cloud I/O unless the operator attested private access."""
    confirmed = environ.get(_ATTESTATION_ENV, "").strip().lower()
    if confirmed not in {"true", "1"}:
        raise SmokeRefusalError(
            f"{_ATTESTATION_ENV} must be true or 1 (operator private-access attestation)"
        )
    settings = {name: environ.get(name, "").strip() for name in _REQUIRED_ENVS}
    missing = sorted(name for name, value in settings.items() if not value)
    if missing:
        raise SmokeRefusalError(f"required environment variables are missing: {', '.join(missing)}")
    asset_bucket = settings["CLOUDFLARE_R2_BUCKET_NAME"]
    if reference_bucket == asset_bucket:
        raise SmokeRefusalError(f"reference bucket {reference_bucket!r} must differ from assets")
    return {_REFERENCE_BUCKET_ENV: reference_bucket, _ATTESTATION_ENV: confirmed, **settings}


def make_client_builder(environ: Mapping[str, str]):
    def builder(*, endpoint_url, aws_access_key_id, aws_secret_access_key):
        import boto3
        from botocore.config import Config

        config = Config(
            signature_version="s3v4",
            region_name="auto",
            connect_timeout=10,
            read_timeout=20,
            retries={"total_max_attempts": 1},
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        )
        return boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
            config=config,
        )

    return builder


def build_wav_fixture() -> bytes:
    """Encode a 2s 48 kHz mono non-silent WAV in memory within the 256 KiB bound."""
    import numpy as np
    import soundfile as sf

    samples = np.arange(_WAV_SAMPLE_RATE * _WAV_SECONDS, dtype=np.float64)
    tone = (0.4 * np.sin(2.0 * np.pi * 440.0 * samples / _WAV_SAMPLE_RATE)).astype(np.float32)
    buffer = io.BytesIO()
    sf.write(buffer, tone.reshape(-1, 1), _WAV_SAMPLE_RATE, format="WAV", subtype="PCM_16")
    wav = buffer.getvalue()
    if len(wav) > _WAV_MAX_BYTES:
        raise RuntimeError(f"WAV fixture is {len(wav)} bytes, over the {_WAV_MAX_BYTES} bound")
    return wav


def cleanup_keys_from_receipt(receipt) -> tuple[str, str]:
    """Record the ONLY two keys cleanup may ever delete, from the claim receipt."""
    if receipt.staging_key == receipt.final_key:
        raise ValueError("claim receipt staging and final identities must be distinct")
    return receipt.staging_key, receipt.final_key


def plan_cleanup(recorded, *, pipeline_succeeded, identities_match) -> CleanupPlan:
    """Attribute every recorded key: exact deletes, or full retention with a reason."""
    keys = tuple(key for key, _etag in recorded)
    if not pipeline_succeeded:
        return CleanupPlan((), keys, "pipeline failed; keys retained for manual reconciliation")
    if not identities_match:
        return CleanupPlan(
            (), keys, "stored identities drifted; keys retained for manual reconciliation"
        )
    return CleanupPlan(tuple(recorded), (), None)


def exit_code_for(*, succeeded: bool, cleaned: bool) -> int:
    """Map the operator outcome: 0 cleaned, 3 success+retained, 4 failure+retained."""
    if succeeded:
        return EXIT_CLEANED if cleaned else EXIT_SUCCESS_RETAINED
    return EXIT_FAILURE_RETAINED


def format_summary(
    environ: Mapping[str, str], *, staging_key, final_key, succeeded, cleaned
) -> str:
    """Render the operator summary; only non-secret fields are ever selected."""
    fields = {
        "asset_bucket": environ["CLOUDFLARE_R2_BUCKET_NAME"],
        "cleanup": "cleaned" if cleaned else "retained",
        "final_key": final_key,
        "pipeline_succeeded": succeeded,
        "reference_bucket": environ[_REFERENCE_BUCKET_ENV],
        "staging_key": staging_key,
    }
    return "\n".join(f"{name}: {fields[name]}" for name in sorted(fields))


def _build_database():
    """Mirror the isolated in-memory SQLite schema used by publication tests."""
    from sqlalchemy import event
    from sqlalchemy.pool import StaticPool
    from sqlmodel import Session, SQLModel, create_engine

    from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding
    from app.models import Label, Notification, Submission

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def _foreign_keys(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    models = (Label, Notification, Submission, LabelReferenceTrack, MusicEmbedding)
    SQLModel.metadata.create_all(engine, tables=[model.__table__ for model in models])
    label_id = str(uuid4())
    label = Label(
        id=label_id,
        name="R2 smoke owner",
        slug=f"r2-smoke-{label_id}",
        owner_email=f"{label_id}@smoke.invalid",
    )
    with Session(engine) as session:
        session.add(label)
        session.commit()
    return engine, label_id


def _verify_outcomes(engine, receipt, provider) -> bool:
    """Assert READY, cleared token, one finite unit-normalized dim-512 aggregate."""
    import numpy as np
    from sqlmodel import Session

    from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding

    with Session(engine) as session:
        row = session.get(LabelReferenceTrack, receipt.reference_id)
        if row is None or row.status != "ready" or row.processing_claim_token is not None:
            raise RuntimeError("reference is not READY with a cleared processing claim token")
        stored = (
            session.query(MusicEmbedding)
            .where(
                MusicEmbedding.reference_track_id == receipt.reference_id,
                MusicEmbedding.segment_index == -1,
            )
            .all()
        )
        if len(stored) != 1:
            raise RuntimeError(f"expected exactly one aggregate embedding, found {len(stored)}")
        vector, metadata = np.asarray(stored[0].embedding, dtype=np.float64), provider.metadata()
        if vector.shape != (metadata.dimension,) or not np.isfinite(vector).all():
            raise RuntimeError("aggregate embedding is not a finite 512-dimensional vector")
        if abs(float(np.linalg.norm(vector)) - 1.0) > 1e-6:
            raise RuntimeError("aggregate embedding is not unit-normalized")
        if (stored[0].provider, stored[0].model, stored[0].version, stored[0].dimension) != (
            metadata.provider,
            metadata.model,
            metadata.version,
            metadata.dimension,
        ) or stored[0].pipeline_version != _PIPELINE_VERSION:
            raise RuntimeError("stored embedding metadata does not match the provider")
        return (
            row.staging_key == receipt.staging_key
            and row.storage_key == receipt.final_key
            and row.final_etag == receipt.final_etag
        )


def _print_retained(bucket: str, keys) -> None:
    print("RETAINED KEYS (manual reconciliation required):", file=sys.stderr)
    for key in keys:
        print(f"  {bucket}  {key}", file=sys.stderr)


def _run_chain(environ: dict[str, str]) -> int:
    from sqlmodel import Session

    from app.ar_matching.reference_finalizations import promote_reference_to_final
    from app.ar_matching.reference_processing_claims import claim_reference_processing
    from app.ar_matching.reference_processing_worker import process_claimed_reference
    from app.ar_matching.reference_reservations import reserve_reference_upload
    from app.ar_matching.reference_stage_observations import observe_reference_staging
    from app.ar_matching.reference_validation import validate_reference_upload
    from app.audio.embedding.openl3_provider import OpenL3EmbeddingProvider
    from app.services.reference_r2_factory import (
        create_private_reference_original_reader,
        create_private_reference_promotion_adapter,
        create_private_reference_staging_adapter,
    )

    bucket = environ[_REFERENCE_BUCKET_ENV]
    builder = make_client_builder(environ)
    client = builder(
        endpoint_url=environ["CLOUDFLARE_R2_ENDPOINT"],
        aws_access_key_id=environ["CLOUDFLARE_R2_ACCESS_KEY_ID"],
        aws_secret_access_key=environ["CLOUDFLARE_R2_SECRET_ACCESS_KEY"],
    )

    def promotion_adapter():
        return create_private_reference_promotion_adapter(environ=environ, client_builder=builder)

    engine, label_id = _build_database()

    def session_factory():
        return Session(engine)

    wav = build_wav_fixture()
    upload = validate_reference_upload(_WAV_FILENAME, len(wav), max_size_bytes=_WAV_MAX_BYTES)
    staging_key = final_key = staging_etag = final_etag = None
    succeeded = identities_match = False
    try:
        with Session(engine) as session:
            reservation = reserve_reference_upload(
                session,
                label_id=label_id,
                idempotency_key=str(uuid4()),
                title="R2 smoke reference",
                artist=None,
                upload=upload,
            )
        staging_key = reservation.staging_key
        try:
            client.put_object(
                Bucket=bucket,
                Key=staging_key,
                Body=wav,
                ContentType=reservation.metadata.canonical_mime,
                IfNoneMatch="*",
            )
        except Exception as error:
            raise RuntimeError('staging PUT failed; IfNoneMatch="*" must be supported') from error
        adapter = create_private_reference_staging_adapter(environ=environ, client=client)
        observation = observe_reference_staging(
            label_id,
            reservation.id,
            session_factory=session_factory,
            adapter_factory=lambda: adapter,
        )
        staging_etag = observation.observed_etag
        promotion = promote_reference_to_final(
            label_id,
            reservation.id,
            session_factory=session_factory,
            adapter_factory=promotion_adapter,
        )
        final_key, final_etag = promotion.final_key, promotion.final_etag
        head = client.head_object(Bucket=bucket, Key=final_key)
        if head.get("ETag") != final_etag or head.get("ContentLength") != len(wav):
            raise RuntimeError("final HEAD does not match the persisted promotion receipt")
        receipt = claim_reference_processing(
            label_id, reservation.id, session_factory=session_factory
        )
        if cleanup_keys_from_receipt(receipt) != (staging_key, final_key):
            raise RuntimeError("claim receipt identities do not match the recorded objects")
        provider = OpenL3EmbeddingProvider(
            max_decoded_frames=_PROVIDER_FRAMES, max_channels=_PROVIDER_CHANNELS
        )
        reader = create_private_reference_original_reader(environ=environ, client_builder=builder)
        process_claimed_reference(
            receipt,
            provider=provider,
            original_reader=reader,
            session_factory=session_factory,
            pipeline_version=_PIPELINE_VERSION,
        )
        identities_match = _verify_outcomes(engine, receipt, provider)
        if identities_match:
            body = reader.read_original(
                receipt.label_id, receipt.reference_id, receipt.upload, receipt.final_etag
            )
            if len(body) != len(wav):
                raise RuntimeError("final original readback length does not match the upload")
        succeeded = True
    except Exception as error:
        print(f"SMOKE FAILED: {error}", file=sys.stderr)

    recorded = tuple(
        item for item in ((staging_key, staging_etag), (final_key, final_etag)) if item[0]
    )
    plan = plan_cleanup(recorded, pipeline_succeeded=succeeded, identities_match=identities_match)
    cleaned = False
    if plan.retained_keys:
        _print_retained(bucket, plan.retained_keys)
    else:
        try:
            for key, etag in plan.deletes:
                client.delete_object(Bucket=bucket, Key=key, **({"IfMatch": etag} if etag else {}))
            cleaned = True
        except Exception as error:
            print(f"CLEANUP FAILED: {error}", file=sys.stderr)
            _print_retained(bucket, [key for key, _etag in plan.deletes])
    print(
        format_summary(
            environ,
            staging_key=staging_key,
            final_key=final_key,
            succeeded=succeeded,
            cleaned=cleaned,
        )
    )
    return exit_code_for(succeeded=succeeded, cleaned=cleaned)


def main(argv=None) -> int:
    """Preflight the operator environment, then run the full smoke chain."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--bucket", default=_REFERENCE_BUCKET_DEFAULT, help="private reference bucket"
    )
    args = parser.parse_args(argv)
    try:
        environ = parse_smoke_config(os.environ, args.bucket)
    except SmokeRefusalError as refusal:
        print(f"REFUSED: {refusal}", file=sys.stderr)
        return EXIT_REFUSED
    return _run_chain(environ)


if __name__ == "__main__":
    raise SystemExit(main())
