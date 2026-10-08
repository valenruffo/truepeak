"""Integrated chain smoke test: seed -> decisions -> preference -> inbox shape.

Service-level SQLite integration; NOT production proof. This module composes
the public seams the flag-gated ranked-inbox endpoint uses (demo seed, human
decision recording, label preference, preference similarity) and asserts the
whole chain end to end on one in-memory SQLite engine. It makes no HTTP, R2,
OpenL3, PostgreSQL, or inference claims of any kind.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api import reference_catalog as catalog_module
from app.ar_matching.adaptive_preference import (
    LabelPreferenceState,
    compute_label_preference,
    preference_similarity,
)
from app.ar_matching.ar_decisions import (
    list_label_decision_history,
    record_label_ar_decision,
)
from app.ar_matching.demo_seed import seed_demo_catalog_data
from app.ar_matching.storage_models import (
    LabelArDecisionRow,
    LabelReferenceTrack,
    MusicEmbedding,
)
from app.audio.embedding.schemas import EmbeddingMetadata
from app.models import Label, Submission

# Minimal explicit table set, mirroring the demo-seed, catalog-fit-cache, and
# ar-decisions SQLite fixtures. Everything is created fresh; nothing depends
# on a real database.
_TEST_TABLES = [
    Label.__table__,
    Submission.__table__,
    LabelReferenceTrack.__table__,
    LabelArDecisionRow.__table__,
    MusicEmbedding.__table__,
]
_METADATA = EmbeddingMetadata("smoke-provider", "smoke-model", "v1", 512)
_PIPELINE_VERSION = "smoke-pipeline-v1"
_BASE = datetime(2025, 3, 1, tzinfo=UTC)
_FIXED_LATE_NOW = datetime(2040, 1, 1, tzinfo=UTC)
_DECIDED_BY = "smoke-operator"


def _unit(x: float, y: float) -> list[float]:
    """One finite normalized 512D direction in the x/y plane."""
    norm = (x * x + y * y) ** 0.5
    return [x / norm, y / norm, *([0.0] * 510)]


@pytest.fixture
def engine():
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(test_engine, "connect")
    def _enable_foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(test_engine, tables=_TEST_TABLES)
    yield test_engine
    test_engine.dispose()


def _add_aggregate_submission(
    session: Session,
    label_id: str,
    track_name: str,
    x: float,
    y: float,
    created_at: datetime,
    *,
    with_embedding: bool = True,
) -> Submission:
    """Add one submission mirroring the demo seed's aggregate-embedding shape."""
    submission = Submission(
        id=str(uuid4()),
        label_id=label_id,
        producer_name="Smoke Producer",
        producer_email="smoke-producer@example.test",
        track_name=track_name,
        created_at=created_at,
    )
    session.add(submission)
    if with_embedding:
        # Mirrors the demo seed: flush the parent before the embedding row,
        # then one aggregate (-1) embedding under the exact identity tuple.
        session.flush()
        session.add(
            MusicEmbedding(
                label_id=label_id,
                reference_track_id=None,
                submission_id=submission.id,
                embedding=_unit(x, y),
                segment_index=-1,
                created_at=created_at,
                provider=_METADATA.provider,
                model=_METADATA.model,
                version=_METADATA.version,
                dimension=_METADATA.dimension,
                pipeline_version=_PIPELINE_VERSION,
            )
        )
    session.flush()
    return submission


