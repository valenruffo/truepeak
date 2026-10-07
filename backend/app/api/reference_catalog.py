"""Flag-gated, owner-only read API for reference catalog and Label DNA status.

The router is safe to import without application startup, credentials, or a
configured database. Authentication and session modules are loaded only after
the feature flag and request token have been validated.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlmodel import Session

from app.ar_matching.ar_decisions import (
    LabelArDecisionOutcome,
    list_label_ar_decisions,
    list_label_decision_history,
    record_label_ar_decision,
)
from app.ar_matching.reference_catalog import (
    CorruptReferenceEmbeddingError,
    LabelDnaReadiness,
    ReferenceCatalogItem,
    get_label_dna_readiness,
    list_reference_catalog,
)
from app.ar_matching.reference_finalizations import (
    ReferenceFinalizationConflictError,
    ReferenceFinalizationNotFoundError,
    ReferenceFinalizationSessionError,
    ReferenceFinalizationValidationError,
    promote_reference_to_final,
)
from app.ar_matching.reference_reservations import (
    ReferenceLabelNotFoundError,
    ReferenceReservationConflictError,
    ReferenceReservationValidationError,
    reserve_reference_upload,
)
from app.ar_matching.reference_stage_observations import (
    ReferenceStageObservationConflictError,
    ReferenceStageObservationNotFoundError,
    ReferenceStageObservationSessionError,
    ReferenceStageObservationValidationError,
    observe_reference_staging,
)
from app.ar_matching.reference_validation import (
    TypedReferenceValidationError,
    ValidatedReferenceUpload,
    validate_reference_upload,
)
from app.ar_matching.storage_models import LabelReferenceTrack
from app.audio.embedding.schemas import EmbeddingMetadata
from app.models import Label, Submission

router = APIRouter(tags=["label-reference-catalog"])

_ENABLED_VARIABLE = "LABEL_DNA_ENABLED"
_UPLOADS_ENABLED_VARIABLE = "LABEL_DNA_UPLOADS_ENABLED"
# 503 availability redaction only; owner visibility comes from token auth and label-scoped queries.
_PRIVATE_TABLES = {
    "label_reference_tracks",
    "music_embeddings",
    "label_catalog_fit_scores",
    "label_ar_decisions",
}
_DATABASE_CONFIG_ERROR = "POSTGRES_URL environment variable is required"
_VECTOR_ADAPTER_ERROR = "pgvector is required for PostgreSQL Vector512 storage"
_CATALOG_UNAVAILABLE = "Reference catalog is temporarily unavailable."
_DNA_UNAVAILABLE = "Label DNA is temporarily unavailable."
_PRESIGN_UNAVAILABLE = "Reference upload signing is temporarily unavailable."
_PRESIGN_INELIGIBLE = "Reference upload is not eligible for signing."
_OBSERVATION_UNAVAILABLE = "Reference staging observation is temporarily unavailable."
_FINALIZATION_UNAVAILABLE = "Reference finalization is temporarily unavailable."


class ReferenceCatalogItemDTO(BaseModel):
    """Public reference metadata; deliberately excludes storage and embedding data."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    artist: str | None
    status: str
    is_active: bool
    duration_seconds: float | None
    created_at: datetime
    updated_at: datetime


class LabelDnaReadinessDTO(BaseModel):
    """Catalog readiness counts only; never serializes eligible vector records."""

    state: str
    active_reference_count: int
    eligible_count: int
    minimum_valid_references: int


class ReferenceUploadReservationRequest(BaseModel):
    """Strict declaration-only request; no caller-controlled ownership or storage data."""

    model_config = ConfigDict(extra="forbid", strict=True)

    title: StrictStr
    artist: StrictStr | None = None
    filename: StrictStr
    size_bytes: StrictInt
    idempotency_key: StrictStr


class ReferenceUploadReservationDTO(BaseModel):
    """Minimal reservation receipt, not evidence of a completed object upload."""

    reference_id: str
    reused: bool
    status: str


