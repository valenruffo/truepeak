"""Tests for the label catalog fit scores cache service (T05-C2).

Pins the locked contract: caller-owned sessions, READY-only persistence,
canonical validation before session use, exact aggregate plus child rows,
deterministic eligibility fingerprints, identity upserts with exact child
replacement, and honest cache-hit reconstruction. SQLite-only evidence.
"""

from datetime import UTC, datetime
from hashlib import sha256
from uuid import uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.ar_matching.catalog_fit_cache import (
    CachedCatalogFitScore,
    CachedLabelCatalogFit,
    get_cached_label_catalog_fit,
    persist_label_catalog_fit,
)
from app.ar_matching.catalog_fit_scores import compute_label_catalog_fit
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
_PIPELINE_VERSION = "prep-v1"
_BASE = datetime(2025, 3, 1, tzinfo=UTC)


def _dir(x: float, y: float) -> list[float]:
    return [x, y, *([0.0] * 510)]


_QUERY = TrackEmbedding(metadata=_METADATA, vector=_dir(1.0, 2.0), created_at=_BASE)


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

    SQLModel.metadata.create_all(test_engine, tables=_TEST_TABLES)
    with Session(test_engine) as db_session:
        yield db_session
    test_engine.dispose()


def _add_embedding(db_session: Session, label: Label, reference, created_at) -> None:
    db_session.add(
        MusicEmbedding(
            label_id=label.id,
            reference_track_id=reference.id,
            embedding=_dir(3.0, 4.0),
            provider=_METADATA.provider,
            model=_METADATA.model,
            version=_METADATA.version,
            dimension=_METADATA.dimension,
            pipeline_version=_PIPELINE_VERSION,
            segment_index=-1,
            created_at=created_at,
        )
    )


def _add_ready_reference(db_session: Session, label: Label, index: int):
    reference = LabelReferenceTrack(
        label_id=label.id, title=f"Reference {index}", status="ready", is_active=True
    )
    db_session.add(reference)
    _add_embedding(db_session, label, reference, _BASE.replace(minute=index))
    db_session.flush()
    return reference


def _seed(db_session: Session, count: int, suffix: str = ""):
    token = str(uuid4())
    label = Label(
        id=token,
        name=f"Label {suffix}{count}",
        slug=f"label-{suffix}{count}-{token}",
        owner_email=f"{token}@example.test",
    )
    submission = Submission(
        id=str(uuid4()),
        label_id=label.id,
        producer_name="Producer",
        producer_email="producer@example.test",
        track_name="Demo track",
    )
    db_session.add_all([label, submission])
    db_session.flush()
    refs = [_add_ready_reference(db_session, label, index) for index in range(count)]
    db_session.flush()
    return label, submission, refs


def _ready(db_session: Session, label: Label):
    return compute_label_catalog_fit(
        db_session, label.id, _QUERY, _METADATA, _PIPELINE_VERSION, k=3
    )


def _persist(db_session: Session, label: Label, submission: Submission, **overrides):
    kwargs = {
        "label_id": label.id,
        "query_submission_id": submission.id,
        "metadata": _METADATA,
        "pipeline_version": _PIPELINE_VERSION,
        "k": 3,
    }
    kwargs.update(overrides)
    return persist_label_catalog_fit(db_session, **kwargs)


def _cached(db_session: Session, label: Label, submission: Submission, **overrides):
    kwargs = {
        "label_id": label.id,
        "query_submission_id": submission.id,
        "metadata": _METADATA,
        "pipeline_version": _PIPELINE_VERSION,
        "k": 3,
    }
    kwargs.update(overrides)
    return get_cached_label_catalog_fit(db_session, **kwargs)


def _rows(db_session: Session) -> list[LabelCatalogFitScoreRow]:
    return list(
        db_session.exec(
            select(LabelCatalogFitScoreRow).order_by(
                LabelCatalogFitScoreRow.created_at, LabelCatalogFitScoreRow.id
            )
        ).all()
    )


def _split(rows):
    aggregate = next(row for row in rows if row.reference_track_id is None)
    return aggregate, [row for row in rows if row.reference_track_id is not None]