def _compose_preference_inbox(session: Session, label_id: str):
    """Compose the ranked-inbox preference shape from public service seams.

    Mirrors the documented endpoint semantics without importing private API
    helpers: every submission for the label is read, aggregate embeddings are
    selected only under the exact identity tuple, READY preferences order
    scorable items by preference similarity, and any non-READY state falls
    back to chronological reading order with unscored items last.
    """
    preference = compute_label_preference(
        session,
        label_id=label_id,
        metadata=_METADATA,
        pipeline_version=_PIPELINE_VERSION,
    )
    submissions = session.exec(
        select(Submission)
        .where(Submission.label_id == label_id)
        .order_by(Submission.created_at, Submission.id)
    ).all()
    aggregates = session.exec(
        select(MusicEmbedding)
        .where(MusicEmbedding.label_id == label_id)
        .where(MusicEmbedding.submission_id.is_not(None))
        .where(MusicEmbedding.reference_track_id.is_(None))
        .where(MusicEmbedding.segment_index == -1)
        .where(MusicEmbedding.provider == _METADATA.provider)
        .where(MusicEmbedding.model == _METADATA.model)
        .where(MusicEmbedding.version == _METADATA.version)
        .where(MusicEmbedding.dimension == _METADATA.dimension)
        .where(MusicEmbedding.pipeline_version == _PIPELINE_VERSION)
    ).all()
    vector_by_submission = {row.submission_id: row.embedding for row in aggregates}
    scorable = [s for s in submissions if s.id in vector_by_submission]
    unscored = [s for s in submissions if s.id not in vector_by_submission]
    if preference.state is not LabelPreferenceState.READY:
        order = [(s.id, None) for s in scorable + unscored]
        return "chronological_fallback", order
    scored = sorted(
        (
            (preference_similarity(preference.preference, vector_by_submission[s.id]), s.id)
            for s in scorable
        ),
        key=lambda entry: entry[0],
        reverse=True,
    )
    score_by_id = {submission_id: score for score, submission_id in scored}
    order = [(submission_id, score_by_id[submission_id]) for _, submission_id in scored]
    order.extend((s.id, None) for s in unscored)
    return "preference", order


def test_happy_chain_seed_decisions_preference_inbox(engine):
    """Seed -> decisions -> READY preference -> ranked shape holds end to end.

    Service-level SQLite integration; NOT production proof.
    """
    with Session(engine) as session:
        seeded = seed_demo_catalog_data(
            session,
            metadata=_METADATA,
            pipeline_version=_PIPELINE_VERSION,
            reference_count=5,
        )
        assert seeded.created
        shortlisted_a = _add_aggregate_submission(
            session, seeded.label_id, "Smoke A", 1.0, 0.0, _BASE
        )
        shortlisted_b = _add_aggregate_submission(
            session, seeded.label_id, "Smoke B", 0.0, 1.0, _BASE
        )
        unscored = _add_aggregate_submission(
            session,
            seeded.label_id,
            "Smoke unscored",
            1.0,
            1.0,
            _BASE,
            with_embedding=False,
        )
        for submission in (shortlisted_a, shortlisted_b):
            outcome = record_label_ar_decision(
                session,
                label_id=seeded.label_id,
                submission_id=submission.id,
                decision="shortlist",
                decided_by=_DECIDED_BY,
            )
            assert outcome.created
        rejected = record_label_ar_decision(
            session,
            label_id=seeded.label_id,
            submission_id=seeded.submission_id,
            decision="rejected",
            decided_by=_DECIDED_BY,
        )
        assert rejected.created
        assert len(list_label_decision_history(session, label_id=seeded.label_id)) == 3

        preference = compute_label_preference(
            session,
            label_id=seeded.label_id,
            metadata=_METADATA,
            pipeline_version=_PIPELINE_VERSION,
        )
        assert preference.state is LabelPreferenceState.READY
        assert preference.preference is not None
        assert preference.positive_count == 2
        assert preference.negative_count == 1

        mode, order = _compose_preference_inbox(session, seeded.label_id)
        assert mode == "preference"
        # The inbox never omits a demo: all four submissions are ranked.
        assert {submission_id for submission_id, _ in order} == {
            seeded.submission_id,
            shortlisted_a.id,
            shortlisted_b.id,
            unscored.id,
        }
        scores = [score for _, score in order]
        scored_prefix = scores[:-1]
        assert scored_prefix == sorted(scored_prefix, reverse=True)
        assert scores[-1] is None


def test_cold_start_with_zero_decisions(engine):
    """A freshly seeded label with zero decisions stays COLD_START (None).

    Service-level SQLite integration; NOT production proof.
    """
    with Session(engine) as session:
        seeded = seed_demo_catalog_data(
            session,
            metadata=_METADATA,
            pipeline_version=_PIPELINE_VERSION,
            reference_count=5,
        )
        preference = compute_label_preference(
            session,
            label_id=seeded.label_id,
            metadata=_METADATA,
            pipeline_version=_PIPELINE_VERSION,
        )
        assert preference.state is LabelPreferenceState.COLD_START
        assert preference.preference is None
        assert preference.contributing_count == 0


