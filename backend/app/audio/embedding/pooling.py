"""Provider-independent normalized mean pooling for segment embeddings."""

from __future__ import annotations

from collections.abc import Iterable

from app.ar_matching.similarity import normalized_centroid
from app.audio.embedding.schemas import (
    EmbeddingValidationError,
    SegmentEmbedding,
    TrackEmbedding,
)


def pool_segment_embeddings(segments: Iterable[SegmentEmbedding]) -> TrackEmbedding:
    """Normalize each segment, average their directions, then normalize the mean.

    The normalized centroid helper supplies scale-safe arithmetic and rejects a
    cancelled mean. Empty input and provider identity mismatches are explicit
    validation failures; embeddings are never silently mixed.
    """
    if isinstance(segments, (str, bytes)):
        raise EmbeddingValidationError("pooling requires at least one segment embedding")
    try:
        materialized = tuple(segments)
    except (TypeError, ValueError) as error:
        raise EmbeddingValidationError("segments must be an iterable of embeddings") from error
    if not materialized:
        raise EmbeddingValidationError("pooling requires at least one segment embedding")
    if any(not isinstance(segment, SegmentEmbedding) for segment in materialized):
        raise EmbeddingValidationError("pooling accepts only SegmentEmbedding values")

    metadata = materialized[0].metadata
    for segment in materialized[1:]:
        metadata.require_compatible(segment.metadata)

    try:
        vector = normalized_centroid(segment.vector for segment in materialized)
    except ValueError as error:
        raise EmbeddingValidationError(f"segment embeddings cannot be pooled: {error}") from error
    return TrackEmbedding(metadata, vector)
