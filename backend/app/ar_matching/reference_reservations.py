"""Tenant-scoped database reservations for future reference-audio uploads.

Callers must authenticate first and pass a server-verified label ID. This
module does not authenticate, sign URLs, access object storage, or claim that
an upload is complete. Use a fresh, clean Session: this unit owns its single
transaction and must not commit or roll back caller-owned pending work.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.ar_matching.reference_validation import (
    TypedReferenceValidationError,
    ValidatedReferenceUpload,
    validate_reference_upload,
)
from app.ar_matching.storage_models import LabelReferenceTrack
from app.models import Label


class ReferenceReservationError(ValueError):
    """Base error for invalid or unavailable reference reservations."""


class ReferenceReservationValidationError(ReferenceReservationError):
    """A reservation identifier, title, artist, or upload descriptor is invalid."""


class ReferenceLabelNotFoundError(ReferenceReservationError):
    """The trusted label ID does not identify an existing label."""


class ReferenceReservationConflictError(ReferenceReservationError):
    """The idempotency key is inactive or already bound to another payload."""


class ReferenceReservationSessionError(ReferenceReservationError):
    """The caller did not provide a fresh, clean Session."""


@dataclass(frozen=True, slots=True)
class ReferenceReservationMetadata:
    """Normalized descriptor metadata captured with a reservation."""

    title: str
    artist: str | None
    filename: str
    size_bytes: int
    effective_limit_bytes: int
    canonical_extension: str
    canonical_mime: str


@dataclass(frozen=True, slots=True)
class ReferenceReservationDTO:
    """Immutable reservation snapshot; staging_key is internal, never public API."""

    id: str
    label_id: str
    metadata: ReferenceReservationMetadata
    status: str
    staging_key: str
    created_at: datetime
    reused: bool


def _canonical_uuid(value: object, field: str) -> str:
    if type(value) is not str:
        raise ReferenceReservationValidationError(f"{field} must be a canonical UUID string")
    try:
        parsed = UUID(value)
    except (ValueError, AttributeError) as exc:
        raise ReferenceReservationValidationError(
            f"{field} must be a canonical UUID string"
        ) from exc
    if str(parsed) != value:
        raise ReferenceReservationValidationError(f"{field} must be a canonical UUID string")
    return value


def _normalize_title_artist(title: object, artist: object) -> tuple[str, str | None]:
    if type(title) is not str or not title.strip():
        raise ReferenceReservationValidationError("title must be a nonblank string")
    normalized_title = title.strip()
    if artist is None:
        normalized_artist = None
    elif type(artist) is str:
        normalized_artist = artist.strip() or None
    else:
        raise ReferenceReservationValidationError("artist must be a string or None")
    return normalized_title, normalized_artist


def _revalidate_upload(upload: object) -> ValidatedReferenceUpload:
    if type(upload) is not ValidatedReferenceUpload:
        raise ReferenceReservationValidationError(
            "upload must be a validated reference-upload descriptor"
        )
    try:
        canonical = validate_reference_upload(
            upload.filename,
            upload.size_bytes,
            max_size_bytes=upload.effective_limit_bytes,
        )
    except (TypedReferenceValidationError, AttributeError) as exc:
        raise ReferenceReservationValidationError(
            "upload descriptor failed canonical validation"
        ) from exc

    if (
        type(upload.canonical_extension) is not str
        or type(upload.canonical_mime) is not str
        or upload.filename != canonical.filename
        or upload.canonical_extension != canonical.canonical_extension
        or upload.canonical_mime != canonical.canonical_mime
        or upload.size_bytes != canonical.size_bytes
        or upload.effective_limit_bytes != canonical.effective_limit_bytes
    ):
        raise ReferenceReservationValidationError(
            "upload descriptor fields do not match canonical validation"
        )
    return canonical


def _require_clean_session(session: Session) -> None:
    if session.in_transaction() or session.new or session.dirty or session.deleted:
        raise ReferenceReservationSessionError(
            "reservation requires a fresh Session with no active transaction or pending changes"
        )


def _find_reservation(
    session: Session, label_id: str, idempotency_key: str
) -> LabelReferenceTrack | None:
    statement = select(LabelReferenceTrack).where(
        LabelReferenceTrack.label_id == label_id,
        LabelReferenceTrack.upload_idempotency_key == idempotency_key,
    )
    return session.execute(statement).scalar_one_or_none()


def _flush_reservation(session: Session, row: LabelReferenceTrack) -> None:
    """Isolated flush seam also used for deterministic integrity-race tests."""
    session.add(row)
    session.flush()


def _staging_key(label_id: str, reference_id: str, extension: str) -> str:
    return f"label-references/{label_id}/{reference_id}/staging/original{extension}"


def _reservation_snapshot(
    row: LabelReferenceTrack,
    upload: ValidatedReferenceUpload,
    *,
    reused: bool,
) -> ReferenceReservationDTO:
    expected_key = _staging_key(row.label_id, row.id, upload.canonical_extension)
    if row.staging_key != expected_key:
        raise ReferenceReservationConflictError(
            "stored reservation staging identity is not canonical"
        )
    return ReferenceReservationDTO(
        id=row.id,
        label_id=row.label_id,
        metadata=ReferenceReservationMetadata(
            title=row.title,
            artist=row.artist,
            filename=row.upload_filename,
            size_bytes=row.upload_size_bytes,
            effective_limit_bytes=row.upload_limit_bytes,
            canonical_extension=upload.canonical_extension,
            canonical_mime=upload.canonical_mime,
        ),
        status=row.status,
        staging_key=row.staging_key,
        created_at=row.created_at,
        reused=reused,
    )


def _reuse_existing(
    row: LabelReferenceTrack,
    *,
    label_id: str,
    idempotency_key: str,
    title: str,
    artist: str | None,
    upload: ValidatedReferenceUpload,
) -> ReferenceReservationDTO:
    matches = (
        row.label_id == label_id
        and row.upload_idempotency_key == idempotency_key
        and row.title == title
        and row.artist == artist
        and row.upload_filename == upload.filename
        and row.upload_size_bytes == upload.size_bytes
        and row.upload_limit_bytes == upload.effective_limit_bytes
    )
    if not matches or not row.is_active:
        raise ReferenceReservationConflictError(
            "idempotency key is inactive or bound to a different upload payload"
        )
    return _reservation_snapshot(row, upload, reused=True)


def reserve_reference_upload(
    session: Session,
    *,
    label_id: str,
    idempotency_key: str,
    title: str,
    artist: str | None,
    upload: ValidatedReferenceUpload,
) -> ReferenceReservationDTO:
    """Atomically reserve a label-owned upload using a caller-authenticated ID.

    The caller must obtain ``label_id`` from server-verified ownership before
    calling this function and provide a fresh Session. Existing processing or
    ready rows are returned as stored; this service does not authorize another
    upload, sign a URL, or change status. ``uploaded`` means reserved, not
    verified or complete.
    """
    label_id = _canonical_uuid(label_id, "label_id")
    idempotency_key = _canonical_uuid(idempotency_key, "idempotency_key")
    normalized_title, normalized_artist = _normalize_title_artist(title, artist)
    canonical_upload = _revalidate_upload(upload)
    _require_clean_session(session)

    attempted_insert = False
    try:
        with session.begin():
            owner_id = session.execute(
                select(Label.id).where(Label.id == label_id)
            ).scalar_one_or_none()
            if owner_id is None:
                raise ReferenceLabelNotFoundError("verified label does not exist")

            existing = _find_reservation(session, label_id, idempotency_key)
            if existing is not None:
                return _reuse_existing(
                    existing,
                    label_id=label_id,
                    idempotency_key=idempotency_key,
                    title=normalized_title,
                    artist=normalized_artist,
                    upload=canonical_upload,
                )

            reference_id = str(uuid4())
            row = LabelReferenceTrack(
                id=reference_id,
                label_id=label_id,
                title=normalized_title,
                artist=normalized_artist,
                status="uploaded",
                is_active=True,
                upload_idempotency_key=idempotency_key,
                upload_filename=canonical_upload.filename,
                upload_size_bytes=canonical_upload.size_bytes,
                upload_limit_bytes=canonical_upload.effective_limit_bytes,
                staging_key=_staging_key(
                    label_id, reference_id, canonical_upload.canonical_extension
                ),
                staging_etag=None,
                final_etag=None,
                storage_key=None,
            )
            attempted_insert = True
            _flush_reservation(session, row)
            snapshot = _reservation_snapshot(row, canonical_upload, reused=False)
        return snapshot
    except IntegrityError:
        if not attempted_insert:
            raise

        # The first transaction has been rolled back by its context manager.
        # Only a scoped row with an exactly matching payload proves a duplicate;
        # unrelated integrity failures preserve and re-raise the original error.
        recovered: ReferenceReservationDTO | None = None
        with session.begin():
            owner_id = session.execute(
                select(Label.id).where(Label.id == label_id)
            ).scalar_one_or_none()
            raced = (
                _find_reservation(session, label_id, idempotency_key)
                if owner_id is not None
                else None
            )
            if raced is not None:
                recovered = _reuse_existing(
                    raced,
                    label_id=label_id,
                    idempotency_key=idempotency_key,
                    title=normalized_title,
                    artist=normalized_artist,
                    upload=canonical_upload,
                )
        if recovered is None:
            raise
        return recovered
