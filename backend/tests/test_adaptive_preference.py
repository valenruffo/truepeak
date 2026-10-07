"""SQLite behavior tests for adaptive label preference learning (T06-D3).

Covers app.ar_matching.adaptive_preference: the LOCKED decayed-sign-sum math
with hand-computed goldens, cold-start/cancelled gates, latest-wins decision
derivation, counting semantics (pos/neg among ALL latest-decided; skipping is
counted but never gated), naive decided_at UTC repair, future-time clamping,
tenant isolation, sub-arm aggregate selection (segment >= 0 and reference-arm
rows ignored), raw-row immutability, demo-seed integration through
record_label_ar_decision, preference_similarity goldens, and validation.
SQLite only; no PostgreSQL, RLS, concurrency, or inference claims.
"""

from __future__ import annotations

import dataclasses
import math
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from uuid import UUID, uuid4, uuid5

import pytest
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.ar_matching.adaptive_preference import (
    LabelPreferenceResult,
    LabelPreferenceState,
    compute_label_preference,
    preference_similarity,
)
from app.ar_matching.ar_decisions import record_label_ar_decision
from app.ar_matching.demo_seed import seed_demo_catalog_data
from app.ar_matching.storage_models import (
    LabelArDecisionRow,
    LabelCatalogFitScoreRow,
    LabelReferenceTrack,
    MusicEmbedding,
)
from app.audio.embedding.schemas import EmbeddingMetadata
from app.models import Label, Notification, Submission

_METADATA = EmbeddingMetadata("test-provider", "test-model", "v1", 512)
_PIPELINE_VERSION = "prep-v1"
_NOW = datetime(2025, 6, 1, tzinfo=UTC)
_DAY = timedelta(days=1)
_CANONICAL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
_UPPERCASE_ID = "3FA85F64-5717-4562-B3FC-2C963F66AFA6"
_UNIT_GOLDEN_X = (0.6, 0.8, *([0.0] * 510))
_DEMO_NAMESPACE = UUID("3f2a1c9e-5b7d-4e8f-9c6a-1d0b2e4f6a8c")

_TABLES = [
    Label.__table__,
    Submission.__table__,
    LabelReferenceTrack.__table__,
    MusicEmbedding.__table__,
    LabelArDecisionRow.__table__,
    LabelCatalogFitScoreRow.__table__,
    Notification.__table__,
]


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


def _unit_tail(x: float, y: float) -> tuple[float, float, *tuple[float, ...]]:
    norm = math.hypot(x, y)
    return (x / norm, y / norm, *([0.0] * 510))


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


