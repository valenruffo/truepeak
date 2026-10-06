"""Atomically claim one eligible uploaded reference for processing only."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import exists, select
from sqlmodel import Session

from app.ar_matching.reference_validation import (
    TypedReferenceValidationError,
    ValidatedReferenceUpload,
    validate_reference_upload,
)
from app.ar_matching.storage_models import LabelReferenceTrack
from app.models import Label


class ReferenceProcessingClaimError(ValueError):
    """Base error for an initial reference-processing claim."""


class ReferenceProcessingClaimValidationError(ReferenceProcessingClaimError):
    """A caller-supplied identity is not canonical."""


class ReferenceProcessingClaimNotFoundError(ReferenceProcessingClaimError):
    """No active reference owned by the supplied active label was found."""


class ReferenceProcessingClaimConflictError(ReferenceProcessingClaimError):
    """The reference is ineligible, inconsistent, or changed during the claim."""


class ReferenceProcessingClaimSessionError(ReferenceProcessingClaimError):
    """The factory did not supply a fresh, clean service-owned Session."""


SessionFactory = Callable[[], AbstractContextManager[Session]]


@dataclass(frozen=True, slots=True)
class ReferenceProcessingClaimReceipt:
    """Internal immutable claim data; it does not assert processing completion."""

    label_id: str
    reference_id: str
    title: str
    artist: str | None
    upload: ValidatedReferenceUpload
    staging_key: str
    staging_etag: str
    final_key: str
    final_etag: str
    processing_claim_token: str
    status: Literal["processing"] = field(default="processing", init=False)


@dataclass(frozen=True, slots=True)
class _Snapshot:
    label_id: str
    reference_id: str
    title: str
    artist: str | None
    idempotency_key: str
    upload: ValidatedReferenceUpload
    staging_key: str
    staging_etag: str
    final_key: str
    final_etag: str


def _canonical_uuid(value: object, field: str, *, stored: bool = False) -> str:
    try:
        if type(value) is str and str(UUID(value)) == value:
            return value
    except ValueError:
        pass
    error = (
        ReferenceProcessingClaimConflictError if stored else ReferenceProcessingClaimValidationError
    )
    raise error(f"{field} must be a canonical UUID string")


def _stored_etag(value: object) -> str:
    if (
        type(value) is not str
        or not value
        or value != value.strip()
        or any(ord(character) < 32 or ord(character) > 126 for character in value)
    ):
        raise ReferenceProcessingClaimConflictError("stored ETag is invalid")
    return value


def _require_clean_session(session: Session) -> None:
    if session.in_transaction() or session.new or session.dirty or session.deleted:
        raise ReferenceProcessingClaimSessionError("claim requires a fresh, clean Session")


def _read_snapshot(session: Session, label_id: str, reference_id: str) -> _Snapshot:
    with session.no_autoflush:
        row = session.execute(
            select(LabelReferenceTrack, Label.subscription_status)
            .join(Label, Label.id == LabelReferenceTrack.label_id)
            .where(LabelReferenceTrack.label_id == label_id, LabelReferenceTrack.id == reference_id)
        ).one_or_none()
    if row is None:
        raise ReferenceProcessingClaimNotFoundError("active owned reference not found")
    track, subscription_status = row
    if track.is_active is not True or subscription_status != "active":
        raise ReferenceProcessingClaimNotFoundError("active owned reference not found")
    if type(track.status) is not str or track.status != "uploaded":
        raise ReferenceProcessingClaimConflictError(
            "reference is not eligible for an initial claim"
        )
    if track.processing_claim_token is not None:
        raise ReferenceProcessingClaimConflictError("reference already has a processing claim")
    if (
        type(track.title) is not str
        or not track.title
        or track.title.strip() != track.title
        or (
            track.artist is not None
            and (
                type(track.artist) is not str
                or not track.artist
                or track.artist.strip() != track.artist
            )
        )
    ):
        raise ReferenceProcessingClaimConflictError("stored reference metadata is invalid")

    idempotency_key = _canonical_uuid(track.upload_idempotency_key, "idempotency_key", stored=True)
    filename, size, limit, staging_key = (
        track.upload_filename,
        track.upload_size_bytes,
        track.upload_limit_bytes,
        track.staging_key,
    )
    if (
        type(filename) is not str
        or type(size) is not int
        or type(limit) is not int
        or type(staging_key) is not str
    ):
        raise ReferenceProcessingClaimConflictError("upload reservation descriptor is incomplete")
    try:
        upload = validate_reference_upload(filename, size, max_size_bytes=limit)
    except TypedReferenceValidationError:
        raise ReferenceProcessingClaimConflictError("stored upload descriptor is invalid") from None

    base = f"label-references/{label_id}/{reference_id}"
    expected_staging = f"{base}/staging/original{upload.canonical_extension}"
    final_key = f"{base}/original{upload.canonical_extension}"
    if upload.effective_limit_bytes != limit or staging_key != expected_staging:
        raise ReferenceProcessingClaimConflictError("stored upload identity is incoherent")
    staging_etag = _stored_etag(track.staging_etag)
    if type(track.storage_key) is not str or track.storage_key != final_key:
        raise ReferenceProcessingClaimConflictError("stored final identity is incomplete")
    final_etag = _stored_etag(track.final_etag)

    return _Snapshot(
        label_id,
        reference_id,
        track.title,
        track.artist,
        idempotency_key,
        upload,
        staging_key,
        staging_etag,
        final_key,
        final_etag,
    )


def _claim_snapshot(session: Session, snapshot: _Snapshot, token: str) -> None:
    table = LabelReferenceTrack.__table__
    active_label = exists(
        select(1).where(Label.id == snapshot.label_id, Label.subscription_status == "active")
    )
    statement = (
        table.update()
        .where(
            table.c.id == snapshot.reference_id,
            table.c.label_id == snapshot.label_id,
            table.c.is_active.is_(True),
            active_label,
            table.c.status == "uploaded",
            table.c.processing_claim_token.is_(None),
            table.c.title == snapshot.title,
            table.c.artist.is_not_distinct_from(snapshot.artist),
            table.c.upload_idempotency_key == snapshot.idempotency_key,
            table.c.upload_filename == snapshot.upload.filename,
            table.c.upload_size_bytes == snapshot.upload.size_bytes,
            table.c.upload_limit_bytes == snapshot.upload.effective_limit_bytes,
            table.c.staging_key == snapshot.staging_key,
            table.c.staging_etag == snapshot.staging_etag,
            table.c.storage_key == snapshot.final_key,
            table.c.final_etag == snapshot.final_etag,
        )
        .values(status="processing", processing_claim_token=token, updated_at=datetime.now(UTC))
    )
    if session.execute(statement).rowcount != 1:
        raise ReferenceProcessingClaimConflictError("reference changed during initial claim")


def claim_reference_processing(
    label_id: str,
    reference_id: str,
    *,
    session_factory: SessionFactory,
) -> ReferenceProcessingClaimReceipt:
    """Commit one initial claim; never resume, process, or complete the reference."""
    owner = _canonical_uuid(label_id, "label_id")
    reference = _canonical_uuid(reference_id, "reference_id")

    with session_factory() as session:
        _require_clean_session(session)
        with session.begin():
            snapshot = _read_snapshot(session, owner, reference)
            token = str(uuid4())
            _claim_snapshot(session, snapshot, token)

    return ReferenceProcessingClaimReceipt(
        label_id=owner,
        reference_id=reference,
        title=snapshot.title,
        artist=snapshot.artist,
        upload=snapshot.upload,
        staging_key=snapshot.staging_key,
        staging_etag=snapshot.staging_etag,
        final_key=snapshot.final_key,
        final_etag=snapshot.final_etag,
        processing_claim_token=token,
    )
