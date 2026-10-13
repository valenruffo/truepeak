"""Explicit authorized resumption that rotates a live reference-processing claim token."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import exists, select
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
from app.ar_matching.storage_models import LabelReferenceTrack
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
        and (
            re.fullmatch(r'"?[0-9a-fA-F]{32}(?:-\d+)?"?', value) is not None
            or re.fullmatch(r'"[^"\r\n\\]{1,128}"', value) is not None
        )
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


def _require_clean_session(session: Session) -> None:
    if session.in_transaction() or session.new or session.dirty or session.deleted:
        raise ReferenceProcessingClaimSessionError("resumption requires a fresh, clean Session")


def resume_reference_processing(
    receipt: ReferenceProcessingClaimReceipt, *, session_factory: SessionFactory
) -> ReferenceProcessingClaimReceipt:
    """Rotate one live processing claim token; the explicit call is the authorization.

    There is no eligibility, TTL, retry-count, backoff, or operator-role policy:
    a trusted internal caller either invokes this seam or does not. After the
    rotation commits, the old receipt is permanently fenced because every
    sibling CAS precondition matches the exact previous claim token.
    """
    claim = _validate_receipt(receipt)
    with session_factory() as session:
        _require_clean_session(session)
        token = str(uuid4())
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

            table = LabelReferenceTrack.__table__
            active_label = exists(
                select(1).where(Label.id == claim.label_id, Label.subscription_status == "active")
            )
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
                .values(processing_claim_token=token, updated_at=datetime.now(UTC))
            )
            if changed.rowcount != 1:
                raise ReferenceProcessingClaimConflictError(
                    "reference changed during processing resumption"
                )

    return ReferenceProcessingClaimReceipt(
        label_id=claim.label_id,
        reference_id=claim.reference_id,
        title=claim.title,
        artist=claim.artist,
        upload=claim.upload,
        staging_key=claim.staging_key,
        staging_etag=claim.staging_etag,
        final_key=claim.final_key,
        final_etag=claim.final_etag,
        processing_claim_token=token,
    )
