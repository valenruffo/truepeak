"""Offline temporal ranking evaluation harness for label A&R decisions (T07).

**OFFLINE EVALUATION ONLY — THIS MODULE RANKS, IT NEVER DECIDES.** It
compares four ranking modes by how well each aligns with the label's
recorded HUMAN A&R decisions (``shortlist`` = relevant with binary gain 1,
``rejected`` = gain 0). Every number it exposes (precision@k, recall@k,
binary-gain NDCG@k) is a PREFERENCE-ALIGNMENT statistic over that closed
vocabulary. The metrics are NEVER musical-quality judgments, NEVER hit
probabilities, NEVER success forecasts, and NEVER calibrated 0-100 scores.
Nothing here auto-rejects, auto-hides, or deprioritizes a submission, and
nothing persists: the session is read-only end to end, with zero writes and
zero API surface.

**MODES.** ``CATALOG`` scores each evaluated decision's own sub-arm
aggregate as a query against the label's reference DNA via
``compute_label_catalog_fit(...).aggregate_score``. The reference set is the
CURRENT snapshot, not the snapshot at decision time — a documented v1
simplification. A non-READY label excludes every decision from catalog
metrics (counted, never substituted). ``ADAPTIVE`` scores each evaluated
decision with the label's preference computed at THAT decision's own time
(``now=decided_at`` with ``decided_before=decided_at``): a decision only
ever sees strictly-earlier decisions, so no decision can vote on its own
score — bias-free temporal evaluation. ``COLD_START`` / ``CANCELLED``
preferences exclude the decision from adaptive metrics only (counted). The
adaptive composition for v1 is preference-similarity alone
(``preference_similarity(preference, query_vector)``); the final score
composition belongs to T08. ``CHRONOLOGICAL`` ranks by ``decided_at``
ascending (earliest = rank 1) and has no score. ``RANDOM`` shuffles the
pool's deterministic baseline order (submission ids ascending) ONCE with
``random.Random(seed)`` and assigns ranks per that fixed permutation; it is
exactly reproducible for a given seed.

**COHORT, POOL, RANKING.** The cohort is the label's LATEST-decided
submissions (direct ``LabelArDecisionRow`` read ordered by ``decided_at``
then row id, last row wins; the ``ar_decisions`` service module is never
imported), bounded by ``as_of`` INCLUSIVELY: decisions at ``as_of`` count,
later ones never enter evaluation or preference inputs. The bound is
applied on UTC-repaired read-back values in Python so the boundary is
exact. A cohort decision without a matching sub-arm aggregate cannot be
scored or ranked by any mode: it is counted in every mode's ``excluded``
and keeps a row whose mode scores and ranks are all ``None``. The pool is
EVERY label submission holding a sub-arm aggregate for the exact metadata
identity, decided or not; ``pool_size`` counts it. Modes are computed
independently — an exclusion in one mode never removes a decision from
another mode's ranking (no substitution). Each mode ranks the evaluated
cohort decisions 1..n: catalog and adaptive by score descending with
``(decided_at, submission_id)`` tie-breaking, chronological by decided_at
ascending with the same ties, random by the fixed pool permutation.

**METRICS.** ``k`` is clipped to ``pool_size`` (the clip does not depend on
per-mode ranking length). ``precision_at_k`` = shortlisted decisions in the
mode's top-k divided by the clipped k (even when that ranking is shorter).
``recall_at_k`` = shortlisted in top-k divided by the total shortlisted
pool decisions across the cohort, mode-independent (``None`` when none are
shortlisted). NDCG@k uses binary gain: ``DCG = sum(1/log2(rank+1))`` over
shortlisted items in the top k and the ideal ordering (all shortlisted
first) for IDCG (``None`` when the ideal gain is zero). All three metrics
are ``None`` when the mode ranked nothing or the pool is empty. Rows include
ALL considered decisions ordered by ``(decided_at, submission_id)``.
Validation happens before the session is touched and uses the plain
``ValueError`` family consistent with adaptive_preference and
catalog_fit_scores. Behavior is SQLite-portable; PostgreSQL RLS and grants
are asserted structurally elsewhere.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlmodel import Session, select

from app.ar_matching.adaptive_preference import (
    LabelPreferenceState,
    compute_label_preference,
    preference_similarity,
)
from app.ar_matching.catalog_fit_scores import ReadinessState, compute_label_catalog_fit
from app.ar_matching.storage_models import LabelArDecisionRow, MusicEmbedding
from app.audio.embedding.schemas import EmbeddingMetadata, TrackEmbedding


class RankingMode(StrEnum):
    """The four evaluated ranking modes; values name the metrics fields."""

    CATALOG = "catalog"
    ADAPTIVE = "adaptive"
    CHRONOLOGICAL = "chronological"
    RANDOM = "random"


@dataclass(frozen=True, slots=True)
class RankingModeMetrics:
    """Preference-fit metrics for one mode over the evaluated cohort.

    Every metric is alignment with HUMAN shortlist/rejected vocabulary, not
    quality, hit probability, or any public-facing score.
    """

    mode: RankingMode
    evaluated: int
    excluded: int
    precision_at_k: float | None
    recall_at_k: float | None
    ndcg_at_k: float | None


@dataclass(frozen=True, slots=True)
class DecisionRankingRow:
    """One considered decision with its per-mode scores and ranks.

    ``None`` scores/ranks mean the mode excluded the decision; exclusions are
    per mode and never substitute another mode's outcome.
    """

    submission_id: str
    decided_at: datetime
    decision: str
    catalog_score: float | None
    adaptive_score: float | None
    catalog_rank: int | None
    adaptive_rank: int | None
    chronological_rank: int | None
    random_rank: int | None


@dataclass(frozen=True, slots=True)
class LabelRankingEvaluation:
    """Immutable offline comparison of the four ranking modes for one label."""

    label_id: str
    k: int
    pool_size: int
    decisions_considered: int
    catalog: RankingModeMetrics
    adaptive: RankingModeMetrics
    chronological: RankingModeMetrics
    random: RankingModeMetrics
    rows: tuple[DecisionRankingRow, ...]


def _as_utc(value: datetime) -> datetime:
    """Repair naive SQLite datetime read-back by attaching UTC."""
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=UTC)
    return value


def _require_canonical_label_id(value: object) -> str:
    if type(value) is str:
        try:
            if str(UUID(value)) == value:
                return value
        except ValueError:
            pass
    raise ValueError("label_id must be a canonical UUID string")


def _mode_metrics(
    mode: RankingMode,
    ranked_ids: list[str],
    decisions: dict[str, str],
    shortlisted_in_pool: int,
    considered_count: int,
    pool_size: int,
    k: int,
) -> RankingModeMetrics:
    """Compute one mode's metrics over its ranking (rank order preserved)."""
    evaluated = len(ranked_ids)
    excluded = considered_count - evaluated
    if evaluated == 0 or pool_size == 0:
        return RankingModeMetrics(
            mode=mode,
            evaluated=0,
            excluded=excluded,
            precision_at_k=None,
            recall_at_k=None,
            ndcg_at_k=None,
        )
    effective_k = min(k, pool_size)
    top_ids = ranked_ids[:effective_k]
    hits = sum(1 for sid in top_ids if decisions[sid] == "shortlist")
    dcg = sum(
        1.0 / math.log2(index + 2)
        for index, sid in enumerate(top_ids)
        if decisions[sid] == "shortlist"
    )
    ideal_length = min(shortlisted_in_pool, effective_k)
    idcg = sum(1.0 / math.log2(index + 2) for index in range(ideal_length))
    return RankingModeMetrics(
        mode=mode,
        evaluated=evaluated,
        excluded=excluded,
        precision_at_k=hits / effective_k,
        recall_at_k=hits / shortlisted_in_pool if shortlisted_in_pool > 0 else None,
        ndcg_at_k=dcg / idcg if idcg > 0 else None,
    )