def _expected_fingerprint(db_session: Session, label: Label) -> str:
    """Independent derivation: sorted eligible ids + newline + max embedding
    created_at as ISO-8601 UTC, SHA-256 lowercase hex (migration 012 note)."""
    rows = db_session.exec(
        select(LabelReferenceTrack.id, MusicEmbedding.created_at)
        .select_from(LabelReferenceTrack)
        .join(MusicEmbedding, MusicEmbedding.reference_track_id == LabelReferenceTrack.id)
        .where(LabelReferenceTrack.label_id == label.id)
    ).all()
    ids = sorted(row[0] for row in rows)
    newest = max(row[1] for row in rows).replace(tzinfo=UTC)
    return sha256(("\n".join(ids) + "\n" + newest.isoformat()).encode("utf-8")).hexdigest()


def test_persist_upsert_and_distinct_identities(session):
    label, submission, _refs = _seed(session, 5)
    result = _ready(session, label)
    session.commit()

    _persist(session, label, submission, result=result)

    assert not session.new and not session.dirty and not session.deleted
    aggregate, children = _split(_rows(session))
    assert (aggregate.provider, aggregate.model, aggregate.version, aggregate.dimension) == (
        _METADATA.provider,
        _METADATA.model,
        _METADATA.version,
        512,
    )
    assert (
        aggregate.label_id,
        aggregate.query_submission_id,
        aggregate.pipeline_version,
        aggregate.k,
    ) == (
        label.id,
        submission.id,
        _PIPELINE_VERSION,
        3,
    )
    assert aggregate.score == result.aggregate_score
    assert aggregate.eligible_count == 5
    fingerprint = _expected_fingerprint(session, label)
    assert aggregate.eligible_fingerprint == fingerprint
    assert len(fingerprint) == 64 and fingerprint == fingerprint.lower()
    assert len(children) == 5
    for child in children:
        match = next(
            item for item in result.scores if item.reference_id == child.reference_track_id
        )
        assert child.score == match.score
        assert (child.eligible_count, child.eligible_fingerprint, child.k) == (
            5,
            fingerprint,
            3,
        )

    _persist(session, label, submission, result=result)  # same identity: upsert in place
    first_id, first_created = aggregate.id, aggregate.created_at
    aggregate, children = _split(_rows(session))
    assert (aggregate.id, aggregate.created_at) == (first_id, first_created)
    assert aggregate.eligible_fingerprint == fingerprint  # deterministic same-seed digest
    assert len(children) == 5 and len({child.id for child in children}) == 5
    assert {child.id for child in children} != {row.id for row in _rows(session)}

    _persist(session, label, submission, result=result, k=5)
    _persist(
        session,
        label,
        submission,
        result=result,
        metadata=EmbeddingMetadata("other-provider", "test-model", "v1", 512),
    )
    _persist(session, label, submission, result=result, pipeline_version="prep-v2")
    rows = _rows(session)
    aggregates = [row for row in rows if row.reference_track_id is None]
    assert len(rows) == 24 and len(aggregates) == 4
    assert {(row.k, row.provider, row.pipeline_version) for row in aggregates} == {
        (3, "test-provider", "prep-v1"),
        (5, "test-provider", "prep-v1"),
        (3, "other-provider", "prep-v1"),
        (3, "test-provider", "prep-v2"),
    }

    _add_ready_reference(session, label, 5)  # eligibility grows; upsert replaces children
    result6 = _ready(session, label)
    assert (result6.state, result6.eligible_count) == (ReadinessState.READY, 6)
    _persist(session, label, submission, result=result6)
    baseline = [
        row
        for row in _rows(session)
        if (row.k, row.provider, row.pipeline_version) == (3, "test-provider", "prep-v1")
    ]
    aggregate, children = _split(baseline)
    assert len(baseline) == 7
    assert aggregate.eligible_count == 6
    assert aggregate.eligible_fingerprint == _expected_fingerprint(session, label)
    assert aggregate.eligible_fingerprint != fingerprint
    assert len(children) == 6
    assert {child.reference_track_id for child in children} == {
        item.reference_id for item in result6.scores
    }


