"""Label catalog fit scores cache (T05-C2).

Sessions are caller-owned: nothing here commits or rolls back; persist only
flushes inside the caller's transaction. Only READY snapshots are cached. The
locked schema stores no title/artist and no active_reference_count, so hits
reconstruct the cache-shaped ``CachedLabelCatalogFit`` (reference ids, raw
cosine scores, eligible count, ``MIN_VALID_REFERENCES`` from the public
readiness constant) instead of a ``LabelCatalogFitResult`` that would
fabricate unknown fields. Scores stay raw cosine similarities in [-1, 1].
The eligible fingerprint is derived here per the storage-model and
migration-012 note: SHA-256 lowercase hex over sorted eligible reference ids
joined with newlines plus the max eligible ``music_embeddings.created_at``
as ISO-8601 UTC; a differing stored digest means stale eligibility.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from uuid import UUID

from sqlalchemy import and_, delete
from sqlmodel import Session, select

from app.ar_matching.catalog_fit_scores import LabelCatalogFitResult
from app.ar_matching.reference_catalog import MIN_VALID_REFERENCES, ReadinessState
from app.ar_matching.storage_models import (
    LabelCatalogFitScoreRow,
    LabelReferenceTrack,
    MusicEmbedding,
)
from app.audio.embedding.schemas import EmbeddingMetadata


@dataclass(frozen=True, slots=True)
class CachedCatalogFitScore:
    """One cached per-reference raw score; titles/artists are not stored."""

    reference_id: str
    score: float


@dataclass(frozen=True, slots=True)
class CachedLabelCatalogFit:
    """Honest cache hit in stored created_at/id order: only what the locked
    schema proves; ``active_reference_count`` is unknowable and never claimed."""

    state: ReadinessState
    aggregate_score: float
    scores: tuple[CachedCatalogFitScore, ...]
    eligible_count: int
    minimum_valid_references: int


def _canonical_id(field: str, value: object) -> str:
    try:
        if type(value) is str and str(UUID(value)) == value:
            return value
    except ValueError:
        pass
    raise ValueError(f"{field} must be a canonical UUID string")


def _validate_scope(
    label_id: object,
    query_submission_id: object,
    metadata: object,
    pipeline_version: object,
    k: object,
) -> tuple[str, str, dict]:
    """Validate the full call scope before any session access."""
    owner = _canonical_id("label_id", label_id)
    submission = _canonical_id("query_submission_id", query_submission_id)
    if type(metadata) is not EmbeddingMetadata:
        raise ValueError("metadata must be EmbeddingMetadata")
    if not isinstance(pipeline_version, str) or not pipeline_version.strip():
        raise ValueError("pipeline_version must be a non-empty string")
    if type(k) is not int or k < 1:
        raise ValueError("k must be an integer >= 1")
    return (
        owner,
        submission,
        {
            "label_id": label_id,
            "query_submission_id": query_submission_id,
            "provider": metadata.provider,
            "model": metadata.model,
            "version": metadata.version,
            "dimension": metadata.dimension,
            "pipeline_version": pipeline_version,
            "k": k,
        },
    )


def _identity_filter(identity: dict, *, aggregate: bool) -> list:
    null_test = (
        LabelCatalogFitScoreRow.reference_track_id.is_(None)
        if aggregate
        else LabelCatalogFitScoreRow.reference_track_id.is_not(None)
    )
    return [
        null_test,
        *(getattr(LabelCatalogFitScoreRow, column) == value for column, value in identity.items()),
    ]


def _eligible_fingerprint(session: Session, label_id: str, metadata, pipeline_version: str) -> str:
    """Fingerprint the label's CURRENT eligibility for the exact identity:
    reference-owned aggregate rows (submission arm and segments excluded) of
    active, ready references, mirroring the readiness seam's inputs."""
    rows = session.exec(
        select(LabelReferenceTrack.id, MusicEmbedding.created_at)
        .select_from(LabelReferenceTrack)
        .join(
            MusicEmbedding,
            and_(
                MusicEmbedding.label_id == LabelReferenceTrack.label_id,
                MusicEmbedding.reference_track_id == LabelReferenceTrack.id,
                MusicEmbedding.submission_id.is_(None),
                MusicEmbedding.segment_index == -1,
                MusicEmbedding.provider == metadata.provider,
                MusicEmbedding.model == metadata.model,
                MusicEmbedding.version == metadata.version,
                MusicEmbedding.dimension == 512,
                MusicEmbedding.pipeline_version == pipeline_version,
            ),
        )
        .where(
            LabelReferenceTrack.label_id == label_id,
            LabelReferenceTrack.is_active.is_(True),
            LabelReferenceTrack.status == "ready",
        )
    ).all()
    payload = ""
    if rows:
        ids = sorted(reference_id for reference_id, _created_at in rows)
        newest = max(created_at for _reference_id, created_at in rows)
        if newest.tzinfo is None or newest.utcoffset() is None:
            newest = newest.replace(tzinfo=UTC)  # SQLite round-trips drop the offset
        payload = "\n".join(ids) + "\n" + newest.astimezone(UTC).isoformat()
    return sha256(payload.encode("utf-8")).hexdigest()


