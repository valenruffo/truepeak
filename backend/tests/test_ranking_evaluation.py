"""SQLite behavior tests for the T07 temporal ranking evaluation harness.

Covers app.ar_matching.ranking_evaluation: the four ranking modes (catalog /
adaptive / chronological / random) evaluated against HUMAN shortlist vs
rejected decisions, with hand-computed precision@k / recall@k / binary-gain
NDCG@k goldens, as_of inclusive cohort bounding, per-decision temporal
preference inputs via decided_before, cold-start / exact-cancel adaptive
exclusions, deterministic seeding, raw catalog score parity with the direct
seam, no-mutation, tenant isolation, pipeline identity separation, and
validation. SQLite only; no PostgreSQL, RLS, concurrency, or inference
claims, and no quality / hit-probability semantics anywhere.
"""

from __future__ import annotations

import dataclasses
import math
import random
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.ar_matching.catalog_fit_scores import compute_label_catalog_fit
from app.ar_matching.ranking_evaluation import (
    DecisionRankingRow,
    LabelRankingEvaluation,
    RankingMode,
    RankingModeMetrics,
    evaluate_label_rankings,
)
from app.ar_matching.storage_models import (
    LabelArDecisionRow,
    LabelCatalogFitScoreRow,
    LabelReferenceTrack,
    MusicEmbedding,
)
from app.audio.embedding.schemas import EmbeddingMetadata, TrackEmbedding
from app.models import Label, Notification, Submission

_METADATA = EmbeddingMetadata("test-provider", "test-model", "v1", 512)
_PIPELINE_VERSION = "prep-v1"
_NOW = datetime(2025, 6, 1, tzinfo=UTC)
_DAY = timedelta(days=1)
_CANONICAL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
_UPPERCASE_ID = "3FA85F64-5717-4562-B3FC-2C963F66AFA6"

_TABLES = [
    Label.__table__,
    Submission.__table__,
    LabelReferenceTrack.__table__,
    MusicEmbedding.__table__,
    LabelArDecisionRow.__table__,
    LabelCatalogFitScoreRow.__table__,
    Notification.__table__,
]
_ROW_MODELS = [Label, Submission, LabelReferenceTrack, MusicEmbedding]
_ROW_MODELS += [LabelArDecisionRow, LabelCatalogFitScoreRow, Notification]
_SCOPE = {
    "label_id": _CANONICAL_ID,
    "metadata": _METADATA,
    "pipeline_version": _PIPELINE_VERSION,
}


@pytest.fixture
def session():
    test_engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(test_engine, "connect")
    def _enable_foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(test_engine, tables=_TABLES)
    with Session(test_engine) as db_session:
        yield db_session
    test_engine.dispose()


def _dir(x: float, y: float) -> list[float]:
    return [x, y, *([0.0] * 510)]


def _seed_label(session: Session, suffix: str) -> Label:
    token = str(uuid4())
    label = Label(
        id=token,
        name=f"Label {suffix}",
        slug=f"label-{suffix}-{token}",
        owner_email=f"{token}@example.test",
    )
    session.add(label)
    session.flush()
    return label


def _seed_submission(
    session: Session, label: Label, suffix: str, submission_id: str | None = None
) -> Submission:
    submission = Submission(
        id=submission_id or str(uuid4()),
        label_id=label.id,
        producer_name="Producer",
        producer_email=f"{uuid4()}@example.test",
        track_name=f"Track {suffix}",
    )
    session.add(submission)
    session.flush()
    return submission


def _add_aggregate(session: Session, label: Label, submission: Submission, vector) -> None:
    session.add(
        MusicEmbedding(
            label_id=label.id,
            reference_track_id=None,
            submission_id=submission.id,
            embedding=list(vector),
            provider=_METADATA.provider,
            model=_METADATA.model,
            version=_METADATA.version,
            dimension=_METADATA.dimension,
            pipeline_version=_PIPELINE_VERSION,
            segment_index=-1,
            created_at=_NOW,
        )
    )


def _seed_ready_references(session: Session, label: Label, vector) -> None:
    """Five active ready reference aggregates -> catalog READY for the label."""
    for index in range(5):
        reference = LabelReferenceTrack(
            label_id=label.id,
            title=f"Reference {index}",
            status="ready",
            is_active=True,
        )
        session.add(reference)
        session.flush()
        session.add(
            MusicEmbedding(
                label_id=label.id,
                reference_track_id=reference.id,
                submission_id=None,
                embedding=list(vector),
                provider=_METADATA.provider,
                model=_METADATA.model,
                version=_METADATA.version,
                dimension=_METADATA.dimension,
                pipeline_version=_PIPELINE_VERSION,
                segment_index=-1,
                created_at=_NOW,
            )
        )


