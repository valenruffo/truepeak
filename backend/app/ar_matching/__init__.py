"""Internal deterministic primitives for label-specific Catalog Fit math."""

from .similarity import (
    catalog_fit,
    cosine_similarity,
    nearest_reference_similarity,
    normalized_centroid,
)

__all__ = [
    "catalog_fit",
    "cosine_similarity",
    "nearest_reference_similarity",
    "normalized_centroid",
]