def _seed_submission(session: Session, label: Label, suffix: str) -> Submission:
    submission = Submission(
        id=str(uuid4()),
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


def _add_decision(
    session: Session,
    submission: Submission,
    decision: str,
    decided_at: datetime,
    decided_by: str = "reviewer-1",
) -> None:
    session.add(
        LabelArDecisionRow(
            label_id=submission.label_id,
            submission_id=submission.id,
            decision=decision,
            decided_by=decided_by,
            decided_at=decided_at,
        )
    )


def _compute(session: Session, label_id, **overrides):
    kwargs = {
        "label_id": label_id,
        "metadata": _METADATA,
        "pipeline_version": _PIPELINE_VERSION,
        "now": _NOW,
    }
    return compute_label_preference(session, **{**kwargs, **overrides})


def _snapshots(session: Session, model) -> list[dict]:
    session.expire_all()
    return sorted(
        (
            {key: value for key, value in vars(row).items() if not key.startswith("_")}
            for row in session.exec(select(model)).all()
        ),
        key=lambda snapshot: snapshot["id"],
    )


def test_locked_surface_state_values_and_frozen_result():
    assert issubclass(LabelPreferenceState, StrEnum)
    assert [state.value for state in LabelPreferenceState] == [
        "cold_start",
        "ready",
        "cancelled",
    ]
    assert [field.name for field in dataclasses.fields(LabelPreferenceResult)] == [
        "state",
        "preference",
        "positive_count",
        "negative_count",
        "skipped_count",
        "contributing_count",
    ]
    result = LabelPreferenceResult(
        state=LabelPreferenceState.READY,
        preference=(1.0, 0.0),
        positive_count=1,
        negative_count=0,
        skipped_count=0,
        contributing_count=1,
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        result.positive_count = 2


def test_cold_start_with_no_decisions(session):
    label = _seed_label(session, "cold")
    session.commit()

    result = _compute(session, label.id)

    assert result.state is LabelPreferenceState.COLD_START
    assert result.preference is None
    assert (
        result.positive_count,
        result.negative_count,
        result.skipped_count,
        result.contributing_count,
    ) == (0, 0, 0, 0)


def test_cold_start_below_minimum_two_contributing(session):
    label = _seed_label(session, "cold2")
    for index in range(2):
        submission = _seed_submission(session, label, f"cold2-{index}")
        _add_aggregate(session, label, submission, _dir(3.0, 4.0))
        _add_decision(session, submission, "shortlist", _NOW)
    session.commit()

    result = _compute(session, label.id)

    assert result.state is LabelPreferenceState.COLD_START
    assert result.preference is None
    assert (
        result.positive_count,
        result.negative_count,
        result.skipped_count,
        result.contributing_count,
    ) == (2, 0, 0, 2)


def test_exactly_at_minimum_is_ready(session):
    label = _seed_label(session, "min")
    for index, vector in enumerate((_dir(1.0, 0.0), _dir(0.0, 1.0), _dir(1.0, 1.0))):
        submission = _seed_submission(session, label, f"min-{index}")
        _add_aggregate(session, label, submission, vector)
        _add_decision(session, submission, "shortlist", _NOW - _DAY)
    session.commit()

    result = _compute(session, label.id)

    assert result.state is LabelPreferenceState.READY
    assert result.preference == pytest.approx((math.sqrt(0.5), math.sqrt(0.5), *([0.0] * 510)))
    assert (result.contributing_count, result.skipped_count) == (3, 0)


def test_single_shortlist_golden_unit_preference(session):
    label = _seed_label(session, "pos")
    submission = _seed_submission(session, label, "pos")
    _add_aggregate(session, label, submission, _dir(3.0, 4.0))
    _add_decision(session, submission, "shortlist", _NOW - _DAY)
    session.commit()

    result = _compute(session, label.id, cold_start_minimum=1)

    assert result.state is LabelPreferenceState.READY
    assert result.preference == pytest.approx(_UNIT_GOLDEN_X)
    assert (
        result.positive_count,
        result.negative_count,
        result.skipped_count,
        result.contributing_count,
    ) == (1, 0, 0, 1)


def test_single_rejected_golden_damped_negative_direction(session):
    label = _seed_label(session, "neg1")
    submission = _seed_submission(session, label, "neg1")
    _add_aggregate(session, label, submission, _dir(3.0, 4.0))
    _add_decision(session, submission, "rejected", _NOW - _DAY)
    session.commit()

    result = _compute(session, label.id, cold_start_minimum=1)

    assert result.state is LabelPreferenceState.READY
    assert result.preference == pytest.approx((-0.6, -0.8, *([0.0] * 510)))
    assert (
        result.positive_count,
        result.negative_count,
        result.skipped_count,
        result.contributing_count,
    ) == (0, 1, 0, 1)


def test_two_positive_one_negative_decayed_sum(session):
    label = _seed_label(session, "decay")
    positive_old = _seed_submission(session, label, "decay-po")
    positive_new = _seed_submission(session, label, "decay-pn")
    rejected_mid = _seed_submission(session, label, "decay-rm")
    _add_aggregate(session, label, positive_old, _dir(1.0, 0.0))
    _add_aggregate(session, label, positive_new, _dir(0.0, 1.0))
    _add_aggregate(session, label, rejected_mid, _dir(1.0, 0.0))
    _add_decision(session, positive_old, "shortlist", _NOW - 30 * _DAY)
    _add_decision(session, positive_new, "shortlist", _NOW)
    _add_decision(session, rejected_mid, "rejected", _NOW - 15 * _DAY)
    session.commit()

    result = _compute(session, label.id)

    # Hand-computed locked formula: exp(-ln2 * age/30) factors 0.5, 1, 2**-0.5.
    sx = math.exp(-math.log(2.0)) - 0.25 * math.exp(-math.log(2.0) * 0.5)
    sy = 1.0
    assert result.state is LabelPreferenceState.READY
    assert result.preference == pytest.approx(_unit_tail(sx, sy))
    assert (
        result.positive_count,
        result.negative_count,
        result.skipped_count,
        result.contributing_count,
    ) == (2, 1, 0, 3)


def test_only_negatives_point_away_from_shared_direction(session):
    label = _seed_label(session, "allneg")
    for index in range(3):
        submission = _seed_submission(session, label, f"allneg-{index}")
        _add_aggregate(session, label, submission, _dir(3.0, 4.0))
        _add_decision(session, submission, "rejected", _NOW)
    session.commit()

    result = _compute(session, label.id)

    assert result.state is LabelPreferenceState.READY
    assert result.preference == pytest.approx((-0.6, -0.8, *([0.0] * 510)))
    assert (
        result.positive_count,
        result.negative_count,
        result.skipped_count,
        result.contributing_count,
    ) == (0, 3, 0, 3)


def test_skipped_counted_not_gated(session):
    label = _seed_label(session, "skip")
    embedded_positive = _seed_submission(session, label, "skip-pos")
    embedded_negative = _seed_submission(session, label, "skip-neg")
    skipped = _seed_submission(session, label, "skip-none")
    _add_aggregate(session, label, embedded_positive, _dir(3.0, 4.0))
    _add_aggregate(session, label, embedded_negative, _dir(0.0, 1.0))
    _add_decision(session, embedded_positive, "shortlist", _NOW)
    _add_decision(session, embedded_negative, "rejected", _NOW)
    _add_decision(session, skipped, "shortlist", _NOW)
    session.commit()

    result = _compute(session, label.id, cold_start_minimum=2)

    assert result.state is LabelPreferenceState.READY
    assert result.preference == pytest.approx(_unit_tail(0.6, 0.55))
    assert (result.positive_count, result.negative_count) == (2, 1)
    assert (result.skipped_count, result.contributing_count) == (1, 2)


def test_newer_rejected_outweighs_older_shortlist(session):
    label = _seed_label(session, "flip")
    old_positive = _seed_submission(session, label, "flip-old")
    new_negative = _seed_submission(session, label, "flip-new")
    _add_aggregate(session, label, old_positive, _dir(3.0, 4.0))
    _add_aggregate(session, label, new_negative, _dir(3.0, 4.0))
    _add_decision(session, old_positive, "shortlist", _NOW - 90 * _DAY)
    _add_decision(session, new_negative, "rejected", _NOW)
    session.commit()

    result = _compute(session, label.id, cold_start_minimum=2)

    assert result.state is LabelPreferenceState.READY
    assert result.preference == pytest.approx((-0.6, -0.8, *([0.0] * 510)))
    assert (result.positive_count, result.negative_count, result.contributing_count) == (1, 1, 2)


def test_naive_decided_at_repaired_as_utc(session):
    label = _seed_label(session, "naive")
    positive = _seed_submission(session, label, "naive-pos")
    negative = _seed_submission(session, label, "naive-neg")
    _add_aggregate(session, label, positive, _dir(1.0, 0.0))
    _add_aggregate(session, label, negative, _dir(0.0, 1.0))
    _add_decision(session, positive, "shortlist", datetime(2025, 5, 2))  # naive = _NOW - 30d
    _add_decision(session, negative, "rejected", _NOW)
    session.commit()

    result = _compute(session, label.id, cold_start_minimum=2)

    assert result.state is LabelPreferenceState.READY
    assert result.preference == pytest.approx(_unit_tail(0.5, -0.25))
    assert (result.positive_count, result.negative_count, result.contributing_count) == (1, 1, 2)


def test_future_decided_at_clamps_age_to_zero(session):
    label = _seed_label(session, "future")
    positive = _seed_submission(session, label, "future-pos")
    negative = _seed_submission(session, label, "future-neg")
    _add_aggregate(session, label, positive, _dir(1.0, 0.0))
    _add_aggregate(session, label, negative, _dir(0.0, 1.0))
    _add_decision(session, positive, "shortlist", _NOW + 5 * _DAY)
    _add_decision(session, negative, "rejected", _NOW)
    session.commit()

    result = _compute(session, label.id, cold_start_minimum=2)

    assert result.state is LabelPreferenceState.READY
    assert result.preference == pytest.approx(_unit_tail(1.0, -0.25))
    assert (result.positive_count, result.negative_count, result.contributing_count) == (1, 1, 2)


def test_exact_cancellation_is_cancelled(session):
    label = _seed_label(session, "cancel")
    for index in range(5):
        submission = _seed_submission(session, label, f"cancel-{index}")
        _add_aggregate(session, label, submission, _dir(3.0, 4.0))
        _add_decision(session, submission, "shortlist" if index == 0 else "rejected", _NOW)
    session.commit()

    result = _compute(session, label.id)

    assert result.state is LabelPreferenceState.CANCELLED
    assert result.preference is None
    assert (result.positive_count, result.negative_count) == (1, 4)
    assert (result.skipped_count, result.contributing_count) == (0, 5)


def test_latest_wins_shortlist_then_rejected_single_negative(session):
    label = _seed_label(session, "latest")
    submission = _seed_submission(session, label, "latest")
    _add_aggregate(session, label, submission, _dir(3.0, 4.0))
    _add_decision(session, submission, "shortlist", _NOW - 2 * _DAY)
    _add_decision(session, submission, "rejected", _NOW - _DAY)
    session.commit()

    result = _compute(session, label.id, cold_start_minimum=1)

    assert result.state is LabelPreferenceState.READY
    assert result.preference == pytest.approx((-0.6, -0.8, *([0.0] * 510)))
    assert (result.positive_count, result.negative_count, result.contributing_count) == (0, 1, 1)


def test_reaffirmation_rows_coexist_latest_wins_single_count(session):
    label = _seed_label(session, "affirm")
    submission = _seed_submission(session, label, "affirm")
    _add_aggregate(session, label, submission, _dir(3.0, 4.0))
    _add_decision(session, submission, "shortlist", _NOW - 2 * _DAY, decided_by="reviewer-1")
    _add_decision(session, submission, "shortlist", _NOW - _DAY, decided_by="reviewer-2")
    session.commit()

    result = _compute(session, label.id, cold_start_minimum=1)

    assert result.state is LabelPreferenceState.READY
    assert result.preference == pytest.approx(_UNIT_GOLDEN_X)
    assert (result.positive_count, result.negative_count, result.contributing_count) == (1, 0, 1)


def test_raw_rows_untouched_by_compute(session):
    label = _seed_label(session, "raw")
    submission = _seed_submission(session, label, "raw")
    _add_aggregate(session, label, submission, _dir(3.0, 4.0))
    _add_decision(session, submission, "shortlist", _NOW - _DAY)
    session.add(
        LabelCatalogFitScoreRow(
            label_id=label.id,
            query_submission_id=submission.id,
            reference_track_id=None,
            provider=_METADATA.provider,
            model=_METADATA.model,
            version=_METADATA.version,
            dimension=_METADATA.dimension,
            pipeline_version=_PIPELINE_VERSION,
            k=3,
            score=0.5,
            eligible_count=5,
            eligible_fingerprint="fingerprint",
        )
    )
    session.commit()

    before = [_snapshots(session, MusicEmbedding), _snapshots(session, LabelCatalogFitScoreRow)]

    result = _compute(session, label.id, cold_start_minimum=1)

    after = [_snapshots(session, MusicEmbedding), _snapshots(session, LabelCatalogFitScoreRow)]
    assert result.state is LabelPreferenceState.READY
    assert after == before


def test_other_label_decisions_and_embeddings_ignored(session):
    label_a = _seed_label(session, "iso-a")
    label_b = _seed_label(session, "iso-b")
    submission_a = _seed_submission(session, label_a, "iso-a1")
    _add_aggregate(session, label_a, submission_a, _dir(3.0, 4.0))
    _add_decision(session, submission_a, "shortlist", _NOW)
    for index in range(3):
        other = _seed_submission(session, label_b, f"iso-b{index}")
        _add_aggregate(session, label_b, other, _dir(0.0, 1.0))
        _add_decision(session, other, "rejected", _NOW)
    session.commit()

    result = _compute(session, label_a.id)

    assert result.state is LabelPreferenceState.COLD_START
    assert result.preference is None
    assert (
        result.positive_count,
        result.negative_count,
        result.skipped_count,
        result.contributing_count,
    ) == (1, 0, 0, 1)


def test_segment_and_reference_arm_rows_ignored(session):
    label = _seed_label(session, "arms")
    submission = _seed_submission(session, label, "arms")
    _add_aggregate(session, label, submission, _dir(3.0, 4.0))
    reference = LabelReferenceTrack(
        label_id=label.id, title="Reference", status="uploaded", is_active=True
    )
    session.add(reference)
    session.flush()
    identity = {
        "provider": _METADATA.provider,
        "model": _METADATA.model,
        "version": _METADATA.version,
        "dimension": _METADATA.dimension,
        "pipeline_version": _PIPELINE_VERSION,
        "created_at": _NOW,
    }
    session.add(
        MusicEmbedding(
            label_id=label.id,
            reference_track_id=reference.id,
            submission_id=None,
            embedding=_dir(0.0, 1.0),
            segment_index=-1,
            **identity,
        )
    )
    session.add(
        MusicEmbedding(
            label_id=label.id,
            reference_track_id=None,
            submission_id=submission.id,
            embedding=_dir(1.0, 0.0),
            segment_index=0,
            start_seconds=0.0,
            end_seconds=1.0,
            **identity,
        )
    )
    _add_decision(session, submission, "shortlist", _NOW - _DAY)
    session.commit()

    result = _compute(session, label.id, cold_start_minimum=1)

    assert result.state is LabelPreferenceState.READY
    assert result.preference == pytest.approx(_UNIT_GOLDEN_X)
    assert (result.skipped_count, result.contributing_count) == (0, 1)


def _demo_submission_direction() -> tuple[float, float]:
    """Independent mirror of demo_seed's deterministic synthetic direction."""
    digest = uuid5(_DEMO_NAMESPACE, "demo-direction-demo-submission").int
    x = (digest % 997) + 1.0
    y = ((digest // 997) % 991) + 1.0
    norm = math.hypot(x, y)
    return (x / norm, y / norm)


def test_demo_seed_then_three_recorded_decisions_ready(session):
    seeded = seed_demo_catalog_data(session, metadata=_METADATA, pipeline_version=_PIPELINE_VERSION)
    label = session.get(Label, seeded.label_id)
    first = session.get(Submission, seeded.submission_id)
    second = _seed_submission(session, label, "demo-second")
    third = _seed_submission(session, label, "demo-third")
    _add_aggregate(session, label, second, _dir(0.0, 1.0))
    _add_aggregate(session, label, third, _dir(1.0, 1.0))
    session.commit()
    for submission, decision in ((first, "shortlist"), (second, "shortlist"), (third, "rejected")):
        record_label_ar_decision(
            session,
            label_id=label.id,
            submission_id=submission.id,
            decision=decision,
            decided_by="reviewer-1",
        )
    session.commit()

    result = compute_label_preference(
        session, label_id=label.id, metadata=_METADATA, pipeline_version=_PIPELINE_VERSION
    )

    demo_x, demo_y = _demo_submission_direction()
    damped = 0.25 * math.sqrt(0.5)  # rejected unit(1,1) direction, damped
    assert result.state is LabelPreferenceState.READY
    assert result.preference == pytest.approx(
        _unit_tail(demo_x - damped, demo_y + 1.0 - damped), rel=1e-6
    )
    assert (
        result.positive_count,
        result.negative_count,
        result.skipped_count,
        result.contributing_count,
    ) == (2, 1, 0, 3)


def test_preference_similarity_golden_values():
    preference = (0.6, 0.8, *([0.0] * 510))
    assert preference_similarity(preference, (0.6, 0.8, *([0.0] * 510))) == pytest.approx(1.0)
    assert preference_similarity(preference, (0.8, -0.6, *([0.0] * 510))) == pytest.approx(0.0)
    assert preference_similarity(preference, (-0.6, -0.8, *([0.0] * 510))) == pytest.approx(-1.0)
    assert preference_similarity(preference, [0.6, 0.8, *([0.0] * 510)]) == pytest.approx(1.0)


def test_preference_similarity_validation():
    tail = [0.0] * 510
    with pytest.raises(ValueError):
        preference_similarity((0.0, 0.0, *tail), (1.0, 0.0, *tail))
    with pytest.raises(ValueError):
        preference_similarity((1.0, 0.0), (1.0, 0.0, 0.0))
    with pytest.raises(ValueError):
        preference_similarity((), (1.0, 0.0))
    with pytest.raises(ValueError):
        preference_similarity((float("nan"), 1.0, *tail), (1.0, 0.0, *tail))
    with pytest.raises(ValueError):
        preference_similarity("not-a-vector", (1.0, 0.0, *tail))


@pytest.mark.parametrize("bad", [0.0, -1.0, float("inf"), float("nan"), "1.0", True])
def test_validation_rejects_invalid_positive_weight(session, bad):
    with pytest.raises(ValueError):
        _compute(session, _CANONICAL_ID, positive_weight=bad)


@pytest.mark.parametrize("bad", [0.0, -1.0, float("inf"), float("nan"), True])
def test_validation_rejects_invalid_negative_weight(session, bad):
    with pytest.raises(ValueError):
        _compute(session, _CANONICAL_ID, negative_weight=bad)


@pytest.mark.parametrize("bad", [0.0, -1.0, float("inf"), float("nan"), True])
def test_validation_rejects_invalid_half_life_days(session, bad):
    with pytest.raises(ValueError):
        _compute(session, _CANONICAL_ID, half_life_days=bad)


@pytest.mark.parametrize("bad", [0, -1, True, 2.0, "3"])
def test_validation_rejects_invalid_cold_start_minimum(session, bad):
    with pytest.raises(ValueError):
        _compute(session, _CANONICAL_ID, cold_start_minimum=bad)


@pytest.mark.parametrize("bad", ["", "not-a-uuid", _UPPERCASE_ID, 123, None])
def test_validation_rejects_non_canonical_label_id(session, bad):
    with pytest.raises(ValueError):
        _compute(session, bad)


def test_validation_rejects_naive_now_and_bad_scope(session):
    with pytest.raises(ValueError):
        _compute(session, _CANONICAL_ID, now=datetime(2025, 6, 1))
    with pytest.raises(ValueError):
        _compute(session, _CANONICAL_ID, metadata="nope")
    with pytest.raises(ValueError):
        _compute(session, _CANONICAL_ID, pipeline_version="   ")