def _add_decision(
    session: Session,
    submission: Submission,
    decision: str,
    decided_at: datetime,
) -> None:
    session.add(
        LabelArDecisionRow(
            label_id=submission.label_id,
            submission_id=submission.id,
            decision=decision,
            decided_by="reviewer-1",
            decided_at=decided_at,
        )
    )


def _eval(session: Session, label_id: str, **overrides):
    return evaluate_label_rankings(session, **{**_SCOPE, "label_id": label_id, **overrides})


def _all_modes(evaluation: LabelRankingEvaluation) -> tuple[RankingModeMetrics, ...]:
    return evaluation.catalog, evaluation.adaptive, evaluation.chronological, evaluation.random


def _seed_golden_label(session: Session):
    """Six-item pool: three unit(0,1) shortlist bases @-10d, then unit(0,1)
    shortlist @-2d, unit(1,0) shortlist @-1d, unit(0,-1) rejected @now,
    against five unit(0,1) references. The bases lift every later decision
    over the locked cold_start_minimum=3 gate."""
    label = _seed_label(session, "golden")
    _seed_ready_references(session, label, _dir(0.0, 1.0))
    bases = []
    for index in range(3):
        base = _seed_submission(session, label, f"golden-base-{index}")
        _add_aggregate(session, label, base, _dir(0.0, 1.0))
        _add_decision(session, base, "shortlist", _NOW - 10 * _DAY)
        bases.append(base)
    s1 = _seed_submission(session, label, "golden-s1")
    s2 = _seed_submission(session, label, "golden-s2")
    s3 = _seed_submission(session, label, "golden-s3")
    _add_aggregate(session, label, s1, _dir(0.0, 1.0))
    _add_aggregate(session, label, s2, _dir(1.0, 0.0))
    _add_aggregate(session, label, s3, _dir(0.0, -1.0))
    _add_decision(session, s1, "shortlist", _NOW - 2 * _DAY)
    _add_decision(session, s2, "shortlist", _NOW - _DAY)
    _add_decision(session, s3, "rejected", _NOW)
    session.commit()
    return label, (bases, s1, s2, s3)


def _rows_by_submission(evaluation: LabelRankingEvaluation) -> dict[str, DecisionRankingRow]:
    return {row.submission_id: row for row in evaluation.rows}


def test_locked_surface_values_and_frozen_dataclasses():
    assert issubclass(RankingMode, StrEnum)
    assert [mode.value for mode in RankingMode] == [
        "catalog",
        "adaptive",
        "chronological",
        "random",
    ]
    assert [field.name for field in dataclasses.fields(RankingModeMetrics)] == [
        "mode",
        "evaluated",
        "excluded",
        "precision_at_k",
        "recall_at_k",
        "ndcg_at_k",
    ]
    assert [field.name for field in dataclasses.fields(DecisionRankingRow)] == [
        "submission_id",
        "decided_at",
        "decision",
        "catalog_score",
        "adaptive_score",
        "catalog_rank",
        "adaptive_rank",
        "chronological_rank",
        "random_rank",
    ]
    assert [field.name for field in dataclasses.fields(LabelRankingEvaluation)] == [
        "label_id",
        "k",
        "pool_size",
        "decisions_considered",
        "catalog",
        "adaptive",
        "chronological",
        "random",
        "rows",
    ]
    metrics = RankingModeMetrics(RankingMode.CATALOG, 0, 0, None, None, None)
    with pytest.raises(dataclasses.FrozenInstanceError):
        metrics.evaluated = 1
    row = DecisionRankingRow("s", _NOW, "shortlist", None, None, None, None, None, None)
    with pytest.raises(dataclasses.FrozenInstanceError):
        row.decision = "rejected"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"label_id": "not-a-uuid"},
        {"label_id": _UPPERCASE_ID},
        {"label_id": None},
        {"metadata": "nope"},
        {"pipeline_version": ""},
        {"pipeline_version": "   "},
        {"k": 0},
        {"k": -1},
        {"k": True},
        {"k": 2.0},
        {"as_of": datetime(2025, 6, 1)},
        {"as_of": "2025-06-01"},
        {"seed": True},
        {"seed": 2.0},
        {"seed": "x"},
    ],
)
def test_validation_rejects_invalid_scope(session, kwargs):
    with pytest.raises(ValueError):
        _eval(session, **{**_SCOPE, **kwargs})


