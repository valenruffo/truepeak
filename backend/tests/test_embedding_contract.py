from __future__ import annotations

import math
from dataclasses import FrozenInstanceError
from datetime import UTC, datetime

import pytest

from app.audio.embedding import (
    EmbeddingMetadata,
    EmbeddingProviderError,
    EmbeddingValidationError,
    IncompatibleEmbeddingError,
    MusicEmbeddingProvider,
    SegmentEmbedding,
    TrackEmbedding,
    pool_segment_embeddings,
)


@pytest.fixture
def metadata() -> EmbeddingMetadata:
    return EmbeddingMetadata(provider="fake", model="tiny-test", version="1", dimension=2)


def segment(
    metadata: EmbeddingMetadata,
    vector: tuple[float, ...] | list[float],
    *,
    start: float = 0.0,
    end: float = 1.0,
) -> SegmentEmbedding:
    return SegmentEmbedding(metadata, vector, start, end)


def test_metadata_is_immutable_validated_and_keeps_all_identity_fields(
    metadata: EmbeddingMetadata,
) -> None:
    assert metadata.is_compatible_with(EmbeddingMetadata("fake", "tiny-test", "1", 2))
    with pytest.raises(FrozenInstanceError):
        metadata.model = "changed"  # type: ignore[misc]

    for provider, model, version, dimension in [
        (" ", "model", "v1", 2),
        ("provider", "\t", "v1", 2),
        ("provider", "model", "", 2),
        ("provider", "model", "v1", 0),
        ("provider", "model", "v1", True),
        ("provider", "model", "v1", 2.0),
    ]:
        with pytest.raises(EmbeddingValidationError):
            EmbeddingMetadata(provider, model, version, dimension)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "changes",
    [
        {"provider": "other"},
        {"model": "other"},
        {"version": "2"},
        {"dimension": 3},
    ],
)
def test_pool_rejects_every_incompatible_model_identity_field(
    metadata: EmbeddingMetadata, changes: dict[str, object]
) -> None:
    values: dict[str, object] = {
        "provider": metadata.provider,
        "model": metadata.model,
        "version": metadata.version,
        "dimension": metadata.dimension,
    }
    values.update(changes)
    other_metadata = EmbeddingMetadata(**values)  # type: ignore[arg-type]

    incompatible_vector = (0, 1) if other_metadata.dimension == 2 else (0, 1, 0)
    with pytest.raises(IncompatibleEmbeddingError):
        pool_segment_embeddings(
            (segment(metadata, (1, 0)), segment(other_metadata, incompatible_vector))
        )


def test_embedding_records_validate_normalize_and_are_immutable(
    metadata: EmbeddingMetadata,
) -> None:
    source = [3.0, 4.0]
    item = segment(metadata, source, start=0.25, end=2.5)
    source[0] = 100.0

    assert item.vector == pytest.approx((0.6, 0.8))
    assert item.start_seconds == 0.25
    assert item.end_seconds == 2.5
    assert item.created_at.tzinfo is UTC
    with pytest.raises(FrozenInstanceError):
        item.vector = (1.0, 0.0)  # type: ignore[misc]
    with pytest.raises(FrozenInstanceError):
        TrackEmbedding(metadata, (1, 0)).vector = (0.0, 1.0)  # type: ignore[misc]


@pytest.mark.parametrize(
    "vector",
    [(), (0.0, 0.0), (math.inf, 1), (math.nan, 1), (-math.inf, 1), (1, "bad")],
)
def test_embedding_records_reject_empty_zero_nonfinite_and_non_numeric_vectors(
    metadata: EmbeddingMetadata, vector: object
) -> None:
    with pytest.raises(EmbeddingValidationError):
        TrackEmbedding(metadata, vector)  # type: ignore[arg-type]


def test_embedding_records_reject_dimension_mismatch(metadata: EmbeddingMetadata) -> None:
    with pytest.raises(EmbeddingValidationError, match="dimension"):
        TrackEmbedding(metadata, (1, 0, 0))


def test_scale_safe_normalization_supports_huge_and_tiny_finite_vectors(
    metadata: EmbeddingMetadata,
) -> None:
    huge = 1.7e308
    tiny = 5e-324

    assert TrackEmbedding(metadata, (huge, huge)).vector == pytest.approx(
        (1 / math.sqrt(2), 1 / math.sqrt(2))
    )
    assert TrackEmbedding(metadata, (tiny, tiny)).vector == pytest.approx(
        (1 / math.sqrt(2), 1 / math.sqrt(2))
    )


@pytest.mark.parametrize(
    "start,end",
    [(-0.1, 1.0), (math.nan, 1.0), (0.0, math.inf), (1.0, 1.0), (2.0, 1.0)],
)
def test_segment_embedding_rejects_invalid_time_bounds(
    metadata: EmbeddingMetadata, start: float, end: float
) -> None:
    with pytest.raises(EmbeddingValidationError):
        segment(metadata, (1, 0), start=start, end=end)


def test_pool_normalizes_each_segment_before_mean_even_for_one_shot_iterables(
    metadata: EmbeddingMetadata,
) -> None:
    pooled = pool_segment_embeddings(
        segment(metadata, vector) for vector in ((100.0, 0.0), (0.0, 1.0))
    )
    component = 1 / math.sqrt(2)

    assert pooled.vector == pytest.approx((component, component))
    assert pooled.metadata is metadata
    assert pooled.created_at.tzinfo is UTC


def test_pooling_one_segment_preserves_its_normalized_direction(
    metadata: EmbeddingMetadata,
) -> None:
    only = segment(metadata, (3.0, 4.0))

    assert pool_segment_embeddings(iter((only,))).vector == pytest.approx((0.6, 0.8))


@pytest.mark.parametrize("segments", [(), iter(())])
def test_pooling_rejects_empty_iterables(segments: object, metadata: EmbeddingMetadata) -> None:
    with pytest.raises(EmbeddingValidationError, match="at least one"):
        pool_segment_embeddings(segments)  # type: ignore[arg-type]


def test_pooling_rejects_cancelled_mean_explicitly(metadata: EmbeddingMetadata) -> None:
    with pytest.raises(EmbeddingValidationError, match="cancel"):
        pool_segment_embeddings((segment(metadata, (1, 0)), segment(metadata, (-1, 0))))


class FakeProvider:
    """A contract fixture only; this deliberately performs no model inference."""

    def metadata(self) -> EmbeddingMetadata:
        return EmbeddingMetadata("fake", "fixture", "test", 2)

    def generate_track_embedding(self, audio: bytes) -> TrackEmbedding:
        assert audio == b"opaque audio input"
        return TrackEmbedding(self.metadata(), (1, 0))

    def generate_segment_embeddings(self, audio: bytes) -> tuple[SegmentEmbedding, ...]:
        assert audio == b"opaque audio input"
        return (SegmentEmbedding(self.metadata(), (1, 0), 0.0, 1.0),)


def test_provider_protocol_is_substitutable_without_real_inference() -> None:
    provider: MusicEmbeddingProvider = FakeProvider()
    audio = b"opaque audio input"

    assert provider.metadata().provider == "fake"
    assert provider.generate_track_embedding(audio).vector == (1.0, 0.0)
    assert len(provider.generate_segment_embeddings(audio)) == 1
    assert issubclass(EmbeddingProviderError, Exception)


def test_timestamps_must_be_timezone_aware(metadata: EmbeddingMetadata) -> None:
    with pytest.raises(EmbeddingValidationError, match="timezone-aware"):
        TrackEmbedding(metadata, (1, 0), created_at=datetime(2025, 1, 1))
