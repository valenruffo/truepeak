"""Successful READY publication of a currently owned reference-processing claim."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.ar_matching.reference_processing_claims import (
    ReferenceProcessingClaimConflictError,
    ReferenceProcessingClaimNotFoundError,
    ReferenceProcessingClaimReceipt,
    ReferenceProcessingClaimSessionError,
    ReferenceProcessingClaimValidationError,
    SessionFactory,
)
from app.ar_matching.reference_validation import (
    TypedReferenceValidationError,
    ValidatedReferenceUpload,
    validate_reference_upload,
)
from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding
from app.audio.embedding.schemas import EmbeddingValidationError, TrackEmbedding
from app.models import Label


def _canonical_uuid(value: object) -> str:
    try:
        if type(value) is str and str(UUID(value)) == value:
            return value
    except ValueError:
        pass
    raise ReferenceProcessingClaimValidationError("claim receipt identity is invalid")


def _etag(value: object) -> bool:
    return (
        type(value) is str
        and bool(value)
        and value == value.strip()
        and all(32 <= ord(char) <= 126 for char in value)
        and re.fullmatch(r'"?[0-9a-fA-F]{32}(?:-\d+)?"?', value) is None
    )


def _validate_receipt(receipt: object) -> ReferenceProcessingClaimReceipt:
    if type(receipt) is not ReferenceProcessingClaimReceipt:
        raise ReferenceProcessingClaimValidationError("claim receipt is invalid")
    _canonical_uuid(receipt.label_id)
    _canonical_uuid(receipt.reference_id)
    _canonical_uuid(receipt.processing_claim_token)
    if type(receipt.status) is not str or receipt.status != "processing":
        raise ReferenceProcessingClaimValidationError("claim receipt status is invalid")
    if (
        type(receipt.title) is not str
        or not receipt.title
        or receipt.title.strip() != receipt.title
        or (
            receipt.artist is not None
            and (
                type(receipt.artist) is not str
                or not receipt.artist
                or receipt.artist.strip() != receipt.artist
            )
        )
    ):
        raise ReferenceProcessingClaimValidationError("claim receipt metadata is invalid")
    upload = receipt.upload
    if (
        type(upload) is not ValidatedReferenceUpload
        or type(upload.filename) is not str
        or type(upload.size_bytes) is not int
        or type(upload.effective_limit_bytes) is not int
        or type(upload.canonical_extension) is not str
        or type(upload.canonical_mime) is not str
    ):
        raise ReferenceProcessingClaimValidationError("claim receipt upload is invalid")
    try:
        validated = validate_reference_upload(
            upload.filename, upload.size_bytes, max_size_bytes=upload.effective_limit_bytes
        )
    except TypedReferenceValidationError:
        raise ReferenceProcessingClaimValidationError("claim receipt upload is invalid") from None
    if upload != validated:
        raise ReferenceProcessingClaimValidationError("claim receipt upload is invalid")
    extension = validated.canonical_extension
    base = f"label-references/{receipt.label_id}/{receipt.reference_id}"
    if (
        type(receipt.staging_key) is not str
        or type(receipt.final_key) is not str
        or receipt.staging_key != f"{base}/staging/original{extension}"
        or receipt.final_key != f"{base}/original{extension}"
        or not _etag(receipt.staging_etag)
        or not _etag(receipt.final_etag)
    ):
        raise ReferenceProcessingClaimValidationError("claim receipt storage identity is invalid")
    return receipt


def _validate_embedding(embedding: object) -> TrackEmbedding:
    if type(embedding) is not TrackEmbedding:
        raise ReferenceProcessingClaimValidationError("track embedding is invalid")
    try:
        metadata = embedding.metadata
        if (
            type(metadata.dimension) is not int
            or metadata.dimension != 512
            or type(metadata.provider) is not str
            or not metadata.provider
            or type(metadata.model) is not str
            or not metadata.model
            or type(metadata.version) is not str
            or not metadata.version
        ):
            raise ReferenceProcessingClaimValidationError("track embedding identity is invalid")
    except EmbeddingValidationError:
        raise ReferenceProcessingClaimValidationError("track embedding is invalid") from None
    return embedding


def _validate_pipeline_version(pipeline_version: object) -> str:
    if (
        type(pipeline_version) is not str
        or not pipeline_version
        or pipeline_version.strip() != pipeline_version
    ):
        raise ReferenceProcessingClaimValidationError("pipeline version is invalid")
    return pipeline_version


def _require_clean_session(session: Session) -> None:
    if session.in_transaction() or session.new or session.dirty or session.deleted:
        raise ReferenceProcessingClaimSessionError("publication requires a fresh, clean Session")


def publish_reference_processing_success(
    receipt: ReferenceProcessingClaimReceipt,
    embedding: TrackEmbedding,
    pipeline_version: str,
    *,
    session_factory: SessionFactory,
) -> None:
    """Atomically publish one aggregate embedding and the terminal READY status."""
    claim = _validate_receipt(receipt)
    track_embedding = _validate_embedding(embedding)
    version = _validate_pipeline_version(pipeline_version)
    metadata = track_embedding.metadata
    with session_factory() as session:
        _require_clean_session(session)
        with session.begin():
            with session.no_autoflush:
                owner = session.execute(
                    select(LabelReferenceTrack.is_active, Label.subscription_status)
                    .join(Label, Label.id == LabelReferenceTrack.label_id)
                    .where(
                        LabelReferenceTrack.id == claim.reference_id,
                        LabelReferenceTrack.label_id == claim.label_id,
                    )
                ).one_or_none()
            if owner is None or owner[0] is not True or owner[1] != "active":
                raise ReferenceProcessingClaimNotFoundError("active owned reference not found")

            session.add(
                MusicEmbedding(
                    label_id=claim.label_id,
                    reference_track_id=claim.reference_id,
                    submission_id=None,
                    embedding=list(track_embedding.vector),
                    provider=metadata.provider,
                    model=metadata.model,
                    version=metadata.version,
                    dimension=metadata.dimension,
                    pipeline_version=version,
                    segment_index=-1,
                    start_seconds=None,
                    end_seconds=None,
                    created_at=track_embedding.created_at,
                )
            )
            table = LabelReferenceTrack.__table__
            active_label = exists(
                select(1).where(Label.id == claim.label_id, Label.subscription_status == "active")
            )
            try:
                changed = session.execute(
                    table.update()
                    .where(
                        table.c.id == claim.reference_id,
                        table.c.label_id == claim.label_id,
                        table.c.is_active.is_(True),
                        active_label,
                        table.c.status == "processing",
                        table.c.processing_claim_token == claim.processing_claim_token,
                        table.c.title == claim.title,
                        table.c.artist.is_not_distinct_from(claim.artist),
                        table.c.upload_filename == claim.upload.filename,
                        table.c.upload_size_bytes == claim.upload.size_bytes,
                        table.c.upload_limit_bytes == claim.upload.effective_limit_bytes,
                        table.c.staging_key == claim.staging_key,
                        table.c.staging_etag == claim.staging_etag,
                        table.c.storage_key == claim.final_key,
                        table.c.final_etag == claim.final_etag,
                    )
                    .values(
                        status="ready",
                        processing_claim_token=None,
                        updated_at=datetime.now(UTC),
                    )
                )
            except IntegrityError:
                raise ReferenceProcessingClaimConflictError(
                    "reference embedding already published"
                ) from None
            if changed.rowcount != 1:
                raise ReferenceProcessingClaimConflictError(
                    "reference changed during successful publication"
                )
