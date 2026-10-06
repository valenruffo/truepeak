"""Compute-on-read label catalog fit scores (T05-S).

Scores every ready reference embedding of one label against a single query
embedding using the public, deterministic similarity primitives. All exposed
numbers are raw cosine-family similarities in [-1, 1]: they are NOT calibrated
0-100 probabilities, NOT musical-quality judgments, and NOT hit-or-sign
decisions. This module performs no writes, no caching, and no inference; it
never imports providers, decoders, or SDKs.

Demo/submission-arm embeddings are never scored because the readiness seam
only reads active, reference-owned aggregate vectors (``submission_id IS NULL``,
``segment_index == -1``, status ``ready``) for the exact metadata revision.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session

from app.ar_matching.reference_catalog import ReadinessState, get_label_dna_readiness
from app.ar_matching.similarity import catalog_fit, cosine_similarity
from app.audio.embedding.schemas import EmbeddingMetadata, TrackEmbedding


@dataclass(frozen=True, slots=True)
class CatalogFitScore:
    """One ready reference and its raw cosine similarity to the query embedding.

    ``score`` is the raw cosine value in [-1, 1], not a calibrated probability
    and not a per-track quality or hit judgment.
    """

    reference_id: str
    title: str
    artist: str | None
    score: float


@dataclass(frozen=True, slots=True)
class LabelCatalogFitResult:
    """Honest state mapping of one readiness snapshot to catalog fit scores.

    ``aggregate_score`` is the label-level raw Catalog Fit
    (``0.40 * cosine(query, centroid) + 0.60 * nearest_reference_similarity``);
    it is ``None`` with an empty ``scores`` tuple unless ``state`` is
    ``READY``, and it is never a calibrated 0-100 probability.
    """

    state: ReadinessState
    aggregate_score: float | None
    scores: tuple[CatalogFitScore, ...]
    active_reference_count: int
    eligible_count: int
    minimum_valid_references: int


def _canonical_label_id(value: object) -> str:
    """Return the label identity only when it is already a canonical UUID string."""
    try:
        if type(value) is str and str(UUID(value)) == value:
            return value
    except ValueError:
        pass
    raise ValueError("label_id must be a canonical UUID string")


def _validate_inputs(
    label_id: object,
    query_embedding: object,
    metadata: object,
    pipeline_version: object,
) -> str:
    """Validate the full call scope before any session access and return the id."""
    owner = _canonical_label_id(label_id)
    if type(query_embedding) is not TrackEmbedding:
        raise ValueError("query_embedding must be a TrackEmbedding")
    if type(metadata) is not EmbeddingMetadata:
        raise ValueError("metadata must be EmbeddingMetadata")
    if not isinstance(pipeline_version, str) or not pipeline_version.strip():
        raise ValueError("pipeline_version must be a non-empty string")
    return owner


def compute_label_catalog_fit(
    session: Session,
    label_id: str,
    query_embedding: TrackEmbedding,
    metadata: EmbeddingMetadata,
    pipeline_version: str,
    *,
    k: int = 3,
) -> LabelCatalogFitResult:
    """Score one label's ready reference embeddings against one query embedding.

    Read-only: the label's DNA readiness snapshot is read through
    ``get_label_dna_readiness`` for the exact metadata revision, so only
    active, ready, reference-owned aggregate vectors are ever scored and
    demo/submission-arm embeddings are excluded by that seam. Non-READY
    labels (``NO_DNA`` or ``BUILDING`` below five valid references) map to a
    typed no-score result, never an error. ``READY`` labels expose the raw
    aggregate ``catalog_fit(query, references, k)`` plus each reference's raw
    ``cosine_similarity`` in deterministic readiness order. All scores are raw
    cosine-family similarities, not calibrated 0-100 probabilities or quality
    judgments. ``CorruptReferenceEmbeddingError`` and similarity validation
    errors from the reused primitives propagate unchanged. No rows are added,
    changed, or removed and nothing is cached or persisted.
    """
    owner = _validate_inputs(label_id, query_embedding, metadata, pipeline_version)
    readiness = get_label_dna_readiness(session, owner, metadata, pipeline_version)
    counts = {
        "active_reference_count": readiness.active_reference_count,
        "eligible_count": readiness.eligible_count,
        "minimum_valid_references": readiness.minimum_valid_references,
    }
    if readiness.state is not ReadinessState.READY:
        return LabelCatalogFitResult(
            state=readiness.state,
            aggregate_score=None,
            scores=(),
            **counts,
        )

    reference_vectors = [item.embedding.vector for item in readiness.eligible_references]
    return LabelCatalogFitResult(
        state=readiness.state,
        aggregate_score=catalog_fit(query_embedding.vector, reference_vectors, k=k),
        scores=tuple(
            CatalogFitScore(
                reference_id=item.reference_id,
                title=item.title,
                artist=item.artist,
                score=cosine_similarity(query_embedding.vector, item.embedding.vector),
            )
            for item in readiness.eligible_references
        ),
        **counts,
    )
