"""Structural interface for replaceable music embedding providers."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.audio.embedding.schemas import EmbeddingMetadata, SegmentEmbedding, TrackEmbedding

# Opaque caller-supplied audio bytes: the contract fixes neither codec, sample
# rate, decoding strategy, nor retention policy.
type AudioInput = bytes


@runtime_checkable
class MusicEmbeddingProvider(Protocol):
    """Provider operations required by future isolated embedding workers."""

    def metadata(self) -> EmbeddingMetadata:
        """Return immutable identity metadata for outputs from this provider."""
        ...

    def generate_track_embedding(self, audio: AudioInput) -> TrackEmbedding:
        """Generate one aggregate representation from opaque audio input."""
        ...

    def generate_segment_embeddings(self, audio: AudioInput) -> tuple[SegmentEmbedding, ...]:
        """Generate timestamped segment representations from opaque audio input."""
        ...