class ReferenceUploadPresignDTO(BaseModel):
    """Permission for one provisional staging PUT, not proof of an uploaded object."""

    reference_id: str
    url: str
    method: Literal["PUT"]
    required_headers: dict[str, str]
    expires_in_seconds: int


class ReferenceStageObservationDTO(BaseModel):
    """Minimal receipt that records a provisional staging observation only."""

    reference_id: str
    status: Literal["uploaded"]
    reused: bool
    provisional: Literal[True]


class ReferenceFinalizationDTO(BaseModel):
    """Public receipt only; never expose persisted provider keys or ETags."""

    reference_id: str
    status: Literal["uploaded", "processing", "ready", "failed"]
    reused: bool


class LabelArDecisionDTO(BaseModel):
    """Minimal recorded human A&R decision fact; never quality or probability data."""

    model_config = ConfigDict(from_attributes=True)

    decision_id: str
    submission_id: str
    decision: str
    decided_by: str
    decided_at: datetime
    note: str | None


class LabelArDecisionReceiptDTO(LabelArDecisionDTO):
    """POST receipt; the history entry plus whether a new event row was created."""

    created: bool


class LabelArDecisionRequest(BaseModel):
    """Strict declaration-only request; the caller never controls ownership data."""

    model_config = ConfigDict(extra="forbid", strict=True)

    submission_id: StrictStr
    decision: StrictStr
    decided_by: StrictStr | None = None
    note: StrictStr | None = None


@dataclass(frozen=True, slots=True)
class _ReadinessIdentity:
    metadata: EmbeddingMetadata
    pipeline_version: str


def _verify_token(token: str) -> dict[str, Any]:
    """Lazily delegate token verification to the established auth service."""
    from app.services.auth import verify_token

    return verify_token(token)


def _get_session() -> Generator[Session, None, None]:
    """Lazily delegate session lifetime to the established database module."""
    from app.database import get_session

    yield from get_session()


@contextmanager
def _observation_session() -> Generator[Session, None, None]:
    """Bridge the existing lazy generator to the service's context-manager seam."""
    session_stream = _get_session()
    try:
        yield next(session_stream)
    finally:
        session_stream.close()


def _enabled() -> bool:
    return os.getenv(_ENABLED_VARIABLE, "").strip().lower() in {"true", "1"}


def _uploads_enabled() -> bool:
    return os.getenv(_UPLOADS_ENABLED_VARIABLE, "").strip().lower() in {"true", "1"}


def _verified_label_id(request: Request) -> str:
    """Verify one selected token and accept only its exact nonblank label ID."""
    token = None
    authorization = request.headers.get("authorization")
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    if not token:
        token = request.headers.get("x-label-token")
    if not token:
        token = request.cookies.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required.")

    try:
        verified = _verify_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token.") from None

    if not isinstance(verified, dict):
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    label_id = verified.get("label_id")
    if not isinstance(label_id, str) or not label_id.strip():
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return label_id


def _readiness_identity() -> _ReadinessIdentity:
    """Load an explicit server-side embedding identity; never infer a provider."""
    provider = os.getenv("AR_EMBEDDING_PROVIDER")
    model = os.getenv("AR_EMBEDDING_MODEL")
    version = os.getenv("AR_EMBEDDING_VERSION")
    raw_dimension = os.getenv("AR_EMBEDDING_DIMENSION")
    pipeline_version = os.getenv("AR_EMBEDDING_PIPELINE_VERSION")
    identity_values = (provider, model, version, raw_dimension, pipeline_version)
    if any(not isinstance(value, str) or not value.strip() for value in identity_values):
        raise HTTPException(status_code=503, detail=_DNA_UNAVAILABLE)
    try:
        dimension = int(raw_dimension)
        metadata = EmbeddingMetadata(provider, model, version, dimension)
    except (TypeError, ValueError):
        raise HTTPException(status_code=503, detail=_DNA_UNAVAILABLE) from None
    if dimension != 512:
        raise HTTPException(status_code=503, detail=_DNA_UNAVAILABLE)
    return _ReadinessIdentity(metadata, pipeline_version.strip())


