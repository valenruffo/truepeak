"""Flag-gated, owner-only read API for reference catalog and Label DNA status.

The router is safe to import without application startup, credentials, or a
configured database. Authentication and session modules are loaded only after
the feature flag and request token have been validated.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Generator
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session

from app.ar_matching.reference_catalog import (
    CorruptReferenceEmbeddingError,
    LabelDnaReadiness,
    ReferenceCatalogItem,
    get_label_dna_readiness,
    list_reference_catalog,
)
from app.ar_matching.reference_reservations import (
    ReferenceLabelNotFoundError,
    ReferenceReservationConflictError,
    ReferenceReservationValidationError,
    reserve_reference_upload,
)
from app.ar_matching.reference_validation import (
    TypedReferenceValidationError,
    validate_reference_upload,
)
from app.audio.embedding.schemas import EmbeddingMetadata
from app.models import Label

router = APIRouter(tags=["label-reference-catalog"])

_ENABLED_VARIABLE = "LABEL_DNA_ENABLED"
_UPLOADS_ENABLED_VARIABLE = "LABEL_DNA_UPLOADS_ENABLED"
_PRIVATE_TABLES = {"label_reference_tracks", "music_embeddings"}
_DATABASE_CONFIG_ERROR = "POSTGRES_URL environment variable is required"
_VECTOR_ADAPTER_ERROR = "pgvector is required for PostgreSQL Vector512 storage"
_CATALOG_UNAVAILABLE = "Reference catalog is temporarily unavailable."
_DNA_UNAVAILABLE = "Label DNA is temporarily unavailable."


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