def test_validation_runs_before_any_statement(session):
    statements: list[str] = []
    engine = session.get_bind()

    def _count(connection, cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _count)
    try:
        for kwargs in (
            {"label_id": "not-a-uuid"},
            {"metadata": "nope"},
            {"pipeline_version": "   "},
            {"k": 0},
            {"as_of": datetime(2025, 6, 1)},
            {"seed": True},
        ):
            with pytest.raises(ValueError):
                _eval(session, **{**_SCOPE, **kwargs})
    finally:
        event.remove(engine, "before_cursor_execute", _count)
    assert statements == []


def test_six_item_pool_hand_computed_goldens(session):
    label, (bases, s1, s2, s3) = _seed_golden_label(session)
    bases_sorted = sorted(bases, key=lambda base: base.id)
    golden_ids = [base.id for base in bases_sorted] + [s1.id, s2.id, s3.id]

    evaluation = _eval(session, label.id, k=3)

    assert (evaluation.label_id, evaluation.k, evaluation.pool_size) == (label.id, 3, 6)
    assert evaluation.decisions_considered == 6
    assert [row.submission_id for row in evaluation.rows] == golden_ids
    assert [row.decision for row in evaluation.rows] == ["shortlist"] * 5 + ["rejected"]
    rows = _rows_by_submission(evaluation)

    assert [rows[base.id].catalog_score for base in bases_sorted] == pytest.approx([1.0, 1.0, 1.0])
    assert rows[s2.id].catalog_score == pytest.approx(0.0)
    assert rows[s3.id].catalog_score == pytest.approx(-1.0)
    assert [rows[base.id].catalog_rank for base in bases_sorted] == [1, 2, 3]
    assert [rows[sid].catalog_rank for sid in (s1.id, s2.id, s3.id)] == [4, 5, 6]
    assert (evaluation.catalog.evaluated, evaluation.catalog.excluded) == (6, 0)
    assert evaluation.catalog.precision_at_k == pytest.approx(1.0)
    assert evaluation.catalog.recall_at_k == pytest.approx(0.6)
    assert evaluation.catalog.ndcg_at_k == pytest.approx(1.0)

    assert all(rows[base.id].adaptive_score is None for base in bases)
    assert all(rows[base.id].adaptive_rank is None for base in bases)
    weight_base = math.exp(-math.log(2.0) * 10.0 / 30.0)
    weight_s1 = math.exp(-math.log(2.0) * 2.0 / 30.0)
    weight_s2 = math.exp(-math.log(2.0) / 30.0)
    y_component = 3.0 * weight_base + weight_s1
    assert rows[s1.id].adaptive_score == pytest.approx(1.0)
    assert rows[s2.id].adaptive_score == pytest.approx(0.0)
    expected_s3 = -y_component / math.hypot(weight_s2, y_component)
    assert rows[s3.id].adaptive_score == pytest.approx(expected_s3)
    assert [rows[sid].adaptive_rank for sid in (s1.id, s2.id, s3.id)] == [1, 2, 3]
    assert (evaluation.adaptive.evaluated, evaluation.adaptive.excluded) == (3, 3)
    assert evaluation.adaptive.precision_at_k == pytest.approx(2 / 3)
    assert evaluation.adaptive.recall_at_k == pytest.approx(0.4)
    ideal = 1.0 + 1.0 / math.log2(3.0) + 1.0 / math.log2(4.0)
    adaptive_gain = 1.0 / math.log2(2.0) + 1.0 / math.log2(3.0)
    assert evaluation.adaptive.ndcg_at_k == pytest.approx(adaptive_gain / ideal)

    assert [rows[base.id].chronological_rank for base in bases_sorted] == [1, 2, 3]
    assert [rows[sid].chronological_rank for sid in (s1.id, s2.id, s3.id)] == [4, 5, 6]
    assert evaluation.chronological.precision_at_k == pytest.approx(1.0)
    assert evaluation.chronological.recall_at_k == pytest.approx(0.6)
    assert evaluation.chronological.ndcg_at_k == pytest.approx(1.0)

    pool_ids = sorted(golden_ids)
    permutation = list(pool_ids)
    random.Random(0).shuffle(permutation)
    position = {sid: index for index, sid in enumerate(permutation)}
    expected_random = {
        sid: rank for rank, sid in enumerate(sorted(pool_ids, key=position.__getitem__), start=1)
    }
    assert {sid: rows[sid].random_rank for sid in pool_ids} == expected_random