def _exception_chain(error: BaseException):
    pending = [error]
    seen: set[int] = set()
    while pending:
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        yield current
        for nested in (getattr(current, "orig", None), current.__cause__, current.__context__):
            if isinstance(nested, BaseException):
                pending.append(nested)


def _is_missing_private_table(error: BaseException) -> bool:
    for current in _exception_chain(error):
        sqlstate = getattr(current, "sqlstate", None) or getattr(current, "pgcode", None)
        if sqlstate == "42P01":
            return True
        message = str(current).lower()
        marker = "no such table:"
        if marker not in message:
            continue
        table = message.split(marker, 1)[1].strip().split()[0].strip("`\"'[]")
        if table.split(".")[-1].strip("`\"'[]") in _PRIVATE_TABLES:
            return True
    return False


def _is_missing_vector_adapter(error: BaseException) -> bool:
    for current in _exception_chain(error):
        if isinstance(current, RuntimeError) and str(current) == _VECTOR_ADAPTER_ERROR:
            return True
        if isinstance(current, ImportError) and getattr(current, "name", None) in {
            "pgvector",
            "pgvector.sqlalchemy",
        }:
            return True
    return False


def _is_database_config_error(error: BaseException) -> bool:
    return any(
        isinstance(current, RuntimeError) and str(current) == _DATABASE_CONFIG_ERROR
        for current in _exception_chain(error)
    )


def _unavailable_for_storage_error(error: BaseException) -> bool:
    return _is_missing_private_table(error) or _is_missing_vector_adapter(error)


def _with_owner_session(label_id: str, operation: Callable[[Session], Any]) -> Any:
    """Run owner projection and one read without flushing or altering caller state."""
    session_stream = None
    try:
        session_stream = _get_session()
        try:
            session = next(session_stream)
        except RuntimeError as error:
            if _is_database_config_error(error):
                raise HTTPException(status_code=503, detail=_CATALOG_UNAVAILABLE) from None
            raise

        with session.no_autoflush:
            exists = session.exec(select(Label.id).where(Label.id == label_id)).first()
            if exists is None:
                raise HTTPException(status_code=404, detail="Label not found.")
            return operation(session)
    except CorruptReferenceEmbeddingError:
        raise HTTPException(status_code=503, detail=_CATALOG_UNAVAILABLE) from None
    except SQLAlchemyError as error:
        if _unavailable_for_storage_error(error):
            raise HTTPException(status_code=503, detail=_CATALOG_UNAVAILABLE) from None
        raise
    except RuntimeError as error:
        if _is_database_config_error(error) or _is_missing_vector_adapter(error):
            raise HTTPException(status_code=503, detail=_CATALOG_UNAVAILABLE) from None
        raise
    finally:
        close = getattr(session_stream, "close", None)
        if close is not None:
            close()


@router.get(
    "/api/labels/me/reference-catalog",
    response_model=list[ReferenceCatalogItemDTO],
)
def read_reference_catalog(request: Request) -> tuple[ReferenceCatalogItem, ...]:
    """Return metadata for the authenticated label's references only."""
    if not _enabled():
        raise HTTPException(status_code=404, detail="Not found.")
    label_id = _verified_label_id(request)
    return _with_owner_session(label_id, lambda session: list_reference_catalog(session, label_id))


@router.get(
    "/api/labels/me/label-dna",
    response_model=LabelDnaReadinessDTO,
)
def read_label_dna(request: Request) -> LabelDnaReadinessDTO:
    """Return explicit-pipeline catalog readiness without embedding details."""
    if not _enabled():
        raise HTTPException(status_code=404, detail="Not found.")
    label_id = _verified_label_id(request)
    identity = _readiness_identity()
    readiness: LabelDnaReadiness = _with_owner_session(
        label_id,
        lambda session: get_label_dna_readiness(
            session,
            label_id,
            identity.metadata,
            identity.pipeline_version,
        ),
    )
    return LabelDnaReadinessDTO(
        state=readiness.state.value,
        active_reference_count=readiness.active_reference_count,
        eligible_count=readiness.eligible_count,
        minimum_valid_references=readiness.minimum_valid_references,
    )


