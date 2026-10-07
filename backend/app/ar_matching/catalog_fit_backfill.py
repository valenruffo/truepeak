"""Resumable catalog-fit cache backfill (T05-B).

THIS IS THE CATALOG-FIT CACHE BACKFILL — NOT the reference-processing resume
seam: no claims, leases, receipts, tokens, or operator policies exist here,
and there is no API or flag surface. Resumability is implicit: every
committed item self-skips on the next pass because
``get_cached_label_catalog_fit`` validates the stored eligible fingerprint,
so a partially completed backfill resumes by simply running again. The loop
is sequential and single-writer (the documented concurrency bound; SQLite is
a single-writer database): one work item, one owned session, one transaction
— no pools, no threads.

Work items are exactly the GIVEN label's submission-arm aggregate embeddings
(``reference_track_id IS NULL``, ``submission_id`` set, aggregate
``segment_index == -1``) with the exact provider/model/version/dimension/
pipeline_version identity, ordered deterministically by ``(created_at, id)``.
No other label is ever scanned; reference-arm rows are never query items.

``limit`` bounds ATTEMPTS after fresh-cache skips: a compute attempt, a
non-READY verdict, or a recorded failure consumes the budget, while a cache
hit does not — so a re-run over already-committed items finishes under any
limit. Item-level data failures are recorded as ``CatalogFitBackfillFailure``
with a stable ``error_kind`` and the loop continues without cache writes;
infrastructure errors (``StatementError`` with a non-``ValueError`` origin,
or any other ``SQLAlchemyError``) propagate immediately, losing only the
in-progress pass — the committed prefix survives and resume self-skips it.
"Keep failed embeddings usable" is inherited unchanged: the readiness seam's
ready filter already excludes failed references; no new logic is added.
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC
from uuid import UUID

from sqlalchemy.exc import StatementError
from sqlmodel import Session, select

from app.ar_matching.catalog_fit_cache import (
    get_cached_label_catalog_fit,
    persist_label_catalog_fit,
)
from app.ar_matching.catalog_fit_scores import compute_label_catalog_fit
from app.ar_matching.reference_catalog import CorruptReferenceEmbeddingError, ReadinessState
from app.ar_matching.storage_models import MusicEmbedding
from app.audio.embedding.schemas import (
    EmbeddingMetadata,
    EmbeddingValidationError,
    TrackEmbedding,
)

SessionFactory = Callable[[], AbstractContextManager[Session]]

_CORRUPT_REFERENCE = "corrupt_reference_embedding"
_RECONSTRUCTION = "embedding_reconstruction"
_SIMILARITY = "similarity_validation"


@dataclass(frozen=True, slots=True)
class CatalogFitBackfillFailure:
    """One swallowed item-level failure; ``error_kind`` is a stable short string."""

    submission_id: str
    error_kind: str  # stable short kind string, see the module constants below


@dataclass(frozen=True, slots=True)
class CatalogFitBackfillResult:
    """Honest counters: ``processed`` equals cache hits + attempts + failures."""

    processed: int
    cache_hits: int
    computed: int
    persisted: int
    not_ready: int
    failures: tuple[CatalogFitBackfillFailure, ...]


def _validate_scope(
    label_id: object,
    metadata: object,
    pipeline_version: object,
    k: object,
    limit: object,
    session_factory: object,
) -> str:
    """Validate the full call scope before any session is opened."""
    try:
        if type(label_id) is str and str(UUID(label_id)) == label_id:
            owner = label_id
        else:
            raise ValueError
    except ValueError:
        raise ValueError("label_id must be a canonical UUID string") from None
    if type(metadata) is not EmbeddingMetadata:
        raise ValueError("metadata must be EmbeddingMetadata")
    if (
        type(pipeline_version) is not str
        or not pipeline_version
        or pipeline_version.strip() != pipeline_version
    ):
        raise ValueError("pipeline_version must be a non-blank string without whitespace padding")
    if type(k) is not int or k < 1:
        raise ValueError("k must be an integer >= 1")
    if limit is not None and (type(limit) is not int or limit < 1):
        raise ValueError("limit must be None or an integer >= 1")
    if not callable(session_factory):
        raise ValueError("session_factory must be a callable returning a session context manager")
    return owner


def _work_item_query(owner: str, metadata: EmbeddingMetadata, pipeline_version: str):
    """Deterministic (created_at, id) scan of this label's submission arms only."""
    return (
        select(MusicEmbedding.id, MusicEmbedding.submission_id)
        .where(
            MusicEmbedding.label_id == owner,
            MusicEmbedding.reference_track_id.is_(None),
            MusicEmbedding.submission_id.is_not(None),
            MusicEmbedding.segment_index == -1,
            MusicEmbedding.provider == metadata.provider,
            MusicEmbedding.model == metadata.model,
            MusicEmbedding.version == metadata.version,
            MusicEmbedding.dimension == 512,
            MusicEmbedding.pipeline_version == pipeline_version,
        )
        .order_by(MusicEmbedding.created_at, MusicEmbedding.id)
    )