def test_catalog_and_adaptive_align_when_directions_match(session):
    label = _seed_label(session, "align")
    _seed_ready_references(session, label, _dir(1.0, 0.0))
    for index in range(3):
        base = _seed_submission(session, label, f"align-base-{index}")
        _add_aggregate(session, label, base, _dir(1.0, 0.0))
        _add_decision(session, base, "shortlist", _NOW - _DAY)
    queries = []
    for index, (vector, decision) in enumerate(
        (
            (_dir(1.0, 0.0), "shortlist"),
            (_dir(0.0, 1.0), "rejected"),
            (_dir(-1.0, 0.0), "rejected"),
        )
    ):
        query = _seed_submission(session, label, f"align-q{index}")
        _add_aggregate(session, label, query, vector)
        _add_decision(session, query, decision, _NOW)
        queries.append(query)
    session.commit()

    evaluation = _eval(session, label.id, k=3)
    rows = _rows_by_submission(evaluation)

    for query in queries:
        assert rows[query.id].catalog_score == pytest.approx(rows[query.id].adaptive_score)
    catalog_order = sorted(queries, key=lambda item: rows[item.id].catalog_rank)
    adaptive_order = sorted(queries, key=lambda item: rows[item.id].adaptive_rank)
    assert [item.id for item in catalog_order] == [item.id for item in adaptive_order]


def test_adaptive_beats_catalog_rank_one_vs_rank_two(session):
    label = _seed_label(session, "beats")
    _seed_ready_references(session, label, _dir(1.0, 0.0))
    for index in range(3):
        base = _seed_submission(session, label, f"beats-base-{index}")
        _add_aggregate(session, label, base, _dir(0.0, 1.0))
        _add_decision(session, base, "shortlist", _NOW - _DAY)
    winner = _seed_submission(session, label, "beats-win")
    loser = _seed_submission(session, label, "beats-lose")
    misc = _seed_submission(session, label, "beats-misc")
    _add_aggregate(session, label, winner, _dir(0.0, 1.0))
    _add_aggregate(session, label, loser, _dir(1.0, 0.0))
    _add_aggregate(session, label, misc, _dir(0.0, -1.0))
    _add_decision(session, winner, "shortlist", _NOW)
    _add_decision(session, loser, "rejected", _NOW)
    _add_decision(session, misc, "shortlist", _NOW)
    session.commit()

    evaluation = _eval(session, label.id, k=3)
    rows = _rows_by_submission(evaluation)

    assert rows[winner.id].adaptive_rank == 1
    assert rows[loser.id].adaptive_rank == 2
    assert rows[misc.id].adaptive_rank == 3
    assert rows[loser.id].catalog_rank == 1
    assert rows[winner.id].catalog_rank >= evaluation.pool_size - 1
    ideal = 1.0 + 1.0 / math.log2(3.0) + 1.0 / math.log2(4.0)
    adaptive_gain = 1.0 / math.log2(2.0) + 1.0 / math.log2(4.0)
    catalog_gain = 1.0 / math.log2(3.0) + 1.0 / math.log2(4.0)
    assert evaluation.adaptive.ndcg_at_k == pytest.approx(adaptive_gain / ideal)
    assert evaluation.catalog.ndcg_at_k == pytest.approx(catalog_gain / ideal)
    assert evaluation.adaptive.ndcg_at_k > evaluation.catalog.ndcg_at_k
    assert evaluation.adaptive.ndcg_at_k - evaluation.catalog.ndcg_at_k == pytest.approx(
        (adaptive_gain - catalog_gain) / ideal
    )


