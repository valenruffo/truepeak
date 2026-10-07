"""Tests for the resumable catalog-fit cache backfill service (T05-B).

Pins the locked contract: validation before any session open, one owned
transaction per work item, deterministic (created_at, id) ordering, a limit
that bounds only post-cache-skip attempts, honest per-item failure kinds,
resume via committed-cache self-skip, and immediate propagation of infra
errors. SQLite-only evidence; no concurrency claims.
"""

from __future__ import annotations

import ast
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

import app.ar_matching.catalog_fit_backfill as backfill_module
from app.ar_matching.catalog_fit_backfill import backfill_label_catalog_fit
from app.ar_matching.catalog_fit_cache import (
    get_cached_label_catalog_fit,
    persist_label_catalog_fit,
)
from app.ar_matching.catalog_fit_scores import compute_label_catalog_fit
from app.ar_matching.demo_seed import seed_demo_catalog_data
from app.ar_matching.reference_catalog import ReadinessState
from app.ar_matching.storage_models import (
    LabelCatalogFitScoreRow,
    LabelReferenceTrack,
    MusicEmbedding,
)
from app.audio.embedding.schemas import EmbeddingMetadata, TrackEmbedding
from app.models import Label, Submission

_TEST_TABLES = [
    Label.__table__,
    Submission.__table__,
    LabelReferenceTrack.__table__,
    MusicEmbedding.__table__,
    LabelCatalogFitScoreRow.__table__,
]
_METADATA = EmbeddingMetadata("test-provider", "test-model", "v1", 512)
_PIPELINE = "prep-v1"
_STAMP = datetime(2025, 3, 1, tzinfo=UTC)


def _dir(x: float, y: float) -> list[float]:
    return [x, y, *([0.0] * 510)]


@pytest.fixture
def engine():
    test_engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(test_engine, "connect")
    def _enable_foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(test_engine, tables=_TEST_TABLES)
    yield test_engine
    test_engine.dispose()


@pytest.fixture
def factory(engine):
    return lambda: Session(engine)


def _arm_embedding(label_id, submission_id, vector, created_at=_STAMP, embedding_id=None):
    """Demo-style submission-arm aggregate MusicEmbedding (second work item)."""
    return MusicEmbedding(
        id=embedding_id,
        label_id=label_id,
        reference_track_id=None,
        submission_id=submission_id,
        embedding=vector,
        provider=_METADATA.provider,
        model=_METADATA.model,
        version=_METADATA.version,
        dimension=512,
        pipeline_version=_PIPELINE,
        segment_index=-1,
        created_at=created_at,
    )


def _seed(engine, *, reference_count: int = 5):
    with Session(engine) as session:
        result = seed_demo_catalog_data(
            session, metadata=_METADATA, pipeline_version=_PIPELINE, reference_count=reference_count
        )
        session.commit()
        return result


def _add_submission_arm(
    engine, label_id: str, *, submission_id: str, created_at=_STAMP, vector=None, embedding_id=None
) -> None:
    with Session(engine) as session:
        session.add(
            Submission(
                id=submission_id,
                label_id=label_id,
                producer_name="Producer",
                producer_email=f"{submission_id[:8]}@test.io",
                track_name="Track",
                created_at=created_at,
            )
        )
        session.flush()
        session.add(
            _arm_embedding(
                label_id, submission_id, vector or _dir(1.0, 1.0), created_at, embedding_id
            )
        )
        session.commit()


def _add_second_arm(engine, label_id: str) -> str:
    """A second work item on the label: distinct vector, later created_at."""
    submission_id = str(uuid4())
    _add_submission_arm(
        engine,
        label_id,
        submission_id=submission_id,
        created_at=_STAMP + timedelta(seconds=1),
        vector=_dir(2.0, 1.0),
    )
    return submission_id


def _make_label(engine, label_id: str, *, reference_count: int) -> str:
    """Factory-built label: ready references plus one submission arm."""
    with Session(engine) as session:
        session.add(
            Label(
                id=label_id,
                name="Label",
                slug=f"slug-{label_id[:12]}",
                owner_email=f"{label_id[:12]}@test.io",
                subscription_status="active",
                created_at=_STAMP,
                updated_at=_STAMP,
            )
        )
        session.flush()
        for index in range(reference_count):
            session.add(
                LabelReferenceTrack(
                    id=str(uuid4()),
                    label_id=label_id,
                    title=f"Ref {index}",
                    artist=None,
                    status="ready",
                    is_active=True,
                    created_at=_STAMP,
                    updated_at=_STAMP,
                )
            )
        submission_id = str(uuid4())
        session.add(
            Submission(
                id=submission_id,
                label_id=label_id,
                producer_name="P",
                producer_email="p@test.io",
                track_name="T",
                created_at=_STAMP,
            )
        )
        session.flush()
        session.add(_arm_embedding(label_id, submission_id, _dir(1.0, 1.0)))
        session.commit()
        return submission_id


