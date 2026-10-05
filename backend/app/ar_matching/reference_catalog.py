"""Read-only, tenant-scoped reference metadata and Label DNA readiness queries.

This module is intentionally standalone: callers provide the verified label
identity, and importing it does not register API routes, startup work, or jobs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import and_, select
from sqlalchemy.exc import StatementError
from sqlmodel import Session

from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding
from app.audio.embedding.schemas import (
    EmbeddingMetadata,
    EmbeddingValidationError,
    TrackEmbedding,
)

MIN_VALID_REFERENCES = 5


class ReadinessState(StrEnum):
    """Catalog-only DNA readiness; provider/job availability is separate."""

    NO_DNA = "NO_DNA"
    BUILDING = "BUILDING"
    READY = "READY"


class CorruptReferenceEmbeddingError(ValueError):
    """A stored matching aggregate vector failed the public embedding contract."""


@dataclass(frozen=True, slots=True)
class ReferenceCatalogItem:
    """Metadata safe for label catalog display, without storage or vector data."""

    id: str
    title: str
    artist: str | None
    status: str
    is_active: bool
    duration_seconds: float | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class EligibleReferenceEmbedding:
    """A ready reference and its immutable, validated aggregate embedding."""

    reference_id: str
    title: str
    artist: str | None
    embedding: TrackEmbedding


@dataclass(frozen=True, slots=True)
class LabelDnaReadiness:
    """Read-only readiness snapshot for one label and exact embedding pipeline."""

    state: ReadinessState
    active_reference_count: int
    eligible_count: int
    minimum_valid_references: int
    eligible_references: tuple[EligibleReferenceEmbedding, ...]


def _validate_scope(label_id: str) -> None:
    if not isinstance(label_id, str) or not label_id.strip():
        raise ValueError("label_id must be a non-empty string")


def _validate_readiness_scope(
    label_id: str,
    metadata: EmbeddingMetadata,
    pipeline_version: str,
) -> None:
    _validate_scope(label_id)
    if not isinstance(metadata, EmbeddingMetadata):
        raise ValueError("metadata must be EmbeddingMetadata")
    if metadata.dimension != 512:
        raise ValueError("reference catalog embeddings require dimension 512")
    if not isinstance(pipeline_version, str) or not pipeline_version.strip():
        raise ValueError("pipeline_version must be a non-empty string")


def list_reference_catalog(session: Session, label_id: str) -> tuple[ReferenceCatalogItem, ...]:
    """List metadata for exactly one label, ordered by creation time then ID."""
    _validate_scope(label_id)
    with session.no_autoflush:
        rows = session.exec(
            select(
                LabelReferenceTrack.id,
                LabelReferenceTrack.title,
                LabelReferenceTrack.artist,
                LabelReferenceTrack.status,
                LabelReferenceTrack.is_active,
                LabelReferenceTrack.duration_seconds,
                LabelReferenceTrack.created_at,
                LabelReferenceTrack.updated_at,
            )
            .where(LabelReferenceTrack.label_id == label_id)
            .order_by(LabelReferenceTrack.created_at, LabelReferenceTrack.id)
        ).all()
    return tuple(ReferenceCatalogItem(*row) for row in rows)


def get_label_dna_readiness(
    session: Session,
    label_id: str,
    metadata: EmbeddingMetadata,
    pipeline_version: str,
) -> LabelDnaReadiness:
    """Snapshot active reference readiness for the exact stored model pipeline.

    Only active, ready reference-owned aggregate vectors count. Demo embeddings,
    segments, incompatible identities, and non-ready references are never used.
    This reports catalog readiness only; it does not assert provider availability
    or that a live OpenL3 inference has succeeded.
    """
    _validate_readiness_scope(label_id, metadata, pipeline_version)
    readiness_query = (
        select(
            LabelReferenceTrack.id.label("reference_id"),
            LabelReferenceTrack.title.label("reference_title"),
            LabelReferenceTrack.artist.label("reference_artist"),
            MusicEmbedding.id.label("embedding_id"),
            MusicEmbedding.embedding.label("embedding_vector"),
            MusicEmbedding.created_at.label("embedding_created_at"),
        )
        .select_from(LabelReferenceTrack)
        .outerjoin(
            MusicEmbedding,
            and_(
                MusicEmbedding.label_id == LabelReferenceTrack.label_id,
                MusicEmbedding.reference_track_id == LabelReferenceTrack.id,
                LabelReferenceTrack.status == "ready",
                MusicEmbedding.submission_id.is_(None),
                MusicEmbedding.segment_index == -1,
                MusicEmbedding.provider == metadata.provider,
                MusicEmbedding.model == metadata.model,
                MusicEmbedding.version == metadata.version,
                MusicEmbedding.dimension == 512,
                MusicEmbedding.pipeline_version == pipeline_version,
            ),
        )
        .where(
            LabelReferenceTrack.label_id == label_id,
            LabelReferenceTrack.is_active.is_(True),
        )
        .order_by(LabelReferenceTrack.created_at, LabelReferenceTrack.id, MusicEmbedding.id)
    )
    try:
        with session.no_autoflush:
            rows = session.exec(readiness_query).all()
    except ValueError as error:
        raise CorruptReferenceEmbeddingError(
            "a stored matching reference aggregate has an invalid vector"
        ) from error
    except StatementError as error:
        if isinstance(error.orig, ValueError):
            raise CorruptReferenceEmbeddingError(
                "a stored matching reference aggregate has an invalid vector"
            ) from error
        raise

    references: dict[str, tuple[str, str | None]] = {}
    eligible_by_reference: dict[str, EligibleReferenceEmbedding] = {}
    for row in rows:
        reference_id = row.reference_id
        references.setdefault(
            reference_id,
            (row.reference_title, row.reference_artist),
        )
        if row.embedding_id is None:
            continue
        created_at = row.embedding_created_at
        if created_at.tzinfo is None or created_at.utcoffset() is None:
            created_at = created_at.replace(tzinfo=UTC)
        try:
            embedding = TrackEmbedding(
                metadata=metadata,
                vector=row.embedding_vector,
                created_at=created_at,
            )
        except EmbeddingValidationError as error:
            raise CorruptReferenceEmbeddingError(
                f"stored aggregate for reference {reference_id} is invalid"
            ) from error
        if reference_id not in eligible_by_reference:
            title, artist = references[reference_id]
            eligible_by_reference[reference_id] = EligibleReferenceEmbedding(
                reference_id=reference_id,
                title=title,
                artist=artist,
                embedding=embedding,
            )

    active_count = len(references)
    if active_count == 0:
        return LabelDnaReadiness(ReadinessState.NO_DNA, 0, 0, MIN_VALID_REFERENCES, ())
    eligible = tuple(eligible_by_reference.values())
    state = (
        ReadinessState.READY if len(eligible) >= MIN_VALID_REFERENCES else ReadinessState.BUILDING
    )
    return LabelDnaReadiness(state, active_count, len(eligible), MIN_VALID_REFERENCES, eligible)