def test_rejected_at_top_misalignment_and_log2_discount(session):
    label = _seed_label(session, "misalign")
    _seed_ready_references(session, label, _dir(1.0, 0.0))
    top_rejected = _seed_submission(session, label, "mis-top")
    second_shortlist = _seed_submission(session, label, "mis-second")
    _add_aggregate(session, label, top_rejected, _dir(1.0, 0.0))
    _add_aggregate(session, label, second_shortlist, _dir(0.0, 1.0))
    _add_decision(session, top_rejected, "rejected", _NOW)
    _add_decision(session, second_shortlist, "shortlist", _NOW)
    session.commit()

    evaluation = _eval(session, label.id, k=2)
    rows = _rows_by_submission(evaluation)

    assert rows[top_rejected.id].catalog_rank == 1
    assert rows[second_shortlist.id].catalog_rank == 2
    assert evaluation.catalog.precision_at_k == pytest.approx(1 / 2)
    assert evaluation.catalog.recall_at_k == pytest.approx(1.0)
    assert evaluation.catalog.ndcg_at_k == pytest.approx(1.0 / math.log2(3.0))

    tight = _eval(session, label.id, k=1)
    assert tight.catalog.precision_at_k == pytest.approx(0.0)
    assert tight.catalog.recall_at_k == pytest.approx(0.0)
    assert tight.catalog.ndcg_at_k == pytest.approx(0.0)


def test_decay_flip_preference_temporal_bounding_golden(session):
    label = _seed_label(session, "flip")
    _seed_ready_references(session, label, _dir(1.0, 0.0))
    for index in range(3):
        old = _seed_submission(session, label, f"flip-old-{index}")
        _add_aggregate(session, label, old, _dir(1.0, 0.0))
        _add_decision(session, old, "shortlist", _NOW - 90 * _DAY)
    for index in range(4):
        rejection = _seed_submission(session, label, f"flip-rej-{index}")
        _add_aggregate(session, label, rejection, _dir(1.0, 0.0))
        _add_decision(session, rejection, "rejected", _NOW - 3 * _DAY)
    early_query = _seed_submission(session, label, "flip-early")
    late_query = _seed_submission(session, label, "flip-late")
    _add_aggregate(session, label, early_query, _dir(1.0, 0.0))
    _add_aggregate(session, label, late_query, _dir(1.0, 0.0))
    _add_decision(session, early_query, "shortlist", _NOW - 45 * _DAY)
    _add_decision(session, late_query, "rejected", _NOW)
    session.commit()

    evaluation = _eval(session, label.id, k=3)
    rows = _rows_by_submission(evaluation)

    assert rows[early_query.id].adaptive_score == pytest.approx(1.0)
    late_weight = (
        3.0 * math.exp(-math.log(2.0) * 90.0 / 30.0)
        + math.exp(-math.log(2.0) * 45.0 / 30.0)
        - 4.0 * 0.25 * math.exp(-math.log(2.0) * 3.0 / 30.0)
    )
    assert late_weight < 0.0
    assert rows[late_query.id].adaptive_score == pytest.approx(-1.0)
    assert rows[early_query.id].adaptive_rank == 1


def test_as_of_excludes_later_decisions_and_bounds_preference_inputs(session):
    label = _seed_label(session, "asof")
    _seed_ready_references(session, label, _dir(1.0, 0.0))
    for index in range(3):
        base = _seed_submission(session, label, f"asof-base-{index}")
        _add_aggregate(session, label, base, _dir(1.0, 0.0))
        _add_decision(session, base, "shortlist", _NOW - 5 * _DAY)
    early = _seed_submission(session, label, "asof-early")
    late = _seed_submission(session, label, "asof-late")
    _add_aggregate(session, label, early, _dir(1.0, 0.0))
    _add_aggregate(session, label, late, _dir(1.0, 0.0))
    _add_decision(session, early, "shortlist", _NOW - _DAY)
    _add_decision(session, late, "shortlist", _NOW)
    session.commit()

    bounded = _eval(session, label.id, as_of=_NOW - _DAY, k=3)
    full = _eval(session, label.id, k=3)

    # as_of bounds the COHORT (late's @now decision drops out, pool unchanged)
    # while preference inputs stay bounded per item by decided_before.
    assert bounded.decisions_considered == 4
    assert bounded.pool_size == 5
    assert all(row.submission_id != late.id for row in bounded.rows)
    assert _rows_by_submission(bounded)[early.id].adaptive_rank == 1

    assert full.decisions_considered == 5
    full_rows = _rows_by_submission(full)
    assert full_rows[early.id].adaptive_rank == 1
    assert full_rows[late.id].adaptive_rank == 2
    assert full_rows[late.id].adaptive_score == pytest.approx(1.0)