def _add_reference_arm(engine, label_id: str, *, title: str, vector, created_at=_STAMP) -> None:
    with Session(engine) as session:
        reference = LabelReferenceTrack(
            id=str(uuid4()),
            label_id=label_id,
            title=title,
            artist=None,
            status="ready",
            is_active=True,
            created_at=created_at,
            updated_at=created_at,
        )
        session.add(reference)
        session.flush()
        session.add(
            MusicEmbedding(
                label_id=label_id,
                reference_track_id=reference.id,
                embedding=vector,
                provider=_METADATA.provider,
                model=_METADATA.model,
                version=_METADATA.version,
                dimension=512,
                pipeline_version=_PIPELINE,
                segment_index=-1,
                created_at=created_at,
            )
        )
        session.commit()


def _run(factory, label_id: str, **kwargs):
    return backfill_label_catalog_fit(
        label_id=label_id,
        metadata=_METADATA,
        pipeline_version=_PIPELINE,
        session_factory=factory,
        **kwargs,
    )


def _cached(engine, label_id: str, submission_id: str, *, k=3, pipeline_version=_PIPELINE):
    with Session(engine) as session:
        return get_cached_label_catalog_fit(
            session,
            label_id=label_id,
            query_submission_id=submission_id,
            metadata=_METADATA,
            pipeline_version=pipeline_version,
            k=k,
        )


def _count_compute(monkeypatch) -> list:
    calls = []
    real = backfill_module.compute_label_catalog_fit

    def _spy(session, label_id, query_embedding, metadata, pipeline_version, *, k=3):
        calls.append((label_id, tuple(query_embedding.vector)))
        return real(session, label_id, query_embedding, metadata, pipeline_version, k=k)

    monkeypatch.setattr(backfill_module, "compute_label_catalog_fit", _spy)
    return calls


def _raw(engine, statement: str, **params: object) -> None:
    with Session(engine) as session:
        session.execute(text(statement), params)
        session.commit()


def _corrupt_vector(engine, embedding_id: str) -> None:
    payload = json.dumps([float("nan"), *([0.0] * 511)])
    _raw(
        engine,
        "UPDATE music_embeddings SET embedding = :p WHERE id = :id",
        p=payload,
        id=embedding_id,
    )


def _embedding_id(engine, *, submission_id: str | None = None, reference_id: str | None = None):
    column = MusicEmbedding.submission_id if submission_id else MusicEmbedding.reference_track_id
    with Session(engine) as session:
        return session.exec(
            select(MusicEmbedding.id).where(column == (submission_id or reference_id))
        ).one()


def _cache_row_count(engine) -> int:
    with Session(engine) as session:
        return len(session.exec(select(LabelCatalogFitScoreRow)).all())


def test_missing_cache_computes_and_persists(engine, factory):
    seeded = _seed(engine)
    report = _run(factory, seeded.label_id)
    assert (report.processed, report.cache_hits, report.computed, report.persisted) == (1, 0, 1, 1)
    assert (report.not_ready, report.failures) == (0, ())
    assert _cached(engine, seeded.label_id, seeded.submission_id) is not None


def test_fresh_cache_hit_skips_compute(monkeypatch, engine, factory):
    seeded = _seed(engine)
    with Session(engine) as session:
        query = TrackEmbedding(metadata=_METADATA, vector=_dir(1.0, 2.0))
        result = compute_label_catalog_fit(session, seeded.label_id, query, _METADATA, _PIPELINE)
        persist_label_catalog_fit(
            session,
            label_id=seeded.label_id,
            query_submission_id=seeded.submission_id,
            result=result,
            metadata=_METADATA,
            pipeline_version=_PIPELINE,
            k=3,
        )
        session.commit()
    calls = _count_compute(monkeypatch)
    report = _run(factory, seeded.label_id)
    assert (report.processed, report.cache_hits, report.computed, report.persisted) == (1, 1, 0, 0)
    assert (report.not_ready, report.failures) == (0, ()) and calls == []


def test_stale_fingerprint_recomputes_and_repersists(engine, factory):
    seeded = _seed(engine)
    first = _run(factory, seeded.label_id)
    assert (first.computed, first.persisted) == (1, 1)
    _add_reference_arm(engine, seeded.label_id, title="Extra", vector=_dir(0.5, 0.5))
    second = _run(factory, seeded.label_id)
    assert (second.processed, second.cache_hits, second.computed, second.persisted) == (1, 0, 1, 1)
    cached = _cached(engine, seeded.label_id, seeded.submission_id)
    assert cached is not None and cached.eligible_count == 6