def test_non_ready_result_is_rejected_without_writes(session):
    building_label, building_submission, _b = _seed(session, 4, "b-")
    empty_label, empty_submission, _e = _seed(session, 0, "e-")
    building = _ready(session, building_label)
    no_dna = _ready(session, empty_label)
    session.commit()
    assert building.state is ReadinessState.BUILDING
    assert no_dna.state is ReadinessState.NO_DNA

    for result, cached_label, cached_submission in (
        (building, building_label, building_submission),
        (no_dna, empty_label, empty_submission),
    ):
        with pytest.raises(ValueError, match="READY"):
            _persist(session, cached_label, cached_submission, result=result)

    assert _rows(session) == []


def test_get_cached_hit_round_trips_stored_values_in_stored_order(session):
    label, submission, _refs = _seed(session, 5)
    result = _ready(session, label)
    session.commit()
    _persist(session, label, submission, result=result)
    _aggregate, children = _split(_rows(session))

    cached = _cached(session, label, submission)

    assert type(cached) is CachedLabelCatalogFit
    assert cached.state is ReadinessState.READY
    assert cached.aggregate_score == result.aggregate_score
    assert (cached.eligible_count, cached.minimum_valid_references) == (5, 5)
    assert all(type(score) is CachedCatalogFitScore for score in cached.scores)
    assert [score.reference_id for score in cached.scores] == [
        child.reference_track_id for child in children
    ]
    assert [score.score for score in cached.scores] == [child.score for child in children]
    assert not session.new and not session.dirty and not session.deleted


def test_get_cached_misses(session):
    label, submission, refs = _seed(session, 5)
    other_label, other_submission, _o = _seed(session, 5, "o-")
    session.commit()
    assert _cached(session, label, submission) is None  # never cached
    assert _cached(session, other_label, other_submission) is None  # wrong tenant pair

    _persist(session, label, submission, result=_ready(session, label))
    embedding = session.exec(
        select(MusicEmbedding).where(MusicEmbedding.reference_track_id == refs[0].id)
    ).one()
    session.delete(embedding)  # stale: eligibility shrank, fresh fingerprint differs
    session.flush()
    assert _cached(session, label, submission) is None

    _add_embedding(session, label, refs[0], _BASE.replace(hour=6))
    session.flush()
    _persist(session, label, submission, result=_ready(session, label))  # re-fill heals the cache
    assert _cached(session, label, submission) is not None
    _aggregate, children = _split(_rows(session))
    session.delete(children[0])  # child-count inconsistency: fingerprint fresh, count off
    session.flush()
    assert _cached(session, label, submission) is None

    aggregate, _children = _split(_rows(session))
    session.delete(aggregate)  # missing aggregate: children may remain
    session.flush()
    assert _cached(session, label, submission) is None
    assert len(_rows(session)) == 4


def test_persist_is_caller_transaction_scoped(session):
    label, submission, _refs = _seed(session, 5)
    session.commit()
    with session.begin() as transaction:
        _persist(session, label, submission, result=_ready(session, label))
        assert len(_rows(session)) == 6  # flushed inside the caller's transaction
        transaction.rollback()  # the caller owns the outcome; nothing committed inside
    assert _rows(session) == []  # caller rollback discards everything


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"label_id": "not-a-uuid"}, "label_id must"),
        ({"label_id": str(uuid4()).upper()}, "label_id must"),
        ({"query_submission_id": "not-a-uuid"}, "query_submission_id must"),
        ({"result": "not-a-result"}, "result must"),
        ({"result": None}, "result must"),
        ({"metadata": "not-metadata"}, "metadata must"),
        ({"pipeline_version": ""}, "pipeline_version must"),
        ({"pipeline_version": 7}, "pipeline_version must"),
        ({"k": 0}, "k must"),
        ({"k": True}, "k must"),
        ({"k": 3.0}, "k must"),
    ],
)
def test_validation_rejects_before_any_session_use(session, overrides, message):
    label, submission, _refs = _seed(session, 5)
    session.commit()

    kwargs = {"result": _ready(session, label)}
    kwargs.update(overrides)
    with pytest.raises(ValueError, match=message):
        _persist(session, label, submission, **kwargs)
    assert _rows(session) == []
    if "result" not in overrides:
        with pytest.raises(ValueError, match=message):
            _cached(session, label, submission, **overrides)
    assert _rows(session) == []