def _load_query_embedding(
    session: Session, embedding_id: str, metadata: EmbeddingMetadata
) -> TrackEmbedding:
    """Rebuild the stored aggregate as a TrackEmbedding; ValueError means the
    stored row data is corrupt (reconstruction failure kind)."""
    try:
        row = session.get(MusicEmbedding, embedding_id)
    except (ValueError, StatementError) as error:
        if isinstance(error, StatementError) and not isinstance(error.orig, ValueError):
            raise  # genuine infrastructure failure, never swallowed
        raise ValueError("stored query embedding vector is invalid") from error
    if row is None:
        raise ValueError("stored query embedding row disappeared mid-pass")
    created_at = row.created_at
    if created_at.tzinfo is None or created_at.utcoffset() is None:
        created_at = created_at.replace(tzinfo=UTC)  # SQLite round-trips drop the offset
    try:
        return TrackEmbedding(metadata=metadata, vector=row.embedding, created_at=created_at)
    except EmbeddingValidationError as error:
        raise ValueError(f"stored query embedding is invalid: {error}") from error


def backfill_label_catalog_fit(
    *,
    label_id: str,
    metadata: EmbeddingMetadata,
    pipeline_version: str,
    k: int = 3,
    limit: int | None = None,
    session_factory: SessionFactory,
) -> CatalogFitBackfillResult:
    """Backfill the catalog-fit cache for one label's submission-arm work items.

    See the module docstring for the loud not-the-resume-seam boundary, the
    work-item identity, the single-writer bound, and ``limit`` semantics.
    Each item commits before ``persisted`` is counted, so a commit failure
    never inflates the count.
    """
    owner = _validate_scope(label_id, metadata, pipeline_version, k, limit, session_factory)
    failures: list[CatalogFitBackfillFailure] = []
    cache_hits = computed = persisted = not_ready_count = processed = 0
    with session_factory() as session:
        items = session.exec(_work_item_query(owner, metadata, pipeline_version)).all()
    for embedding_id, query_submission_id in items:
        if limit is not None and computed + not_ready_count + len(failures) >= limit:
            break
        with session_factory() as session:
            cached = get_cached_label_catalog_fit(
                session,
                label_id=owner,
                query_submission_id=query_submission_id,
                metadata=metadata,
                pipeline_version=pipeline_version,
                k=k,
            )
            if cached is not None:
                cache_hits += 1
                processed += 1
                continue
            try:
                query_embedding = _load_query_embedding(session, embedding_id, metadata)
            except ValueError:
                failures.append(CatalogFitBackfillFailure(query_submission_id, _RECONSTRUCTION))
                processed += 1
                continue
            try:
                result = compute_label_catalog_fit(
                    session, owner, query_embedding, metadata, pipeline_version, k=k
                )
            except CorruptReferenceEmbeddingError:
                failures.append(CatalogFitBackfillFailure(query_submission_id, _CORRUPT_REFERENCE))
                processed += 1
                continue
            except ValueError:
                failures.append(CatalogFitBackfillFailure(query_submission_id, _SIMILARITY))
                processed += 1
                continue
            if result.state is not ReadinessState.READY:
                not_ready_count += 1
                processed += 1
                continue
            persist_label_catalog_fit(
                session,
                label_id=owner,
                query_submission_id=query_submission_id,
                result=result,
                metadata=metadata,
                pipeline_version=pipeline_version,
                k=k,
            )
            session.commit()
            computed += 1
            persisted += 1
            processed += 1
    return CatalogFitBackfillResult(
        processed=processed,
        cache_hits=cache_hits,
        computed=computed,
        persisted=persisted,
        not_ready=not_ready_count,
        failures=tuple(failures),
    )