@router.post(
    "/api/labels/me/reference-uploads",
    response_model=ReferenceUploadReservationDTO,
    status_code=201,
    responses={
        200: {
            "model": ReferenceUploadReservationDTO,
            "description": "An identical active reservation was reused.",
        },
        404: {"description": "The verified label does not exist."},
        409: {"description": "The idempotency key conflicts with a different reservation."},
        422: {"description": "The JSON request or upload descriptor is invalid."},
        503: {"description": "Reservation storage is temporarily unavailable."},
    },
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/json": {
                    "schema": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["title", "filename", "size_bytes", "idempotency_key"],
                        "properties": {
                            "title": {"type": "string"},
                            "artist": {"type": ["string", "null"]},
                            "filename": {"type": "string"},
                            "size_bytes": {"type": "integer", "minimum": 1},
                            "idempotency_key": {"type": "string", "format": "uuid"},
                        },
                    }
                }
            },
        }
    },
)
async def reserve_reference_upload_endpoint(
    request: Request, response: Response
) -> ReferenceUploadReservationDTO:
    """Reserve metadata for a later upload; this does not issue or complete one."""
    if not _enabled() or not _uploads_enabled():
        raise HTTPException(status_code=404, detail="Not found.")

    # Authenticate before touching even malformed or absent JSON bodies.
    label_id = _verified_label_id(request)
    try:
        payload = ReferenceUploadReservationRequest.model_validate(await request.json())
    except (json.JSONDecodeError, UnicodeDecodeError, ValidationError):
        raise HTTPException(
            status_code=422, detail="Invalid reference upload reservation request."
        ) from None

    try:
        upload = validate_reference_upload(payload.filename, payload.size_bytes)
    except TypedReferenceValidationError:
        raise HTTPException(
            status_code=422, detail="Invalid reference upload reservation request."
        ) from None

    session_stream = None
    try:
        session_stream = _get_session()
        try:
            session = next(session_stream)
        except RuntimeError as error:
            if _is_database_config_error(error):
                raise HTTPException(status_code=503, detail=_CATALOG_UNAVAILABLE) from None
            raise
        reservation = reserve_reference_upload(
            session,
            label_id=label_id,
            idempotency_key=payload.idempotency_key,
            title=payload.title,
            artist=payload.artist,
            upload=upload,
        )
    except ReferenceReservationConflictError:
        raise HTTPException(
            status_code=409, detail="Reservation conflicts with an existing request."
        ) from None
    except ReferenceLabelNotFoundError:
        raise HTTPException(status_code=404, detail="Label not found.") from None
    except ReferenceReservationValidationError:
        raise HTTPException(
            status_code=422, detail="Invalid reference upload reservation request."
        ) from None
    except SQLAlchemyError as error:
        if _unavailable_for_storage_error(error):
            raise HTTPException(status_code=503, detail=_CATALOG_UNAVAILABLE) from None
        raise
    except RuntimeError as error:
        if _is_database_config_error(error) or _is_missing_vector_adapter(error):
            raise HTTPException(status_code=503, detail=_CATALOG_UNAVAILABLE) from None
        raise
    finally:
        close = getattr(session_stream, "close", None)
        if close is not None:
            close()

    if reservation.reused:
        response.status_code = 200
    return ReferenceUploadReservationDTO(
        reference_id=reservation.id,
        reused=reservation.reused,
        status=reservation.status,
    )


def _canonical_uuid(value: object) -> bool:
    if type(value) is not str:
        return False
    try:
        return str(UUID(value)) == value
    except ValueError:
        return False


