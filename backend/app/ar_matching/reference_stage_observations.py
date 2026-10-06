"""Persist one bounded provider observation for an owned staging reference.

An ETag pins the first observed staging state; it does not freeze staging bytes,
revoke replayable PUT URLs, prove privacy, or represent final audio validation.
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, Protocol
from uuid import UUID

from sqlalchemy import select
from sqlmodel import Session

from app.ar_matching.reference_validation import (
    TypedReferenceValidationError,
    ValidatedReferenceUpload,
    validate_reference_upload,
)
from app.ar_matching.storage_models import LabelReferenceTrack
from app.services.reference_r2 import StagingObjectVerification


class ReferenceStageObservationError(ValueError):
    """Base error for a staging observation request."""


class ReferenceStageObservationValidationError(ReferenceStageObservationError):
    """An input identity or adapter verification result is invalid."""


class ReferenceStageObservationNotFoundError(ReferenceStageObservationError):
    """No active reference owned by the authenticated label was found."""


class ReferenceStageObservationConflictError(ReferenceStageObservationError):
    """The reference is ineligible or changed during staging verification."""


class ReferenceStageObservationSessionError(ReferenceStageObservationError):
    """A supplied session is not fresh and clean for this operation."""


class ReferenceStagingVerifier(Protocol):
    def verify_uploaded_reference(
        self, label_id: str, reference_id: str, upload: ValidatedReferenceUpload
    ) -> StagingObjectVerification: ...


@dataclass(frozen=True, slots=True)
class ReferenceStageObservationResult:
    """Internal observation outcome; it contains no URL or embedding data."""

    reference_id: str
    label_id: str
    status: Literal["uploaded"]
    observed_etag: str
    reused: bool


@dataclass(frozen=True, slots=True)
class _ReservationSnapshot:
    reference_id: str
    label_id: str
    idempotency_key: str
    upload: ValidatedReferenceUpload
    staging_key: str
    prior_etag: str | None


SessionFactory = Callable[[], AbstractContextManager[Session]]
AdapterFactory = Callable[[], ReferenceStagingVerifier]


_FIELDS = (
    LabelReferenceTrack.id,
    LabelReferenceTrack.label_id,
    LabelReferenceTrack.is_active,
    LabelReferenceTrack.status,
    LabelReferenceTrack.upload_idempotency_key,
    LabelReferenceTrack.upload_filename,
    LabelReferenceTrack.upload_size_bytes,
    LabelReferenceTrack.upload_limit_bytes,
    LabelReferenceTrack.staging_key,
    LabelReferenceTrack.staging_etag,
    LabelReferenceTrack.storage_key,
    LabelReferenceTrack.final_etag,
)


def _canonical_uuid(value: object, field: str) -> str:
    if type(value) is not str:
        raise ReferenceStageObservationValidationError(f"{field} must be a canonical UUID string")
    try:
        canonical = str(UUID(value))
    except ValueError as error:
        raise ReferenceStageObservationValidationError(
            f"{field} must be a canonical UUID string"
        ) from error
    if canonical != value:
        raise ReferenceStageObservationValidationError(f"{field} must be a canonical UUID string")
    return value


def _require_clean_session(session: Session) -> None:
    if session.in_transaction() or session.new or session.dirty or session.deleted:
        raise ReferenceStageObservationSessionError(
            "observation requires a fresh Session with no transaction or pending changes"
        )


def _expected_staging_key(label_id: str, reference_id: str, extension: str) -> str:
    return f"label-references/{label_id}/{reference_id}/staging/original{extension}"


def _opaque_etag(value: object, *, stored: bool = False) -> str:
    error_type = (
        ReferenceStageObservationConflictError
        if stored
        else ReferenceStageObservationValidationError
    )
    if type(value) is not str or not value.strip():
        raise error_type("staging ETag must be a nonblank opaque string")
    return value


def _snapshot_from_row(
    row: object,
    label_id: str,
    reference_id: str,
    *,
    second_phase: bool = False,
) -> _ReservationSnapshot:
    if row is None:
        if second_phase:
            raise ReferenceStageObservationConflictError("reference changed during verification")
        raise ReferenceStageObservationNotFoundError("active owned reference not found")

    def conflict() -> ReferenceStageObservationConflictError:
        return ReferenceStageObservationConflictError("reference is not eligible for observation")

    if row["is_active"] is not True:
        if second_phase:
            raise ReferenceStageObservationConflictError("reference changed during verification")
        raise ReferenceStageObservationNotFoundError("active owned reference not found")
    if (
        type(row["id"]) is not str
        or type(row["label_id"]) is not str
        or row["id"] != reference_id
        or row["label_id"] != label_id
        or row["status"] != "uploaded"
        or row["storage_key"] is not None
        or row["final_etag"] is not None
    ):
        raise conflict()

    try:
        idempotency_key = _canonical_uuid(row["upload_idempotency_key"], "idempotency_key")
    except ReferenceStageObservationValidationError as error:
        raise conflict() from error

    filename = row["upload_filename"]
    size_bytes = row["upload_size_bytes"]
    limit_bytes = row["upload_limit_bytes"]
    staging_key = row["staging_key"]
    if (
        type(filename) is not str
        or type(size_bytes) is not int
        or type(limit_bytes) is not int
        or type(staging_key) is not str
    ):
        raise conflict()
    try:
        upload = validate_reference_upload(filename, size_bytes, max_size_bytes=limit_bytes)
    except TypedReferenceValidationError as error:
        raise conflict() from error
    expected_key = _expected_staging_key(label_id, reference_id, upload.canonical_extension)
    if upload.effective_limit_bytes != limit_bytes or staging_key != expected_key:
        raise conflict()

    prior_etag = row["staging_etag"]
    if prior_etag is not None:
        try:
            prior_etag = _opaque_etag(prior_etag, stored=True)
        except ReferenceStageObservationConflictError:
            raise
    return _ReservationSnapshot(
        reference_id=reference_id,
        label_id=label_id,
        idempotency_key=idempotency_key,
        upload=upload,
        staging_key=staging_key,
        prior_etag=prior_etag,
    )


def _read_snapshot(
    session: Session,
    label_id: str,
    reference_id: str,
    *,
    second_phase: bool = False,
) -> _ReservationSnapshot:
    with session.no_autoflush:
        row = (
            session.execute(
                select(*_FIELDS).where(
                    LabelReferenceTrack.label_id == label_id,
                    LabelReferenceTrack.id == reference_id,
                )
            )
            .mappings()
            .one_or_none()
        )
    return _snapshot_from_row(row, label_id, reference_id, second_phase=second_phase)


def _verified_etag(verification: object, snapshot: _ReservationSnapshot) -> str:
    if type(verification) is not StagingObjectVerification:
        raise ReferenceStageObservationValidationError(
            "adapter returned an unexpected staging verification result"
        )
    if (
        type(verification.key) is not str
        or verification.key != snapshot.staging_key
        or type(verification.content_length) is not int
        or verification.content_length != snapshot.upload.size_bytes
        or type(verification.content_type) is not str
        or verification.content_type != snapshot.upload.canonical_mime
        or verification.status != "STAGING"
        or verification.provisional is not True
        or verification.ready is not False
        or verification.final is not False
    ):
        raise ReferenceStageObservationValidationError(
            "adapter verification does not match the reserved staging object"
        )
    return _opaque_etag(verification.etag)


def _update_staging_etag(
    session: Session, snapshot: _ReservationSnapshot, observed_etag: str
) -> bool:
    table = LabelReferenceTrack.__table__
    statement = (
        table.update()
        .where(
            table.c.id == snapshot.reference_id,
            table.c.label_id == snapshot.label_id,
            table.c.is_active.is_(True),
            table.c.status == "uploaded",
            table.c.upload_idempotency_key == snapshot.idempotency_key,
            table.c.upload_filename == snapshot.upload.filename,
            table.c.upload_size_bytes == snapshot.upload.size_bytes,
            table.c.upload_limit_bytes == snapshot.upload.effective_limit_bytes,
            table.c.staging_key == snapshot.staging_key,
            table.c.staging_etag.is_(None),
            table.c.storage_key.is_(None),
            table.c.final_etag.is_(None),
        )
        .values(staging_etag=observed_etag, updated_at=datetime.now(UTC))
    )
    with session.no_autoflush:
        result = session.execute(statement)
    return result.rowcount == 1


def observe_reference_staging(
    label_id: str,
    reference_id: str,
    *,
    session_factory: SessionFactory,
    adapter_factory: AdapterFactory,
) -> ReferenceStageObservationResult:
    """Reverify the exact reserved staging object and pin its first observed ETag.

    Provider verification runs between two fresh, short-lived database Sessions.
    A later different ETag conflicts; creating another reference is required.
    """
    owner = _canonical_uuid(label_id, "label_id")
    reference = _canonical_uuid(reference_id, "reference_id")

    with session_factory() as session:
        _require_clean_session(session)
        snapshot = _read_snapshot(session, owner, reference)

    # No Session or database transaction spans adapter construction or I/O.
    adapter = adapter_factory()
    verification = adapter.verify_uploaded_reference(owner, reference, snapshot.upload)
    observed_etag = _verified_etag(verification, snapshot)

    if snapshot.prior_etag is not None and snapshot.prior_etag != observed_etag:
        raise ReferenceStageObservationConflictError(
            "staging ETag changed; create a new independent reference"
        )

    if snapshot.prior_etag is not None:
        with session_factory() as session:
            _require_clean_session(session)
            current = _read_snapshot(session, owner, reference, second_phase=True)
            if current != snapshot:
                raise ReferenceStageObservationConflictError(
                    "reference changed during verification"
                )
        return ReferenceStageObservationResult(
            reference_id=reference,
            label_id=owner,
            status="uploaded",
            observed_etag=observed_etag,
            reused=True,
        )

    result = ReferenceStageObservationResult(
        reference_id=reference,
        label_id=owner,
        status="uploaded",
        observed_etag=observed_etag,
        reused=False,
    )
    with session_factory() as session:
        _require_clean_session(session)
        with session.begin():
            if not _update_staging_etag(session, snapshot, observed_etag):
                raise ReferenceStageObservationConflictError(
                    "reference changed during verification"
                )
    return result
