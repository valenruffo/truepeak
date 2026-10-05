"""Deterministic, provider-independent primitives for internal Catalog Fit math.

These functions compare label-specific sonic representations only: their raw
similarity scores are not probabilities, musical-quality judgments, or public
0–100 calibrated Fit scores. They do not rank, bucket, persist, or make signing
or rejection decisions. Callers own provider compatibility and any product or
storage boundaries.

Centroid inputs are L2-normalized before averaging so every reference has equal
contribution regardless of its original embedding magnitude. A centroid whose
mean direction has norm at most 1e-12 is treated as cancelled/undefined. Catalog
Fit weights must be finite, nonnegative, and sum to one within an absolute
1e-9 tolerance.
"""

from __future__ import annotations

import math
from collections.abc import Iterable

_CENTROID_NORM_TOLERANCE = 1e-12
_WEIGHT_SUM_TOLERANCE = 1e-9


def _as_vector(vector: Iterable[float], *, name: str) -> tuple[float, ...]:
    """Materialize and validate one non-empty finite, non-zero 1-D vector."""
    if isinstance(vector, (str, bytes)):
        raise ValueError(f"{name} must be a one-dimensional numeric vector")

    try:
        values = tuple(vector)
    except TypeError as error:
        raise ValueError(f"{name} must be a one-dimensional numeric vector") from error

    if not values:
        raise ValueError(f"{name} must not be empty")

    converted: list[float] = []
    for value in values:
        if isinstance(value, (bool, str, bytes, complex)):
            raise ValueError(f"{name} must contain only finite real numbers")
        try:
            number = float(value)
        except (TypeError, ValueError, OverflowError) as error:
            raise ValueError(f"{name} must contain only finite real numbers") from error
        if not math.isfinite(number):
            raise ValueError(f"{name} must contain only finite real numbers")
        converted.append(number)

    result = tuple(converted)
    if max(abs(value) for value in result) == 0:
        raise ValueError(f"{name} must have non-zero L2 norm")
    return result


def _unit_vector(vector: tuple[float, ...]) -> tuple[float, ...]:
    """Scale by max absolute value before norming to handle finite extremes."""
    scale = max(abs(value) for value in vector)
    scaled = tuple(value / scale for value in vector)
    scaled_norm = math.hypot(*scaled)
    return tuple(value / scaled_norm for value in scaled)


def _same_dimension(left: tuple[float, ...], right: tuple[float, ...]) -> None:
    if len(left) != len(right):
        raise ValueError(f"vectors must have matching dimensions; got {len(left)} and {len(right)}")


def _materialize_references(
    references: Iterable[Iterable[float]],
) -> tuple[Iterable[float], ...]:
    if isinstance(references, (str, bytes)):
        raise ValueError("references must contain at least one reference vector")
    try:
        result = tuple(tuple(reference) for reference in references)
    except TypeError as error:
        raise ValueError("references must contain one-dimensional vectors") from error
    if not result:
        raise ValueError("references must contain at least one reference vector")
    return result


def _validated_weight(weight: float, *, name: str) -> float:
    if isinstance(weight, (bool, str, bytes, complex)):
        raise ValueError(f"Catalog Fit weights require {name} to be finite and nonnegative")
    try:
        result = float(weight)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError(
            f"Catalog Fit weights require {name} to be finite and nonnegative"
        ) from error
    if not math.isfinite(result) or result < 0:
        raise ValueError(f"Catalog Fit weights require {name} to be finite and nonnegative")
    return result


def cosine_similarity(left: Iterable[float], right: Iterable[float]) -> float:
    """Return cosine similarity for two finite, non-zero, equal-size 1-D vectors.

    The result is a raw value in [-1, 1]; negative similarity is valid. Empty,
    non-finite, zero-norm, non-1-D, or dimension-mismatched inputs raise
    ``ValueError``.
    """
    left_vector = _as_vector(left, name="left vector")
    right_vector = _as_vector(right, name="right vector")
    _same_dimension(left_vector, right_vector)

    left_unit = _unit_vector(left_vector)
    right_unit = _unit_vector(right_vector)
    similarity = math.fsum(
        left_value * right_value
        for left_value, right_value in zip(left_unit, right_unit, strict=True)
    )
    # Floating-point roundoff can put a mathematically valid cosine just outside
    # its closed interval; clamp only that numerical drift.
    return max(-1.0, min(1.0, similarity))


