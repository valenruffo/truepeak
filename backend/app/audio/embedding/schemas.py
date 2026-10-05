"""Immutable, provider-independent embedding metadata and value records."""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.ar_matching.similarity import normalized_centroid


class EmbeddingError(Exception):
    """Base exception for embedding contract and provider failures."""


class EmbeddingValidationError(EmbeddingError, ValueError):
    """An embedding value violates the provider-independent data contract."""


class IncompatibleEmbeddingError(EmbeddingValidationError):
    """Embeddings were produced by different provider/model identities."""


class EmbeddingProviderError(EmbeddingError):
    """A provider failed to generate an embedding for one input."""


@dataclass(frozen=True, slots=True)
class EmbeddingMetadata:
    """Stable identity and vector shape for one embedding model revision."""

    provider: str
    model: str
    version: str
    dimension: int

    def __post_init__(self) -> None:
        for name in ("provider", "model", "version"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise EmbeddingValidationError(f"{name} must be a non-empty string")
            object.__setattr__(self, name, value.strip())
        if isinstance(self.dimension, bool) or not isinstance(self.dimension, int):
            raise EmbeddingValidationError("dimension must be a positive integer")
        if self.dimension <= 0:
            raise EmbeddingValidationError("dimension must be a positive integer")

    def is_compatible_with(self, other: object) -> bool:
        """Return true only when every provider/model identity field matches."""
        return isinstance(other, EmbeddingMetadata) and (
            self.provider,
            self.model,
            self.version,
            self.dimension,
        ) == (other.provider, other.model, other.version, other.dimension)

    def require_compatible(self, other: EmbeddingMetadata) -> None:
        """Raise a typed error unless all identity fields and dimension match."""
        if not self.is_compatible_with(other):
            raise IncompatibleEmbeddingError(
                "embedding metadata is incompatible: provider, model, version, and dimension "
                "must all match"
            )


def _normalize_vector(values: Iterable[float], dimension: int) -> tuple[float, ...]:
    if isinstance(values, (str, bytes)):
        raise EmbeddingValidationError("embedding vector must be a numeric iterable")
    try:
        raw_values = tuple(values)
    except (TypeError, ValueError) as error:
        raise EmbeddingValidationError("embedding vector must be a numeric iterable") from error
    if len(raw_values) != dimension:
        raise EmbeddingValidationError(
            f"embedding vector dimension must be {dimension}; got {len(raw_values)}"
        )

    converted: list[float] = []
    for value in raw_values:
        if isinstance(value, (bool, str, bytes, complex)):
            raise EmbeddingValidationError("embedding vector values must be finite real numbers")
        try:
            number = float(value)
        except (TypeError, ValueError, OverflowError) as error:
            raise EmbeddingValidationError(
                "embedding vector values must be finite real numbers"
            ) from error
        if not math.isfinite(number):
            raise EmbeddingValidationError("embedding vector values must be finite real numbers")
        converted.append(number)

    if not converted or max(abs(value) for value in converted) == 0:
        raise EmbeddingValidationError("embedding vector must have a non-zero norm")
    try:
        # Share the established scale-safe unit-vector algorithm with Catalog Fit.
        return normalized_centroid((tuple(converted),))
    except ValueError as error:
        raise EmbeddingValidationError(f"embedding vector cannot be normalized: {error}") from error


def _validated_timestamp(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise EmbeddingValidationError("created_at must be a timezone-aware datetime")
    return value


def _validated_time_bound(value: float, *, name: str) -> float:
    if isinstance(value, (bool, str, bytes, complex)):
        raise EmbeddingValidationError(f"{name} must be finite and nonnegative")
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise EmbeddingValidationError(f"{name} must be finite and nonnegative") from error
    if not math.isfinite(result) or result < 0:
        raise EmbeddingValidationError(f"{name} must be finite and nonnegative")
    return result


@dataclass(frozen=True, slots=True)
class TrackEmbedding:
    """A normalized, model-versioned aggregate representation of a track."""

    metadata: EmbeddingMetadata
    vector: tuple[float, ...]
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def __post_init__(self) -> None:
        if not isinstance(self.metadata, EmbeddingMetadata):
            raise EmbeddingValidationError("metadata must be EmbeddingMetadata")
        object.__setattr__(self, "vector", _normalize_vector(self.vector, self.metadata.dimension))
        object.__setattr__(self, "created_at", _validated_timestamp(self.created_at))


@dataclass(frozen=True, slots=True)
class SegmentEmbedding:
    """A normalized embedding for one finite, non-empty track time interval."""

    metadata: EmbeddingMetadata
    vector: tuple[float, ...]
    start_seconds: float
    end_seconds: float
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def __post_init__(self) -> None:
        if not isinstance(self.metadata, EmbeddingMetadata):
            raise EmbeddingValidationError("metadata must be EmbeddingMetadata")
        object.__setattr__(self, "vector", _normalize_vector(self.vector, self.metadata.dimension))
        start = _validated_time_bound(self.start_seconds, name="start_seconds")
        end = _validated_time_bound(self.end_seconds, name="end_seconds")
        if end <= start:
            raise EmbeddingValidationError("segment end_seconds must be greater than start_seconds")
        object.__setattr__(self, "start_seconds", start)
        object.__setattr__(self, "end_seconds", end)
        object.__setattr__(self, "created_at", _validated_timestamp(self.created_at))