def evaluate_label_rankings(
    session: Session,
    *,
    label_id: str,
    metadata: EmbeddingMetadata,
    pipeline_version: str,
    k: int = 3,
    as_of: datetime | None = None,
    seed: int = 0,
) -> LabelRankingEvaluation:
    """Evaluate four ranking modes against HUMAN decisions for one label.

    Offline and read-only: compares mode rankings by preference alignment of
    recorded shortlist/rejected decisions. See the module docstring for the
    locked cohort/pool semantics, the per-mode exclusions, the catalog
    current-snapshot simplification, and the preference-similarity-alone v1
    composition (final composition belongs to T08).
    """
    owner = _require_canonical_label_id(label_id)
    if type(metadata) is not EmbeddingMetadata:
        raise ValueError("metadata must be EmbeddingMetadata")
    if not isinstance(pipeline_version, str) or not pipeline_version.strip():
        raise ValueError("pipeline_version must be a non-empty string")
    if type(k) is not int or k < 1:
        raise ValueError("k must be an integer >= 1")
    if as_of is not None and (
        not isinstance(as_of, datetime) or as_of.tzinfo is None or as_of.utcoffset() is None
    ):
        raise ValueError("as_of must be None or a timezone-aware datetime")
    if type(seed) is not int:
        raise ValueError("seed must be an integer")

    decision_rows = session.exec(
        select(LabelArDecisionRow)
        .where(LabelArDecisionRow.label_id == owner)
        .order_by(LabelArDecisionRow.decided_at, LabelArDecisionRow.id)
    ).all()
    latest_by_submission: dict[str, LabelArDecisionRow] = {}
    for row in decision_rows:
        latest_by_submission[row.submission_id] = row
    cohort = {
        submission_id: row
        for submission_id, row in latest_by_submission.items()
        if as_of is None or _as_utc(row.decided_at) <= as_of
    }
    decisions = {submission_id: row.decision for submission_id, row in cohort.items()}

    aggregate_rows = session.exec(
        select(MusicEmbedding)
        .where(MusicEmbedding.label_id == owner)
        .where(MusicEmbedding.submission_id.is_not(None))
        .where(MusicEmbedding.reference_track_id.is_(None))
        .where(MusicEmbedding.segment_index == -1)
        .where(MusicEmbedding.provider == metadata.provider)
        .where(MusicEmbedding.model == metadata.model)
        .where(MusicEmbedding.version == metadata.version)
        .where(MusicEmbedding.dimension == metadata.dimension)
        .where(MusicEmbedding.pipeline_version == pipeline_version)
    ).all()
    aggregate_by_submission = {row.submission_id: row for row in aggregate_rows}
    pool_ids = sorted(aggregate_by_submission)
    pool_size = len(pool_ids)

    considered_ids = sorted(cohort, key=lambda sid: (_as_utc(cohort[sid].decided_at), sid))
    evaluated_ids = [sid for sid in considered_ids if sid in aggregate_by_submission]
    decided_ats = {sid: _as_utc(cohort[sid].decided_at) for sid in evaluated_ids}
    queries = {
        sid: TrackEmbedding(
            metadata=metadata,
            vector=tuple(float(value) for value in aggregate_by_submission[sid].embedding),
            created_at=_as_utc(aggregate_by_submission[sid].created_at),
        )
        for sid in evaluated_ids
    }

    catalog_scores: dict[str, float] = {}
    for sid in evaluated_ids:
        fit = compute_label_catalog_fit(session, owner, queries[sid], metadata, pipeline_version)
        if fit.state is ReadinessState.READY and fit.aggregate_score is not None:
            catalog_scores[sid] = fit.aggregate_score

    adaptive_scores: dict[str, float] = {}
    for sid in evaluated_ids:
        decided_at = decided_ats[sid]
        preference = compute_label_preference(
            session,
            label_id=owner,
            metadata=metadata,
            pipeline_version=pipeline_version,
            now=decided_at,
            decided_before=decided_at,
        )
        if preference.state is not LabelPreferenceState.READY or preference.preference is None:
            continue
        adaptive_scores[sid] = preference_similarity(preference.preference, queries[sid].vector)

    def _ranks_by_score_desc(scores: dict[str, float]) -> dict[str, int]:
        ordered = sorted(scores, key=lambda sid: (-scores[sid], decided_ats[sid], sid))
        return {sid: rank for rank, sid in enumerate(ordered, start=1)}

    catalog_ranks = _ranks_by_score_desc(catalog_scores)
    adaptive_ranks = _ranks_by_score_desc(adaptive_scores)
    chronological_ranks = {
        sid: rank
        for rank, sid in enumerate(
            sorted(evaluated_ids, key=lambda sid: (decided_ats[sid], sid)), start=1
        )
    }
    permutation = list(pool_ids)
    random.Random(seed).shuffle(permutation)
    pool_position = {sid: position for position, sid in enumerate(permutation)}
    random_ranks = {
        sid: rank
        for rank, sid in enumerate(sorted(evaluated_ids, key=pool_position.__getitem__), start=1)
    }

    shortlisted_in_pool = sum(1 for sid in evaluated_ids if decisions[sid] == "shortlist")
    metrics_inputs = (decisions, shortlisted_in_pool, len(considered_ids), pool_size, k)
    evaluation_metrics = {
        RankingMode.CATALOG: _mode_metrics(
            RankingMode.CATALOG, list(catalog_ranks), *metrics_inputs
        ),
        RankingMode.ADAPTIVE: _mode_metrics(
            RankingMode.ADAPTIVE, list(adaptive_ranks), *metrics_inputs
        ),
        RankingMode.CHRONOLOGICAL: _mode_metrics(
            RankingMode.CHRONOLOGICAL, list(chronological_ranks), *metrics_inputs
        ),
        RankingMode.RANDOM: _mode_metrics(RankingMode.RANDOM, list(random_ranks), *metrics_inputs),
    }

    rows = tuple(
        DecisionRankingRow(
            submission_id=sid,
            decided_at=_as_utc(cohort[sid].decided_at),
            decision=decisions[sid],
            catalog_score=catalog_scores.get(sid),
            adaptive_score=adaptive_scores.get(sid),
            catalog_rank=catalog_ranks.get(sid),
            adaptive_rank=adaptive_ranks.get(sid),
            chronological_rank=chronological_ranks.get(sid),
            random_rank=random_ranks.get(sid),
        )
        for sid in considered_ids
    )
    return LabelRankingEvaluation(
        label_id=owner,
        k=k,
        pool_size=pool_size,
        decisions_considered=len(considered_ids),
        catalog=evaluation_metrics[RankingMode.CATALOG],
        adaptive=evaluation_metrics[RankingMode.ADAPTIVE],
        chronological=evaluation_metrics[RankingMode.CHRONOLOGICAL],
        random=evaluation_metrics[RankingMode.RANDOM],
        rows=rows,
    )
