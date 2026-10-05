"""Provider-independent music embedding contracts and normalized pooling."""

from app.audio.embedding.pooling import pool_segment_embeddings
from app.audio.embedding.provider import AudioInput, MusicEmbeddingProvider
from app.audio.embedding.schemas import (
    EmbeddingError,
    EmbeddingMetadata,
    EmbeddingProviderError,
    EmbeddingValidationError,
    IncompatibleEmbeddingError,
    SegmentEmbedding,
    TrackEmbedding,
)

__all__ = [
    "AudioInput",
    "EmbeddingError",
    "EmbeddingMetadata",
    "EmbeddingProviderError",
    "EmbeddingValidationError",
    "IncompatibleEmbeddingError",
    "MusicEmbeddingProvider",
    "SegmentEmbedding",
    "TrackEmbedding",
    "pool_segment_embeddings",
]
