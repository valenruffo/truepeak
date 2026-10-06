"""Persist a conditional-copy receipt, never a readiness claim.

Provider I/O runs between Sessions; copy and receipt persistence are non-atomic.
Failure retains bytes for manual follow-up without cleanup, adoption, or recopy.
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, Protocol
from uuid import UUID

from sqlalchemy import exists, select
from sqlmodel import Session

from app.ar_matching.reference_validation import (
    TypedReferenceValidationError,
    ValidatedReferenceUpload,
    validate_reference_upload,
)
from app.ar_matching.storage_models import LabelReferenceTrack
from app.models import Label
from app.services.reference_r2_promotion import FinalReferencePromotion


class ReferenceFinalizationError(ValueError):
    """Base error for a reference finalization request."""


class ReferenceFinalizationValidationError(ReferenceFinalizationError):
    """An identity, descriptor, or provider receipt is invalid."""


class ReferenceFinalizationNotFoundError(ReferenceFinalizationError):
    """No active reference owned by the active label was found."""


class ReferenceFinalizationConflictError(ReferenceFinalizationError):
    """A reference is ineligible, changed, or could not persist its copy receipt."""


class ReferenceFinalizationSessionError(ReferenceFinalizationError):
    """A supplied Session is not fresh and clean for this operation."""


class ReferenceFinalPromotionProvider(Protocol):
    def promote(
        self,
        owner_id: str,
        reference_id: str,
        upload: ValidatedReferenceUpload,
        staging_etag: str,
    ) -> FinalReferencePromotion: ...


SessionFactory = Callable[[], AbstractContextManager[Session]]
AdapterFactory = Callable[[], ReferenceFinalPromotionProvider]


@dataclass(frozen=True, slots=True)
class PersistedFinalReferenceReceipt:
    """Internal immutable database receipt; it makes no readiness claim."""

    label_id: str
    reference_id: str
    status: Literal["uploaded", "processing", "ready", "failed"]
    final_key: str
    final_etag: str
    reused: bool


@dataclass(frozen=True, slots=True)
class _Snapshot:
    label_id: str
    reference_id: str
    status: str
    title: str
    artist: str | None
    idempotency_key: str
    upload: ValidatedReferenceUpload
    staging_key: str
    staging_etag: str
    final_key: str
    final_etag: str | None


_FIELDS = (
    LabelReferenceTrack.is_active,
    LabelReferenceTrack.status,
    LabelReferenceTrack.title,
    LabelReferenceTrack.artist,
    LabelReferenceTrack.upload_idempotency_key,
    LabelReferenceTrack.upload_filename,
    LabelReferenceTrack.upload_size_bytes,
    LabelReferenceTrack.upload_limit_bytes,
    LabelReferenceTrack.staging_key,
    LabelReferenceTrack.staging_etag,
    LabelReferenceTrack.storage_key,
    LabelReferenceTrack.final_etag,
)
_STATUSES = ("uploaded", "processing", "ready", "failed")


def _canonical_uuid(value: object, field: str, *, stored: bool = False) -> str:
    error = ReferenceFinalizationConflictError if stored else ReferenceFinalizationValidationError
    try:
        if type(value) is str and str(UUID(value)) == value:
            return value
    except ValueError:
        pass
    raise error(f"{field} must be a canonical UUID string")


def _require_clean_session(session: Session) -> None:
    if session.in_transaction() or session.new or session.dirty or session.deleted:
        raise ReferenceFinalizationSessionError("finalization requires a fresh, clean Session")


def _opaque_etag(value: object, *, stored: bool = False) -> str:
    error = ReferenceFinalizationConflictError if stored else ReferenceFinalizationValidationError
    if (
        type(value) is not str
        or not value
        or value != value.strip()
        or any(ord(character) < 32 or ord(character) > 126 for character in value)
    ):
        raise error("ETag must be a nonblank, trimmed, printable ASCII opaque value")
    return value


def _read_snapshot(session: Session, label_id: str, reference_id: str) -> _Snapshot:
    with session.no_autoflush:
        statement = (
            select(*_FIELDS, Label.subscription_status.label("label_status"))
            .join(Label, Label.id == LabelReferenceTrack.label_id)
            .where(
                LabelReferenceTrack.label_id == label_id,
                LabelReferenceTrack.id == reference_id,
            )
        )
        row = session.execute(statement).mappings().one_or_none()
    if row is None or row["is_active"] is not True or row["label_status"] != "active":
        raise ReferenceFinalizationNotFoundError("active owned reference not found")
    status = row["status"]
    if type(status) is not str or status not in _STATUSES:
        raise ReferenceFinalizationConflictError("reference status is invalid")
    title, artist = row["title"], row["artist"]
    if (
        type(title) is not str
        or not title
        or title.strip() != title
        or (
            artist is not None
            and (type(artist) is not str or not artist or artist.strip() != artist)
        )
    ):
        raise ReferenceFinalizationConflictError("stored reference metadata is invalid")
    token = _canonical_uuid(row["upload_idempotency_key"], "idempotency_key", stored=True)

    filename, size, limit, staging_key = (
        row["upload_filename"],
        row["upload_size_bytes"],
        row["upload_limit_bytes"],
        row["staging_key"],
    )
    if (
        type(filename) is not str
        or type(size) is not int
        or type(limit) is not int
        or type(staging_key) is not str
    ):
        raise ReferenceFinalizationConflictError("upload reservation descriptor is incomplete")
    try:
        upload = validate_reference_upload(filename, size, max_size_bytes=limit)
    except TypedReferenceValidationError:
        raise ReferenceFinalizationConflictError("invalid upload descriptor") from None
    expected_base = f"label-references/{label_id}/{reference_id}"
    expected_staging = f"{expected_base}/staging/original{upload.canonical_extension}"
    expected_final = f"{expected_base}/original{upload.canonical_extension}"
    if upload.effective_limit_bytes != limit or staging_key != expected_staging:
        raise ReferenceFinalizationConflictError("staging identity is not canonical")
    staging_etag = _opaque_etag(row["staging_etag"], stored=True)

    storage_key, final_etag = row["storage_key"], row["final_etag"]
    if storage_key is not None or final_etag is not None:
        if type(storage_key) is not str or storage_key != expected_final:
            raise ReferenceFinalizationConflictError("persisted final identity is incoherent")
        final_etag = _opaque_etag(final_etag, stored=True)
    elif status != "uploaded":
        raise ReferenceFinalizationConflictError("only uploaded references can be copied")

    return _Snapshot(
        label_id=label_id,
        reference_id=reference_id,
        status=status,
        title=title,
        artist=artist,
        idempotency_key=token,
        upload=upload,
        staging_key=staging_key,
        staging_etag=staging_etag,
        final_key=expected_final,
        final_etag=final_etag,
    )


def _verified_final(receipt: object, snapshot: _Snapshot) -> str:
    if type(receipt) is not FinalReferencePromotion:
        raise ReferenceFinalizationValidationError("provider returned an unexpected copy receipt")
    if type(receipt.final_key) is not str or receipt.final_key != snapshot.final_key:
        raise ReferenceFinalizationValidationError("provider receipt has an unexpected final key")
    return _opaque_etag(receipt.final_etag)


def _persist_receipt(session: Session, snapshot: _Snapshot, final_etag: str) -> None:
    table = LabelReferenceTrack.__table__
    active_label = exists(
        select(1).where(
            Label.id == snapshot.label_id,
            Label.subscription_status == "active",
        )
    )
    statement = (
        table.update()
        .where(
            table.c.id == snapshot.reference_id,
            table.c.label_id == snapshot.label_id,
            table.c.is_active.is_(True),
            active_label,
            table.c.status == "uploaded",
            table.c.title == snapshot.title,
            table.c.artist.is_not_distinct_from(snapshot.artist),
            table.c.upload_idempotency_key == snapshot.idempotency_key,
            table.c.upload_filename == snapshot.upload.filename,
            table.c.upload_size_bytes == snapshot.upload.size_bytes,
            table.c.upload_limit_bytes == snapshot.upload.effective_limit_bytes,
            table.c.staging_key == snapshot.staging_key,
            table.c.staging_etag == snapshot.staging_etag,
            table.c.storage_key.is_(None),
            table.c.final_etag.is_(None),
        )
        .values(storage_key=snapshot.final_key, final_etag=final_etag, updated_at=datetime.now(UTC))
    )
    result = session.execute(statement)
    if result.rowcount != 1:
        raise ReferenceFinalizationConflictError("reference changed during final copy")


def promote_reference_to_final(
    label_id: str,
    reference_id: str,
    *,
    session_factory: SessionFactory,
    adapter_factory: AdapterFactory,
) -> PersistedFinalReferenceReceipt:
    """Conditionally copy an owned staging object and persist its exact receipt."""
    owner = _canonical_uuid(label_id, "label_id")
    reference = _canonical_uuid(reference_id, "reference_id")

    with session_factory() as session:
        _require_clean_session(session)
        snapshot = _read_snapshot(session, owner, reference)
        first_session = session

    if snapshot.final_etag is not None:
        return PersistedFinalReferenceReceipt(
            owner, reference, snapshot.status, snapshot.final_key, snapshot.final_etag, True
        )

    # Provider construction and I/O happen with no database Session or transaction open.
    adapter = adapter_factory()
    provider_receipt = adapter.promote(owner, reference, snapshot.upload, snapshot.staging_etag)
    final_etag = _verified_final(provider_receipt, snapshot)

    try:
        with session_factory() as session:
            if session is first_session:
                raise ReferenceFinalizationSessionError("requires a second fresh Session")
            _require_clean_session(session)
            with session.begin():
                _persist_receipt(session, snapshot, final_etag)
    except (ReferenceFinalizationConflictError, ReferenceFinalizationSessionError):
        raise
    except Exception:
        raise ReferenceFinalizationConflictError(
            "final copy succeeded but its receipt could not be persisted; manual follow-up required"
        ) from None

    return PersistedFinalReferenceReceipt(
        label_id=owner,
        reference_id=reference,
        status="uploaded",
        final_key=snapshot.final_key,
        final_etag=final_etag,
        reused=False,
    )