def test_corrupt_reference_vector_recorded_and_loop_continues(engine, factory):
    seeded = _seed(engine)
    second = _add_second_arm(engine, seeded.label_id)
    _corrupt_vector(engine, _embedding_id(engine, reference_id=seeded.reference_ids[0]))
    report = _run(factory, seeded.label_id)
    assert report.processed == 2
    assert (report.computed, report.persisted, report.not_ready) == (0, 0, 0)
    assert len(report.failures) == 2
    assert {failure.submission_id for failure in report.failures} == {seeded.submission_id, second}
    assert {failure.error_kind for failure in report.failures} == {"corrupt_reference_embedding"}
    assert _cache_row_count(engine) == 0


def test_corrupt_submission_vector_is_reconstruction_failure(engine, factory):
    seeded = _seed(engine)
    _add_second_arm(engine, seeded.label_id)
    _corrupt_vector(engine, _embedding_id(engine, submission_id=seeded.submission_id))
    report = _run(factory, seeded.label_id)
    assert (report.processed, report.persisted, report.computed) == (2, 1, 1)
    assert len(report.failures) == 1
    assert report.failures[0].submission_id == seeded.submission_id
    assert report.failures[0].error_kind == "embedding_reconstruction"


def test_not_ready_label_records_zero_rows(engine, factory):
    label_id = str(uuid4())
    _make_label(engine, label_id, reference_count=3)
    report = _run(factory, label_id)
    assert (report.processed, report.cache_hits) == (1, 0)
    assert (report.computed, report.persisted, report.not_ready) == (0, 0, 1)
    assert report.failures == () and _cache_row_count(engine) == 0


def test_limit_bounds_attempts_but_cache_hits_are_free(engine, factory):
    seeded = _seed(engine)
    _add_second_arm(engine, seeded.label_id)
    first = _run(factory, seeded.label_id, limit=1)
    assert (first.processed, first.cache_hits, first.computed, first.persisted) == (1, 0, 1, 1)
    second = _run(factory, seeded.label_id, limit=1)
    assert (second.processed, second.cache_hits) == (2, 1)
    assert (second.computed, second.persisted) == (1, 1)
    third = _run(factory, seeded.label_id, limit=1)
    assert (third.processed, third.cache_hits, third.computed) == (2, 2, 0)


def test_limit_validation_rejects_before_session_open(engine):
    opens = {"count": 0}

    def _counting():
        opens["count"] += 1
        return Session(engine)

    for bad in (0, -1, True, False, 1.5):
        with pytest.raises(ValueError, match="limit"):
            _run(_counting, str(uuid4()), limit=bad)
    assert opens["count"] == 0
    assert _run(_counting, str(uuid4()), limit=None).processed == 0
    assert opens["count"] == 1


def test_k_identity_partitions_cached_results(engine, factory):
    seeded = _seed(engine)
    first = _run(factory, seeded.label_id, k=3)
    second = _run(factory, seeded.label_id, k=5)
    assert (first.computed, first.persisted) == (1, 1)
    assert (second.computed, second.persisted, second.cache_hits) == (1, 1, 0)
    assert _cached(engine, seeded.label_id, seeded.submission_id, k=3) is not None
    assert _cached(engine, seeded.label_id, seeded.submission_id, k=5) is not None


def test_pipeline_version_variant_never_reuses_items(engine, factory):
    seeded = _seed(engine)
    assert _run(factory, seeded.label_id).processed == 1
    variant = backfill_label_catalog_fit(
        label_id=seeded.label_id,
        metadata=_METADATA,
        pipeline_version="prep-v2",
        session_factory=factory,
    )
    assert variant.processed == 0
    submission = seeded.submission_id
    assert _cached(engine, seeded.label_id, submission, pipeline_version="prep-v2") is None
    assert _cached(engine, seeded.label_id, submission) is not None


def test_demo_seed_integration_scores_are_stable(engine, factory):
    seeded = _seed(engine)
    assert _run(factory, seeded.label_id).persisted == 1
    with Session(engine) as session:
        row = session.exec(
            select(MusicEmbedding).where(MusicEmbedding.submission_id == seeded.submission_id)
        ).one()
        query = TrackEmbedding(metadata=_METADATA, vector=row.embedding)
        fresh = compute_label_catalog_fit(session, seeded.label_id, query, _METADATA, _PIPELINE)
    cached = _cached(engine, seeded.label_id, seeded.submission_id)
    assert cached is not None and cached.state is ReadinessState.READY
    assert cached.aggregate_score == fresh.aggregate_score
    assert {score.reference_id: score.score for score in cached.scores} == {
        score.reference_id: score.score for score in fresh.scores
    }