def test_as_of_boundary_is_inclusive(session):
    label = _seed_label(session, "edge")
    _seed_ready_references(session, label, _dir(1.0, 0.0))
    at_boundary = _seed_submission(session, label, "edge-at")
    after = _seed_submission(session, label, "edge-after")
    for submission in (at_boundary, after):
        _add_aggregate(session, label, submission, _dir(1.0, 0.0))
    _add_decision(session, at_boundary, "shortlist", _NOW)
    _add_decision(session, after, "shortlist", _NOW + timedelta(microseconds=1))
    session.commit()

    inclusive = _eval(session, label.id, as_of=_NOW, k=3)
    exclusive = _eval(session, label.id, as_of=_NOW - timedelta(microseconds=1), k=3)

    assert inclusive.decisions_considered == 1
    assert inclusive.rows[0].submission_id == at_boundary.id
    assert exclusive.decisions_considered == 0
    assert exclusive.rows == ()
    for metrics in _all_modes(exclusive):
        assert metrics.evaluated == 0
        assert metrics.precision_at_k is None


def test_k_changes_metrics_not_rows(session):
    label, _ = _seed_golden_label(session)

    wide = _eval(session, label.id, k=3)
    narrow = _eval(session, label.id, k=1)

    assert wide.rows == narrow.rows
    assert wide.catalog.precision_at_k == pytest.approx(1.0)
    assert narrow.catalog.precision_at_k == pytest.approx(1.0)
    assert narrow.catalog.recall_at_k == pytest.approx(0.2)
    assert narrow.catalog.ndcg_at_k == pytest.approx(1.0)
    assert wide.adaptive.precision_at_k == pytest.approx(2 / 3)
    assert narrow.adaptive.precision_at_k == pytest.approx(1.0)
    assert narrow.adaptive.recall_at_k == pytest.approx(0.2)


def test_k_beyond_pool_size_is_clipped(session):
    label, _ = _seed_golden_label(session)

    clipped = _eval(session, label.id, k=10)
    reference = _eval(session, label.id, k=6)

    assert clipped.k == 10
    assert clipped.pool_size == 6
    # k=10 clips to pool_size=6: metrics equal an explicit k=6 call exactly.
    assert clipped.rows == reference.rows
    for mode in _all_modes(clipped):
        exact_mode = getattr(reference, mode.mode.value)
        assert mode.precision_at_k == pytest.approx(exact_mode.precision_at_k)
        assert mode.recall_at_k == pytest.approx(exact_mode.recall_at_k)
        assert mode.ndcg_at_k == pytest.approx(exact_mode.ndcg_at_k)


def test_latest_wins_decision_recount(session):
    label = _seed_label(session, "latest")
    _seed_ready_references(session, label, _dir(1.0, 0.0))
    submission = _seed_submission(session, label, "latest")
    _add_aggregate(session, label, submission, _dir(1.0, 0.0))
    _add_decision(session, submission, "shortlist", _NOW - 2 * _DAY)
    _add_decision(session, submission, "rejected", _NOW - _DAY)
    session.commit()

    evaluation = _eval(session, label.id, k=3)

    assert evaluation.decisions_considered == 1
    assert len(evaluation.rows) == 1
    row = evaluation.rows[0]
    assert row.decision == "rejected"
    # Adaptive is COLD_START (single earlier decision < cold_start_minimum 3):
    # the locked exclusion rule keeps the rank None instead of substituting.
    assert (row.catalog_rank, row.chronological_rank, row.random_rank) == (1, 1, 1)
    assert row.adaptive_rank is None
    assert (evaluation.adaptive.evaluated, evaluation.adaptive.excluded) == (0, 1)


def test_cold_start_and_exact_cancel_excluded_from_adaptive_only(session):
    cold_label = _seed_label(session, "cold")
    _seed_ready_references(session, cold_label, _dir(1.0, 0.0))
    for index in range(2):
        base = _seed_submission(session, cold_label, f"cold-base-{index}")
        _add_aggregate(session, cold_label, base, _dir(1.0, 0.0))
        _add_decision(session, base, "shortlist", _NOW - _DAY)
    cold_query = _seed_submission(session, cold_label, "cold-query")
    _add_aggregate(session, cold_label, cold_query, _dir(1.0, 0.0))
    _add_decision(session, cold_query, "shortlist", _NOW)
    cancelled_label = _seed_label(session, "cancel")
    _seed_ready_references(session, cancelled_label, _dir(1.0, 0.0))
    for index, decision in enumerate(("shortlist", "rejected", "rejected", "rejected", "rejected")):
        base = _seed_submission(session, cancelled_label, f"cancel-base-{index}")
        _add_aggregate(session, cancelled_label, base, _dir(1.0, 0.0))
        _add_decision(session, base, decision, _NOW - _DAY)
    cancel_query = _seed_submission(session, cancelled_label, "cancel-query")
    _add_aggregate(session, cancelled_label, cancel_query, _dir(1.0, 0.0))
    _add_decision(session, cancel_query, "shortlist", _NOW)
    session.commit()

    cold = _eval(session, cold_label.id, k=3)
    cancelled = _eval(session, cancelled_label.id, k=3)

    for evaluation in (cold, cancelled):
        assert evaluation.adaptive.evaluated == 0
        assert evaluation.adaptive.excluded == evaluation.decisions_considered
        assert evaluation.adaptive.precision_at_k is None
        assert evaluation.adaptive.recall_at_k is None
        assert evaluation.adaptive.ndcg_at_k is None
        assert evaluation.rows[-1].adaptive_rank is None
    assert cold.catalog.evaluated == 3
    assert cancelled.catalog.evaluated == 6