def normalized_centroid(vectors: Iterable[Iterable[float]]) -> tuple[float, ...]:
    """Return the unit L2 centroid after normalizing each input vector first.

    At least one finite, non-zero vector is required; every vector must be 1-D
    and have the same dimension. A cancelled or numerically undefined mean
    direction raises ``ValueError``.
    """
    try:
        raw_vectors = tuple(vectors)
    except TypeError as error:
        raise ValueError("centroid requires at least one vector") from error
    if not raw_vectors:
        raise ValueError("centroid requires at least one vector")

    validated: list[tuple[float, ...]] = []
    for index, raw_vector in enumerate(raw_vectors):
        vector = _as_vector(raw_vector, name=f"vector {index}")
        if validated:
            _same_dimension(validated[0], vector)
        validated.append(vector)

    unit_vectors = [_unit_vector(vector) for vector in validated]
    mean_direction = tuple(
        math.fsum(vector[dimension] for vector in unit_vectors) / len(unit_vectors)
        for dimension in range(len(validated[0]))
    )
    mean_norm = math.hypot(*mean_direction)
    if mean_norm <= _CENTROID_NORM_TOLERANCE:
        raise ValueError("centroid is cancelled or has an undefined mean direction")
    return tuple(value / mean_norm for value in mean_direction)


def nearest_reference_similarity(
    query: Iterable[float],
    references: Iterable[Iterable[float]],
    *,
    k: int = 3,
) -> float:
    """Return the mean of the query's nearest ``k`` reference cosine values.

    If fewer than ``k`` references are available, all available references are
    used. ``k`` must be a positive integer. Reference order breaks equal-score
    ties deterministically; only the scalar mean is exposed.
    """
    if isinstance(k, bool) or not isinstance(k, int) or k <= 0:
        raise ValueError("k must be a positive integer")

    query_vector = _as_vector(query, name="query vector")
    raw_references = _materialize_references(references)
    similarities = [cosine_similarity(query_vector, reference) for reference in raw_references]
    nearest = sorted(similarities, reverse=True)[:k]
    return math.fsum(nearest) / len(nearest)


def catalog_fit(
    query: Iterable[float],
    references: Iterable[Iterable[float]],
    *,
    k: int = 3,
    centroid_weight: float = 0.40,
    nearest_weight: float = 0.60,
) -> float:
    """Return configurable raw Catalog Fit from centroid and nearest similarity.

    The formula is ``centroid_weight * cosine(query, centroid) +
    nearest_weight * nearest_reference_similarity(query, references, k)``.
    Defaults are 0.40 and 0.60. Weights must be finite and nonnegative and
    sum to one within the documented absolute 1e-9 tolerance. The result is
    internal raw similarity, not probability or calibrated 0–100 public Fit.
    """
    validated_centroid_weight = _validated_weight(centroid_weight, name="centroid weight")
    validated_nearest_weight = _validated_weight(nearest_weight, name="nearest weight")
    if not math.isclose(
        validated_centroid_weight + validated_nearest_weight,
        1.0,
        rel_tol=0.0,
        abs_tol=_WEIGHT_SUM_TOLERANCE,
    ):
        raise ValueError("Catalog Fit weights must sum to one within absolute tolerance 1e-9")

    query_vector = _as_vector(query, name="query vector")
    raw_references = _materialize_references(references)
    centroid = normalized_centroid(raw_references)
    centroid_similarity = cosine_similarity(query_vector, centroid)
    nearest_similarity = nearest_reference_similarity(query_vector, raw_references, k=k)
    return (
        validated_centroid_weight * centroid_similarity
        + validated_nearest_weight * nearest_similarity
    )