def test_idempotent_rerun_skips_everything(monkeypatch, engine, factory):
    seeded = _seed(engine)
    assert _run(factory, seeded.label_id).computed == 1
    calls = _count_compute(monkeypatch)
    again = _run(factory, seeded.label_id)
    assert (again.processed, again.cache_hits, again.computed, again.persisted) == (1, 1, 0, 0)
    assert calls == []


@pytest.mark.parametrize("mode", ["crash", "infra"])
def test_mid_pass_failure_preserves_prefix_and_resumes(mode, engine, factory):
    class _InfraBoomError(SQLAlchemyError):
        pass

    seeded = _seed(engine)
    _add_second_arm(engine, seeded.label_id)
    state = {"opens": 0}

    def _broken_factory():
        state["opens"] += 1
        if state["opens"] == 3:  # scan=1, item1=2, item2=3
            raise RuntimeError("simulated crash") if mode == "crash" else _InfraBoomError("lost")
        return Session(engine)

    expected = RuntimeError if mode == "crash" else _InfraBoomError
    with pytest.raises(expected):
        _run(_broken_factory, seeded.label_id)
    assert _cache_row_count(engine) == 6  # aggregate + 5 reference children for item1
    resumed = _run(factory, seeded.label_id)
    assert (resumed.processed, resumed.cache_hits, resumed.computed, resumed.persisted) == (
        2,
        1,
        1,
        1,
    )


def test_failed_reference_excluded_by_readiness(engine, factory):
    seeded = _seed(engine, reference_count=6)
    _raw(
        engine,
        "UPDATE label_reference_tracks SET status = 'failed' WHERE id = :id",
        id=seeded.reference_ids[0],
    )
    report = _run(factory, seeded.label_id)
    assert (report.processed, report.computed, report.persisted, report.failures) == (1, 1, 1, ())
    cached = _cached(engine, seeded.label_id, seeded.submission_id)
    assert cached is not None and cached.eligible_count == 5


def test_tenant_isolation_other_label_submission_not_work_item(engine, factory):
    seeded = _seed(engine)
    other = str(uuid4())
    other_submission = _make_label(engine, other, reference_count=5)
    assert _run(factory, seeded.label_id).processed == 1
    assert _cached(engine, other, other_submission) is None


def test_session_factory_required_and_callable(engine):
    opens = {"count": 0}

    def _counting():
        opens["count"] += 1
        return Session(engine)

    for bad in (None, "factory", 42):
        with pytest.raises(ValueError, match="session_factory"):
            _run(bad, str(uuid4()))
    assert opens["count"] == 0


def test_module_imports_no_claim_or_receipt_symbols():
    source = Path(backfill_module.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            imported.update(alias.name for alias in node.names)
    assert imported
    forbidden = ("claim", "resumption", "receipt", "lease", "token", "policy")
    offenders = {name for name in imported if any(word in name.lower() for word in forbidden)}
    assert offenders == set()
    assert "reference_processing_claims" not in source


def test_deterministic_order_created_at_then_id(monkeypatch, engine, factory):
    seeded = _seed(engine)
    with Session(engine) as session:
        demo_row = session.exec(
            select(MusicEmbedding).where(MusicEmbedding.submission_id == seeded.submission_id)
        ).one()
        demo_vector = list(demo_row.embedding)
        demo_created_at = demo_row.created_at
    second_vector = _dir(2.0, 1.0)
    assert second_vector != demo_vector
    second = str(uuid4())
    _add_submission_arm(
        engine,
        seeded.label_id,
        submission_id=second,
        created_at=demo_created_at,
        vector=second_vector,
        embedding_id="00000000-order-a",
    )
    calls = _count_compute(monkeypatch)
    assert _run(factory, seeded.label_id).processed == 2
    with Session(engine) as session:
        arm_b = session.exec(
            select(MusicEmbedding).where(MusicEmbedding.submission_id == second)
        ).one()
    assert calls[0][0] == seeded.label_id
    assert calls[0][1] == pytest.approx(tuple(arm_b.embedding))
    assert calls[1][1] == pytest.approx(tuple(demo_vector))


def test_tz_naive_created_at_repaired_for_reconstruction(engine, factory):
    seeded = _seed(engine)
    _raw(
        engine,
        "UPDATE music_embeddings SET created_at = '2025-03-02 10:30:00.000000' "
        "WHERE submission_id = :sid",
        sid=seeded.submission_id,
    )
    report = _run(factory, seeded.label_id)
    assert (report.processed, report.computed, report.persisted, report.failures) == (1, 1, 1, ())
    assert _cached(engine, seeded.label_id, seeded.submission_id) is not None