def test_cohort_decision_without_aggregate_excluded_everywhere_and_counted(session):
    label = _seed_label(session, "noagg")
    _seed_ready_references(session, label, _dir(1.0, 0.0))
    naked = _seed_submission(session, label, "noagg")
    _add_decision(session, naked, "shortlist", _NOW - _DAY)
    session.commit()

    evaluation = _eval(session, label.id, k=3)

    assert evaluation.decisions_considered == 1
    assert evaluation.pool_size == 0
    row = evaluation.rows[0]
    assert (row.catalog_score, row.adaptive_score) == (None, None)
    assert (row.catalog_rank, row.adaptive_rank) == (None, None)
    assert (row.chronological_rank, row.random_rank) == (None, None)
    for metrics in _all_modes(evaluation):
        assert (metrics.evaluated, metrics.excluded) == (0, 1)
        assert metrics.precision_at_k is None
        assert metrics.recall_at_k is None
        assert metrics.ndcg_at_k is None


def test_four_mode_orderings_distinct_and_chronological_ascending(session):
    label = _seed_label(session, "modes")
    _seed_ready_references(session, label, _dir(1.0, 0.0))
    for index in range(3):
        base = _seed_submission(
            session,
            label,
            f"modes-base-{index}",
            submission_id=str(uuid5(NAMESPACE_URL, f"t07-modes-base-{index}")),
        )
        _add_aggregate(session, label, base, _dir(0.0, 1.0))
        _add_decision(session, base, "shortlist", _NOW - 50 * _DAY)
    specs = (
        ("modes-a", _dir(0.0, 1.0), "shortlist", 40),
        ("modes-b", _dir(1.0, 0.0), "rejected", 30),
        ("modes-c", _dir(0.0, -1.0), "rejected", 20),
        ("modes-d", _dir(0.0, 1.0), "rejected", 10),
    )
    queries = []
    for name, vector, decision, age_days in specs:
        # Fixed ids make the Random(seed) pool permutation stable across runs,
        # so the four-way ordering-distinctness assertion is deterministic.
        query = _seed_submission(
            session, label, name, submission_id=str(uuid5(NAMESPACE_URL, f"t07-{name}"))
        )
        _add_aggregate(session, label, query, vector)
        _add_decision(session, query, decision, _NOW - age_days * _DAY)
        queries.append(query)
    session.commit()

    evaluation = _eval(session, label.id, k=4, seed=1)
    rows = _rows_by_submission(evaluation)

    def _order(mode: str) -> tuple[str, ...]:
        return tuple(sorted((q.id for q in queries), key=lambda sid: getattr(rows[sid], mode)))

    modes = ("adaptive_rank", "catalog_rank", "chronological_rank", "random_rank")
    orderings = {_order(mode) for mode in modes}
    assert len(orderings) == 4
    expected_chronological = tuple(
        q.id for q in sorted(queries, key=lambda item: rows[item.id].decided_at)
    )
    assert _order("chronological_rank") == expected_chronological
    assert rows[queries[0].id].adaptive_score == pytest.approx(1.0)
    assert rows[queries[1].id].catalog_score == pytest.approx(1.0)

    again = _rows_by_submission(_eval(session, label.id, k=4, seed=1))
    assert all(again[q.id].random_rank == rows[q.id].random_rank for q in queries)


def test_repeat_call_identical_result(session):
    label, _ = _seed_golden_label(session)

    first = _eval(session, label.id, k=3, seed=7)
    second = _eval(session, label.id, k=3, seed=7)

    assert first == second