def persist_label_catalog_fit(
    session: Session,
    *,
    label_id: str,
    query_submission_id: str,
    result: LabelCatalogFitResult,
    metadata: EmbeddingMetadata,
    pipeline_version: str,
    k: int,
) -> None:
    """Upsert one READY snapshot for the identity tuple (label, query
    submission, provider/model/version, dimension, pipeline_version, k).
    Validation precedes any session use; non-READY results raise with zero
    rows written. An existing aggregate row is updated in place (created_at
    preserved, updated_at re-stamped) and child rows are replaced via one
    immediate bulk delete plus fresh inserts in the same transaction, so the
    stored set exactly equals ``result.scores`` and the partial unique
    indexes can never trip. The caller owns commit and rollback."""
    owner, _submission, identity = _validate_scope(
        label_id, query_submission_id, metadata, pipeline_version, k
    )
    if type(result) is not LabelCatalogFitResult:
        raise ValueError("result must be a LabelCatalogFitResult")
    if result.state is not ReadinessState.READY:
        raise ValueError("only READY catalog fit results can be cached")
    fingerprint = _eligible_fingerprint(session, owner, metadata, pipeline_version)
    stamp = datetime.now(UTC)
    aggregate = session.exec(
        select(LabelCatalogFitScoreRow).where(*_identity_filter(identity, aggregate=True))
    ).first()
    if aggregate is None:
        session.add(
            LabelCatalogFitScoreRow(
                reference_track_id=None,
                score=result.aggregate_score,
                eligible_count=result.eligible_count,
                eligible_fingerprint=fingerprint,
                created_at=stamp,
                updated_at=stamp,
                **identity,
            )
        )
    else:
        aggregate.score = result.aggregate_score
        aggregate.eligible_count = result.eligible_count
        aggregate.eligible_fingerprint = fingerprint
        aggregate.updated_at = stamp
    session.execute(
        delete(LabelCatalogFitScoreRow).where(*_identity_filter(identity, aggregate=False))
    )
    session.add_all(
        [
            LabelCatalogFitScoreRow(
                reference_track_id=score.reference_id,
                score=score.score,
                eligible_count=result.eligible_count,
                eligible_fingerprint=fingerprint,
                created_at=stamp,
                updated_at=stamp,
                **identity,
            )
            for score in result.scores
        ]
    )
    session.flush()


def get_cached_label_catalog_fit(
    session: Session,
    *,
    label_id: str,
    query_submission_id: str,
    metadata: EmbeddingMetadata,
    pipeline_version: str,
    k: int,
) -> CachedLabelCatalogFit | None:
    """Read-only lookup for the exact identity tuple. ``None`` on a miss: no
    aggregate row, a stale eligible fingerprint (eligibility changed; the
    caller should recompute via ``compute_label_catalog_fit``), or a stored
    child count contradicting the aggregate. Hits reconstruct in stored
    created_at/id order; nothing is written."""
    owner, _submission, identity = _validate_scope(
        label_id, query_submission_id, metadata, pipeline_version, k
    )
    aggregate = session.exec(
        select(LabelCatalogFitScoreRow).where(*_identity_filter(identity, aggregate=True))
    ).first()
    if aggregate is None:
        return None
    if aggregate.eligible_fingerprint != _eligible_fingerprint(
        session, owner, metadata, pipeline_version
    ):
        return None
    children = session.exec(
        select(LabelCatalogFitScoreRow)
        .where(*_identity_filter(identity, aggregate=False))
        .order_by(LabelCatalogFitScoreRow.created_at, LabelCatalogFitScoreRow.id)
    ).all()
    if len(children) != aggregate.eligible_count:
        return None
    return CachedLabelCatalogFit(
        state=ReadinessState.READY,
        aggregate_score=aggregate.score,
        scores=tuple(
            CachedCatalogFitScore(reference_id=child.reference_track_id, score=child.score)
            for child in children
        ),
        eligible_count=aggregate.eligible_count,
        minimum_valid_references=MIN_VALID_REFERENCES,
    )