def _create_reference_staging_adapter():
    """Lazy factory seam; never construct storage clients before authorization."""
    from app.services.reference_r2_factory import create_private_reference_staging_adapter

    return create_private_reference_staging_adapter()


def _create_reference_promotion_adapter():
    """Build the private promotion adapter only after the service's owner snapshot."""
    from app.services.reference_r2_factory import create_private_reference_promotion_adapter

    return create_private_reference_promotion_adapter()


def _owned_upload_for_presign(label_id: str, reference_id: str) -> ValidatedReferenceUpload:
    """Project persisted owner/upload identity from a fresh read-only Session."""
    session_stream = None
    try:
        session_stream = _get_session()
        try:
            session = next(session_stream)
        except RuntimeError as error:
            if _is_database_config_error(error):
                raise HTTPException(status_code=503, detail=_PRESIGN_UNAVAILABLE) from None
            raise

        if session.in_transaction() or session.new or session.dirty or session.deleted:
            raise HTTPException(status_code=409, detail=_PRESIGN_INELIGIBLE)

        fields = (
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
        with session.no_autoflush:
            row = (
                session.execute(
                    select(*fields).where(
                        LabelReferenceTrack.label_id == label_id,
                        LabelReferenceTrack.id == reference_id,
                    )
                )
                .mappings()
                .one_or_none()
            )

        if row is None or row["is_active"] is not True:
            raise HTTPException(status_code=404, detail="Reference not found.")
        if (
            row["status"] != "uploaded"
            or row["staging_etag"] is not None
            or row["storage_key"] is not None
            or row["final_etag"] is not None
            or not _canonical_uuid(label_id)
            or not _canonical_uuid(row["label_id"])
            or row["label_id"] != label_id
            or not _canonical_uuid(reference_id)
            or not _canonical_uuid(row["id"])
            or row["id"] != reference_id
        ):
            raise HTTPException(status_code=409, detail=_PRESIGN_INELIGIBLE)

        filename = row["upload_filename"]
        size_bytes = row["upload_size_bytes"]
        limit_bytes = row["upload_limit_bytes"]
        idempotency_key = row["upload_idempotency_key"]
        if (
            type(filename) is not str
            or type(size_bytes) is not int
            or type(limit_bytes) is not int
            or not _canonical_uuid(idempotency_key)
        ):
            raise HTTPException(status_code=409, detail=_PRESIGN_INELIGIBLE)
        try:
            upload = validate_reference_upload(filename, size_bytes, max_size_bytes=limit_bytes)
        except TypedReferenceValidationError:
            raise HTTPException(status_code=409, detail=_PRESIGN_INELIGIBLE) from None

        expected_key = (
            f"label-references/{row['label_id']}/{row['id']}/staging/"
            f"original{upload.canonical_extension}"
        )
        if (
            upload.effective_limit_bytes != limit_bytes
            or type(row["staging_key"]) is not str
            or row["staging_key"] != expected_key
        ):
            raise HTTPException(status_code=409, detail=_PRESIGN_INELIGIBLE)
        return upload
    except SQLAlchemyError as error:
        if _unavailable_for_storage_error(error):
            raise HTTPException(status_code=503, detail=_PRESIGN_UNAVAILABLE) from None
        raise
    except RuntimeError as error:
        if _is_database_config_error(error) or _is_missing_vector_adapter(error):
            raise HTTPException(status_code=503, detail=_PRESIGN_UNAVAILABLE) from None
        raise
    finally:
        close = getattr(session_stream, "close", None)
        if close is not None:
            close()


def _known_presign_availability_error(error: Exception) -> bool:
    from app.services.reference_r2 import (
        ReferenceR2ConfigurationError,
        ReferenceR2ResponseError,
    )
    from app.services.reference_r2_factory import ReferenceR2FactoryError

    if isinstance(
        error,
        (ReferenceR2FactoryError, ReferenceR2ConfigurationError, ReferenceR2ResponseError),
    ):
        return True
    try:
        from botocore.exceptions import BotoCoreError, ClientError
    except ImportError:
        return False
    return isinstance(error, (BotoCoreError, ClientError))


def _known_finalization_error_status(error: Exception) -> int | None:
    """Map only typed provider/SDK failures; leave all unexpected errors untouched."""
    from app.services.reference_r2 import (
        ReferenceR2ConfigurationError,
        ReferenceR2InputError,
        ReferenceR2ResponseError,
    )
    from app.services.reference_r2_factory import ReferenceR2FactoryError
    from app.services.reference_r2_promotion import (
        ReferenceR2PreconditionError,
        ReferenceR2PromotionProviderError,
    )

    if isinstance(error, ReferenceR2PreconditionError):
        return 409
    if isinstance(
        error,
        (
            ReferenceR2FactoryError,
            ReferenceR2ConfigurationError,
            ReferenceR2InputError,
            ReferenceR2ResponseError,
            ReferenceR2PromotionProviderError,
        ),
    ):
        return 503
    try:
        from botocore.exceptions import BotoCoreError, ClientError
    except ImportError:
        return None
    return 503 if isinstance(error, (BotoCoreError, ClientError)) else None


@router.post(
    "/api/labels/me/reference-uploads/{reference_id}/presign",
    response_model=ReferenceUploadPresignDTO,
    responses={
        404: {"description": "The owned active reference does not exist."},
        409: {"description": "The reference is not eligible for another staging PUT."},
        422: {"description": "The path reference ID is not a canonical UUID."},
        503: {"description": "Reference upload signing is temporarily unavailable."},
    },
)
def presign_reference_upload_endpoint(
    request: Request, reference_id: str
) -> ReferenceUploadPresignDTO:
    """Authorize a replayable STAGING PUT; the signed URL may overwrite until TTL.

    Issuance checks current persisted identity but cannot revoke earlier URLs or
    prove object existence, privacy, upload completion, or atomic cross-provider
    completion. This endpoint provides no concurrency or immutability guarantee.
    """
    if not _enabled() or not _uploads_enabled():
        raise HTTPException(status_code=404, detail="Not found.")
    label_id = _verified_label_id(request)
    if not _canonical_uuid(reference_id):
        raise HTTPException(status_code=422, detail="Invalid reference ID.")

    upload = _owned_upload_for_presign(label_id, reference_id)
    try:
        adapter = _create_reference_staging_adapter()
        signed = adapter.presign_put(
            label_id,
            reference_id,
            upload,
            expires_in_seconds=900,
        )
    except Exception as error:
        if not _known_presign_availability_error(error):
            raise
        raise HTTPException(status_code=503, detail=_PRESIGN_UNAVAILABLE) from None

    return ReferenceUploadPresignDTO(
        reference_id=reference_id,
        url=signed.url,
        method="PUT",
        required_headers=dict(signed.required_headers),
        expires_in_seconds=signed.expires_in_seconds,
    )


@router.post(
    "/api/labels/me/reference-uploads/{reference_id}/observe",
    response_model=ReferenceStageObservationDTO,
    status_code=200,
    responses={
        404: {"description": "The active reference is not owned by this label."},
        409: {"description": "The reference is ineligible or its observed ETag changed."},
        422: {"description": "The authenticated owner or path reference ID is invalid."},
        503: {"description": "Staging observation is temporarily unavailable."},
    },
)
def observe_reference_upload_endpoint(
    request: Request, reference_id: str
) -> ReferenceStageObservationDTO:
    """Reverify a provisional object and pin its first opaque ETag.

    The provider HEAD checks stored size and content type; a conditional range GET
    checks only a 12-byte header prefix. ETags are opaque identities, not content
    hashes. This does not validate the full file, establish readiness, prove
    privacy, or finalize audio. Earlier presigned PUTs remain replayable until TTL;
    observing an object cannot instantly revoke those URLs. A first observation
    leaves status ``uploaded``. Reuse rechecks the provider without a database
    update; a changed ETag conflicts and requires a new independent reference.
    """
    if not _enabled() or not _uploads_enabled():
        raise HTTPException(status_code=404, detail="Not found.")

    label_id = _verified_label_id(request)
    if not _canonical_uuid(label_id):
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    if not _canonical_uuid(reference_id):
        raise HTTPException(status_code=422, detail="Invalid reference ID.")

    try:
        result = observe_reference_staging(
            label_id,
            reference_id,
            session_factory=_observation_session,
            adapter_factory=_create_reference_staging_adapter,
        )
    except ReferenceStageObservationNotFoundError:
        raise HTTPException(status_code=404, detail="Reference not found.") from None
    except (ReferenceStageObservationConflictError, ReferenceStageObservationSessionError):
        raise HTTPException(
            status_code=409, detail="Reference observation conflicts with current state."
        ) from None
    except TypedReferenceValidationError:
        raise HTTPException(
            status_code=422, detail="Invalid reference observation header."
        ) from None
    except ReferenceStageObservationValidationError:
        raise HTTPException(status_code=503, detail=_OBSERVATION_UNAVAILABLE) from None
    except SQLAlchemyError as error:
        if _unavailable_for_storage_error(error):
            raise HTTPException(status_code=503, detail=_OBSERVATION_UNAVAILABLE) from None
        raise
    except RuntimeError as error:
        if _is_database_config_error(error) or _is_missing_vector_adapter(error):
            raise HTTPException(status_code=503, detail=_OBSERVATION_UNAVAILABLE) from None
        raise
    except Exception as error:
        if not _known_presign_availability_error(error):
            raise
        raise HTTPException(status_code=503, detail=_OBSERVATION_UNAVAILABLE) from None

    return ReferenceStageObservationDTO(
        reference_id=reference_id,
        status="uploaded",
        reused=result.reused,
        provisional=True,
    )


@router.post(
    "/api/labels/me/reference-uploads/{reference_id}/finalize",
    response_model=ReferenceFinalizationDTO,
    status_code=201,
    responses={
        200: {
            "model": ReferenceFinalizationDTO,
            "description": "A previously persisted finalization receipt was reused.",
        },
        401: {"description": "The verified owner token is invalid."},
        404: {"description": "The active owned reference does not exist."},
        409: {"description": "Reference finalization conflicts with current state."},
        422: {"description": "The path reference ID is not a canonical UUID."},
        503: {"description": "Reference finalization is temporarily unavailable."},
    },
)
def finalize_reference_upload_endpoint(
    request: Request, response: Response, reference_id: str
) -> ReferenceFinalizationDTO:
    """Persist a private-copy receipt; this does not claim processing readiness."""
    if not _enabled() or not _uploads_enabled():
        raise HTTPException(status_code=404, detail="Not found.")
    label_id = _verified_label_id(request)
    if not _canonical_uuid(label_id):
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    if not _canonical_uuid(reference_id):
        raise HTTPException(status_code=422, detail="Invalid reference ID.")

    try:
        receipt = promote_reference_to_final(
            label_id,
            reference_id,
            session_factory=_observation_session,
            adapter_factory=_create_reference_promotion_adapter,
        )
    except ReferenceFinalizationNotFoundError:
        raise HTTPException(status_code=404, detail="Reference not found.") from None
    except (ReferenceFinalizationConflictError, ReferenceFinalizationSessionError):
        raise HTTPException(
            status_code=409, detail="Reference finalization conflicts with current state."
        ) from None
    except ReferenceFinalizationValidationError:
        raise HTTPException(status_code=503, detail=_FINALIZATION_UNAVAILABLE) from None
    except SQLAlchemyError as error:
        if isinstance(error, OperationalError) or _unavailable_for_storage_error(error):
            raise HTTPException(status_code=503, detail=_FINALIZATION_UNAVAILABLE) from None
        raise
    except RuntimeError as error:
        if _is_database_config_error(error) or _is_missing_vector_adapter(error):
            raise HTTPException(status_code=503, detail=_FINALIZATION_UNAVAILABLE) from None
        raise
    except Exception as error:
        status = _known_finalization_error_status(error)
        if status is None:
            raise
        detail = (
            "Reference finalization conflicts with current state."
            if status == 409
            else _FINALIZATION_UNAVAILABLE
        )
        raise HTTPException(status_code=status, detail=detail) from None

    if receipt.reused:
        response.status_code = 200
    return ReferenceFinalizationDTO(
        reference_id=reference_id,
        status=receipt.status,
        reused=receipt.reused,
    )


def _record_owned_ar_decision(
    session: Session, label_id: str, payload: LabelArDecisionRequest, decided_by: str
) -> LabelArDecisionOutcome:
    owned = session.exec(
        select(Submission.id)
        .where(Submission.id == payload.submission_id)
        .where(Submission.label_id == label_id)
    ).first()
    if owned is None:
        # Mirrors the presign owner-scoped existence-SELECT precedent: unknown and
        # foreign submissions are indistinguishable 404s.
        raise HTTPException(status_code=404, detail="Submission not found.")
    return record_label_ar_decision(
        session,
        label_id=label_id,
        submission_id=payload.submission_id,
        decision=payload.decision,
        decided_by=decided_by,
        note=payload.note,
    )


@router.get("/api/labels/me/ar-decisions", response_model=list[LabelArDecisionDTO])
def read_ar_decision_history(request: Request, submission_id: str | None = None):
    """Return this label's recorded human A&R decision facts, oldest first."""
    if not _enabled():
        raise HTTPException(status_code=404, detail="Not found.")
    label_id = _verified_label_id(request)
    if not _canonical_uuid(label_id):
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    if submission_id is not None and not _canonical_uuid(submission_id):
        raise HTTPException(status_code=422, detail="invalid_submission_id")
    return _with_owner_session(
        label_id,
        lambda session: (
            list_label_ar_decisions(session, label_id=label_id, submission_id=submission_id)
            if submission_id is not None
            else list_label_decision_history(session, label_id=label_id)
        ),
    )


@router.post(
    "/api/labels/me/ar-decisions",
    response_model=LabelArDecisionReceiptDTO,
    status_code=201,
)
async def record_ar_decision_endpoint(
    request: Request, response: Response
) -> LabelArDecisionReceiptDTO:
    """Record one human A&R decision event; identical re-affirmations are suppressed.
    Human A&R facts for history/preference learning; never auto-generated quality
    or hit-probability data; event-only: Submission.status is never written.
    """
    if not _enabled():
        raise HTTPException(status_code=404, detail="Not found.")
    label_id = _verified_label_id(request)
    if not _canonical_uuid(label_id):
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    try:
        payload = LabelArDecisionRequest.model_validate(await request.json())
    except (json.JSONDecodeError, UnicodeDecodeError, ValidationError):
        raise HTTPException(status_code=422, detail="invalid_ar_decision_request") from None
    if not _canonical_uuid(payload.submission_id):
        raise HTTPException(status_code=422, detail="invalid_submission_id")
    if payload.decision not in ("shortlist", "rejected"):
        raise HTTPException(status_code=422, detail="invalid_decision")
    decided_by = payload.decided_by if payload.decided_by is not None else "owner"
    if not decided_by.strip() or decided_by.strip() != decided_by:
        raise HTTPException(status_code=422, detail="invalid_decided_by")

    try:
        outcome = _with_owner_session(
            label_id,
            lambda session: _record_owned_ar_decision(session, label_id, payload, decided_by),
        )
    except ValueError:
        raise HTTPException(status_code=422, detail="invalid_ar_decision") from None

    if not outcome.created:
        response.status_code = 200
    return LabelArDecisionReceiptDTO(**asdict(outcome.record), created=outcome.created)