def test_evaluation_does_not_mutate_any_table(session):
    label, _ = _seed_golden_label(session)

    def _snapshot():
        session.expire_all()
        statuses = sorted((sub.id, sub.status) for sub in session.exec(select(Submission)).all())
        counts = tuple(len(session.exec(select(model)).all()) for model in _ROW_MODELS)
        return counts, statuses

    before = _snapshot()
    _eval(session, label.id, k=3)
    after = _snapshot()

    assert after == before


def test_catalog_scores_equal_direct_seam_call(session):
    label, (_, s1, s2, s3) = _seed_golden_label(session)

    evaluation = _eval(session, label.id, k=3)
    rows = _rows_by_submission(evaluation)

    for submission in (s1, s2, s3):
        embedding = session.exec(
            select(MusicEmbedding).where(MusicEmbedding.submission_id == submission.id)
        ).one()
        direct = compute_label_catalog_fit(
            session,
            label.id,
            TrackEmbedding(
                metadata=_METADATA,
                vector=tuple(float(value) for value in embedding.embedding),
            ),
            _METADATA,
            _PIPELINE_VERSION,
        )
        assert rows[submission.id].catalog_score == pytest.approx(direct.aggregate_score)


def test_tenant_isolation(session):
    label_a = _seed_label(session, "iso-a")
    label_b = _seed_label(session, "iso-b")
    for label in (label_a, label_b):
        _seed_ready_references(session, label, _dir(1.0, 0.0))
    own = _seed_submission(session, label_a, "iso-own")
    _add_aggregate(session, label_a, own, _dir(1.0, 0.0))
    _add_decision(session, own, "shortlist", _NOW)
    for index in range(3):
        other = _seed_submission(session, label_b, f"iso-other-{index}")
        _add_aggregate(session, label_b, other, _dir(0.0, 1.0))
        _add_decision(session, other, "rejected", _NOW)
    session.commit()

    evaluation = _eval(session, label_a.id, k=3)

    assert evaluation.pool_size == 1
    assert evaluation.decisions_considered == 1
    assert [row.submission_id for row in evaluation.rows] == [own.id]
    assert evaluation.catalog.evaluated == 1


def test_pipeline_version_identity_separation(session):
    label = _seed_label(session, "pipeline")
    _seed_ready_references(session, label, _dir(1.0, 0.0))
    submission = _seed_submission(session, label, "pipeline")
    _add_aggregate(session, label, submission, _dir(1.0, 0.0))
    _add_decision(session, submission, "shortlist", _NOW)
    session.commit()

    matched = _eval(session, label.id, k=3)
    other = _eval(session, label.id, k=3, pipeline_version="prep-v2")

    assert matched.pool_size == 1
    assert matched.catalog.evaluated == 1
    assert other.pool_size == 0
    assert other.decisions_considered == 1
    assert other.catalog.evaluated == 0
    assert other.catalog.precision_at_k is None
    assert other.rows[0].catalog_rank is None


def test_undecided_pool_member_counts_in_pool_not_rows(session):
    label = _seed_label(session, "undecided")
    _seed_ready_references(session, label, _dir(1.0, 0.0))
    decided = _seed_submission(session, label, "und-decided")
    _add_aggregate(session, label, decided, _dir(1.0, 0.0))
    _add_decision(session, decided, "shortlist", _NOW)
    silent = _seed_submission(session, label, "und-silent")
    _add_aggregate(session, label, silent, _dir(0.0, 1.0))
    session.commit()

    evaluation = _eval(session, label.id, k=3)

    assert evaluation.pool_size == 2
    assert evaluation.decisions_considered == 1
    assert [row.submission_id for row in evaluation.rows] == [decided.id]
    assert evaluation.catalog.evaluated == 1


def test_all_rejected_precision_zero_recall_and_ndcg_none(session):
    label = _seed_label(session, "allrej")
    _seed_ready_references(session, label, _dir(1.0, 0.0))
    for index in range(2):
        submission = _seed_submission(session, label, f"allrej-{index}")
        _add_aggregate(session, label, submission, _dir(1.0, 0.0))
        _add_decision(session, submission, "rejected", _NOW)
    session.commit()

    evaluation = _eval(session, label.id, k=3)

    assert evaluation.catalog.precision_at_k == pytest.approx(0.0)
    assert evaluation.catalog.recall_at_k is None
    assert evaluation.catalog.ndcg_at_k is None