def test_cold_start_fallback_orders_chronologically_unscored_last(engine):
    """COLD_START falls back to chronological reading order, unscored last.

    Service-level SQLite integration; NOT production proof.
    """
    with Session(engine) as session:
        seeded = seed_demo_catalog_data(
            session,
            metadata=_METADATA,
            pipeline_version=_PIPELINE_VERSION,
            reference_count=5,
        )
        first = _add_aggregate_submission(session, seeded.label_id, "Smoke first", 1.0, 0.0, _BASE)
        unscored = _add_aggregate_submission(
            session,
            seeded.label_id,
            "Smoke unscored",
            1.0,
            1.0,
            _BASE,
            with_embedding=False,
        )
        last = _add_aggregate_submission(
            session,
            seeded.label_id,
            "Smoke last",
            0.0,
            1.0,
            datetime(2025, 3, 1, 0, 0, 2, tzinfo=UTC),
        )
        mode, order = _compose_preference_inbox(session, seeded.label_id)
        assert mode == "chronological_fallback"
        # Scorable items keep (created_at, id) reading order with distinct
        # timestamps; the unscored submission follows last. This neutral
        # ordering is NOT a quality judgment.
        assert [submission_id for submission_id, _ in order] == [
            first.id,
            last.id,
            seeded.submission_id,
            unscored.id,
        ]
        assert all(score is None for _, score in order)


def test_cancelled_preference_uses_same_neutral_fallback(engine):
    """CANCELLED (fully decayed contributions) uses the neutral fallback too.

    Service-level SQLite integration; NOT production proof. A fixed far-future
    ``now`` decays both opposing shortlist contributions below the
    cancellation tolerance deterministically, independent of wall-clock
    timing between the recorded decisions.
    """
    with Session(engine) as session:
        seeded = seed_demo_catalog_data(
            session,
            metadata=_METADATA,
            pipeline_version=_PIPELINE_VERSION,
            reference_count=5,
        )
        opposite_a = _add_aggregate_submission(
            session, seeded.label_id, "Smoke opposite A", 1.0, 0.0, _BASE
        )
        opposite_b = _add_aggregate_submission(
            session,
            seeded.label_id,
            "Smoke opposite B",
            -1.0,
            0.0,
            datetime(2025, 3, 1, 0, 0, 1, tzinfo=UTC),
        )
        unscored = _add_aggregate_submission(
            session,
            seeded.label_id,
            "Smoke unscored",
            1.0,
            1.0,
            datetime(2025, 3, 1, 0, 0, 2, tzinfo=UTC),
            with_embedding=False,
        )
        for submission in (opposite_a, opposite_b):
            assert record_label_ar_decision(
                session,
                label_id=seeded.label_id,
                submission_id=submission.id,
                decision="shortlist",
                decided_by=_DECIDED_BY,
            ).created

        preference = compute_label_preference(
            session,
            label_id=seeded.label_id,
            metadata=_METADATA,
            pipeline_version=_PIPELINE_VERSION,
            now=_FIXED_LATE_NOW,
            cold_start_minimum=2,
        )
        assert preference.state is LabelPreferenceState.CANCELLED
        assert preference.preference is None

        mode, order = _compose_preference_inbox(session, seeded.label_id)
        assert mode == "chronological_fallback"
        assert [submission_id for submission_id, _ in order] == [
            opposite_a.id,
            opposite_b.id,
            seeded.submission_id,
            unscored.id,
        ]
        assert all(score is None for _, score in order)


def test_feature_flags_default_off(monkeypatch):
    """Both flag-gate variables default OFF; unset means the gate stays shut.

    Service-level settings assertion; NOT production proof. The documented
    gate accepts only exact ``true`` or ``1``; the unset default satisfies
    neither, so every flag-gated endpoint keeps returning 404.
    """
    monkeypatch.delenv(catalog_module._ENABLED_VARIABLE, raising=False)
    monkeypatch.delenv(catalog_module._UPLOADS_ENABLED_VARIABLE, raising=False)
    assert catalog_module._ENABLED_VARIABLE == "LABEL_DNA_ENABLED"
    assert catalog_module._UPLOADS_ENABLED_VARIABLE == "LABEL_DNA_UPLOADS_ENABLED"
    for variable in (
        catalog_module._ENABLED_VARIABLE,
        catalog_module._UPLOADS_ENABLED_VARIABLE,
    ):
        default = os.getenv(variable, "")
        assert default.strip().lower() not in {"true", "1"}
