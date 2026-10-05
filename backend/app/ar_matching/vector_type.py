"""Lazy PostgreSQL pgvector type with an explicit SQLite test representation."""

from __future__ import annotations

import math
from collections.abc import Iterable

from sqlalchemy import JSON
from sqlalchemy.engine.interfaces import Dialect
from sqlalchemy.exc import CompileError
from sqlalchemy.types import TypeDecorator

from app.ar_matching.similarity import normalized_centroid


class Vector512(TypeDecorator[list[float]]):
    """Validate and normalize 512D vectors; use pgvector only on PostgreSQL.

    SQLite JSON storage exists strictly to exercise model constraints in local
    tests. Other dialects are rejected, and PostgreSQL never falls back to JSON
    when the optional pgvector adapter is unavailable.
    """

    impl = JSON
    cache_ok = True
    dimension = 512

    def load_dialect_impl(self, dialect: Dialect):
        if dialect.name == "sqlite":
            return dialect.type_descriptor(JSON())
        if dialect.name == "postgresql":
            try:
                from pgvector.sqlalchemy import VECTOR
            except ImportError as error:
                raise RuntimeError(
                    "pgvector is required for PostgreSQL Vector512 storage"
                ) from error
            return dialect.type_descriptor(VECTOR(self.dimension))
        raise CompileError(
            f"Vector512 supports PostgreSQL and SQLite test fixtures, not {dialect.name!r}"
        )

    def process_bind_param(self, value: Iterable[float], dialect: Dialect) -> list[float]:
        del dialect
        return _normalize_vector(value)

    def process_result_value(
        self, value: Iterable[float] | None, dialect: Dialect
    ) -> list[float] | None:
        del dialect
        if value is None:
            return None
        return _normalize_vector(value)


def _normalize_vector(value: Iterable[float]) -> list[float]:
    """Return a finite, non-zero unit vector with the fixed storage dimension."""
    if isinstance(value, (str, bytes, bytearray)):
        raise ValueError("embedding must be an iterable of 512 finite real numbers")
    try:
        values = tuple(value)
    except (TypeError, ValueError) as error:
        raise ValueError("embedding must be an iterable of 512 finite real numbers") from error
    if len(values) != Vector512.dimension:
        raise ValueError(f"embedding dimension must be {Vector512.dimension}; got {len(values)}")

    converted: list[float] = []
    for item in values:
        if isinstance(item, (bool, str, bytes, complex)):
            raise ValueError("embedding values must be finite real numbers")
        try:
            number = float(item)
        except (TypeError, ValueError, OverflowError) as error:
            raise ValueError("embedding values must be finite real numbers") from error
        if not math.isfinite(number):
            raise ValueError("embedding values must be finite real numbers")
        converted.append(number)

    try:
        return list(normalized_centroid((converted,)))
    except ValueError as error:
        raise ValueError(f"embedding must have a non-zero norm: {error}") from error
