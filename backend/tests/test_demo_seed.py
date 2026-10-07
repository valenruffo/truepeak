"""Tests for the demo-only synthetic seed writer (T05-D).

These tests pin: exact deterministic uuid5 ids and row shapes, CHECK
compliance proven by successful inserts, idempotent re-seeding with no
duplicates or churn, argument validation that writes zero rows, caller
rollback discarding the seed, and synthetic unit vectors that satisfy the
public TrackEmbedding contract. SQLite-only: no PostgreSQL, concurrency, or
inference claims are made or tested here.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from uuid import UUID, uuid5

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.ar_matching.demo_seed import DemoSeedResult, seed_demo_catalog_data
from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding
from app.audio.embedding.schemas import EmbeddingMetadata, TrackEmbedding
from app.models import Label, Submission

# The same fixed namespace the module is required to use, duplicated here so
# expected ids are computed independently of module internals.
_NAMESPACE = UUID("3f2a1c9e-5b7d-4e8f-9c6a-1d0b2e4f6a8c")
_LABEL_STABLE_NAME = "demo-label"
_SUBMISSION_STABLE_NAME = "demo-submission"
_METADATA = EmbeddingMetadata("test-provider", "test-model", "v1", 512)
_PIPELINE_VERSION = "prep-v1"
_BASE = datetime(2025, 3, 1, tzinfo=UTC)

_TEST_TABLES = [
    Label.__table__,
    Submission.__table__,
    LabelReferenceTrack.__table__,
    MusicEmbedding.__table__,
]

_LEGACY_IDENTITY_COLUMNS = (
    "upload_idempotency_key",
    "upload_filename",
    "upload_size_bytes",
    "upload_limit_bytes",
    "staging_key",
    "staging_etag",
    "final_etag",
)


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
    SQLModel.metadata.drop_all(test_engine, tables=_TEST_TABLES)
    test_engine.dispose()


def _expected_reference_id(index: int) -> str:
    return str(uuid5(_NAMESPACE, f"demo-reference-{index}"))


def _expected_unit_vector(stable_name: str) -> list[float]:
    """Mirror of the module's deterministic synthetic unit direction.

    Double-normalization note: the stored vector is already unit length, so
    normalizing it again is a fixed point up to float error; comparisons use
    approx tolerances rather than exact equality.
    """
    digest = uuid5(_NAMESPACE, f"demo-direction-{stable_name}").int
    x = (digest % 997) + 1.0
    y = ((digest // 997) % 991) + 1.0
    norm = math.hypot(x, y)
    return [x / norm, y / norm, *([0.0] * 510)]


def _counts(session: Session) -> dict[str, int]:
    return {
        table: session.execute(select(func.count()).select_from(model)).scalar_one()
        for table, model in (
            ("label", Label),
            ("submission", Submission),
            ("reference", LabelReferenceTrack),
            ("embedding", MusicEmbedding),
        )
    }


def _seed(session: Session, **overrides):
    kwargs = {"metadata": _METADATA, "pipeline_version": _PIPELINE_VERSION}
    kwargs.update(overrides)
    return seed_demo_catalog_data(session, **kwargs)


def test_first_seed_writes_exact_ids_and_row_shapes(engine):
    started_at = datetime.now(UTC)
    with Session(engine) as session:
        result = _seed(session)
        session.flush()
        written_at = datetime.now(UTC)

        assert isinstance(result, DemoSeedResult)
        assert result.created is True
        assert result.label_id == str(uuid5(_NAMESPACE, _LABEL_STABLE_NAME))
        assert result.submission_id == str(uuid5(_NAMESPACE, _SUBMISSION_STABLE_NAME))
        assert result.reference_ids == tuple(_expected_reference_id(index) for index in range(5))

        label = session.execute(select(Label)).scalars().one()
        assert label.id == result.label_id
        assert label.subscription_status == "active"

        references = list(session.execute(select(LabelReferenceTrack)).scalars())
        assert {reference.id for reference in references} == set(result.reference_ids)
        titles = {reference.title for reference in references}
        assert titles == {f"Demo Reference {index}" for index in range(1, 6)}
        for reference in references:
            assert reference.label_id == result.label_id
            assert reference.status == "ready"
            assert reference.is_active is True
            assert reference.artist is None

        submission = session.execute(select(Submission)).scalars().one()
        assert submission.id == result.submission_id
        assert submission.label_id == result.label_id
        assert submission.producer_name
        assert submission.producer_email
        assert submission.track_name

        embeddings = list(session.execute(select(MusicEmbedding)).scalars())
        assert len(embeddings) == 6
        ref_arm = [e for e in embeddings if e.reference_track_id is not None]
        sub_arm = [e for e in embeddings if e.submission_id is not None]
        assert len(ref_arm) == 5
        assert len(sub_arm) == 1
        assert {e.reference_track_id for e in ref_arm} == set(result.reference_ids)
        assert sub_arm[0].submission_id == result.submission_id
        assert sub_arm[0].reference_track_id is None
        for embedding in embeddings:
            assert embedding.dimension == 512
            assert embedding.segment_index == -1
            assert embedding.start_seconds is None
            assert embedding.end_seconds is None
            assert embedding.label_id == result.label_id
            assert embedding.provider == _METADATA.provider
            assert embedding.model == _METADATA.model
            assert embedding.version == _METADATA.version
            assert embedding.pipeline_version == _PIPELINE_VERSION
            # SQLite does not round-trip tzinfo, so the explicit tz-aware UTC
            # write instant is proven against the bounds of the call instead.
            written = embedding.created_at.replace(tzinfo=UTC)
            assert started_at <= written <= written_at


@pytest.mark.parametrize("reference_count", [5, 7])
def test_reference_count_is_respected(engine, reference_count):
    with Session(engine) as session:
        result = _seed(session, reference_count=reference_count)
        session.flush()

        assert len(result.reference_ids) == reference_count
        assert result.reference_ids == tuple(
            _expected_reference_id(index) for index in range(reference_count)
        )
        counts = _counts(session)
        assert counts == {
            "label": 1,
            "submission": 1,
            "reference": reference_count,
            "embedding": reference_count + 1,
        }


def test_second_seed_is_idempotent_with_same_ids_and_no_churn(engine):
    with Session(engine) as session:
        first = _seed(session)
        session.flush()
        counts_before = _counts(session)

        second = _seed(session)

        assert second.created is False
        assert second.label_id == first.label_id
        assert second.submission_id == first.submission_id
        assert second.reference_ids == first.reference_ids
        assert _counts(session) == counts_before
        assert counts_before == {
            "label": 1,
            "submission": 1,
            "reference": 5,
            "embedding": 6,
        }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("reference_count", 4),
        ("reference_count", True),
        ("reference_count", "5"),
        ("reference_count", 5.0),
        ("reference_count", None),
        ("metadata", None),
        ("metadata", "not-metadata"),
        ("metadata", {"provider": "p"}),
        ("pipeline_version", ""),
        ("pipeline_version", "   "),
        ("pipeline_version", None),
    ],
)
def test_invalid_arguments_raise_value_error_and_write_nothing(engine, field, value):
    with Session(engine) as session:
        with pytest.raises(ValueError):
            _seed(session, **{field: value})
        assert _counts(session) == {
            "label": 0,
            "submission": 0,
            "reference": 0,
            "embedding": 0,
        }


def test_ready_references_satisfy_their_check_constraints(engine):
    """Successful insert under live CHECKs is the compliance proof; the row
    reloads additionally pin the legacy-NULL identity branch that lets a
    ready reference pass the final-identity CHECKs."""
    with Session(engine) as session:
        result = _seed(session)
        session.flush()

        for index, reference_id in enumerate(result.reference_ids):
            reference = session.get(LabelReferenceTrack, reference_id)
            assert reference is not None
            assert reference.status == "ready"
            assert len(reference.title.strip()) > 0
            for column in _LEGACY_IDENTITY_COLUMNS:
                assert getattr(reference, column) is None, (index, column)
            assert reference.processing_claim_token is None


def test_embeddings_satisfy_owner_and_dimension_checks(engine):
    """Successful insert under live CHECKs is the compliance proof for the
    exactly-one-owner, dimension=512, and segment-bounds constraints."""
    with Session(engine) as session:
        _seed(session)
        session.flush()

        embeddings = list(session.execute(select(MusicEmbedding)).scalars())
        assert len(embeddings) == 6
        for embedding in embeddings:
            exactly_one_owner = (embedding.reference_track_id is None) != (
                embedding.submission_id is None
            )
            assert exactly_one_owner
            assert embedding.dimension == 512
            assert embedding.segment_index == -1
            assert embedding.start_seconds is None
            assert embedding.end_seconds is None
            for identity_field in (
                embedding.provider,
                embedding.model,
                embedding.version,
                embedding.pipeline_version,
            ):
                assert identity_field.strip()


def test_synthetic_vectors_are_unit_and_track_embedding_compatible(engine):
    with Session(engine) as session:
        _seed(session)
        session.flush()

        embeddings = list(session.execute(select(MusicEmbedding)).scalars())
        expected_by_reference = {
            _expected_reference_id(index): _expected_unit_vector(f"demo-reference-{index}")
            for index in range(5)
        }
        for embedding in embeddings:
            vector = list(embedding.embedding)
            assert len(vector) == 512
            assert math.isclose(math.dist(vector, [0.0] * 512), 1.0, rel_tol=1e-9)
            # The public schema contract accepts the vector as a real track
            # embedding shape: this constructor normalizes and would raise on
            # a zero-norm or wrong-dimension vector.
            normalized = TrackEmbedding(metadata=_METADATA, vector=vector, created_at=_BASE)
            # Double-normalization fixed point: re-normalizing an already
            # unit vector reproduces it up to float error, hence approx.
            assert vector == pytest.approx(list(normalized.vector), abs=1e-9)
            if embedding.reference_track_id is not None:
                assert vector == pytest.approx(
                    expected_by_reference[embedding.reference_track_id], abs=1e-12
                )
            else:
                assert vector == pytest.approx(
                    _expected_unit_vector(_SUBMISSION_STABLE_NAME), abs=1e-12
                )


def test_deterministic_ids_are_stable_across_engines(engine):
    with Session(engine) as session:
        first = _seed(session)
        session.flush()

    second_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    try:
        SQLModel.metadata.create_all(second_engine, tables=_TEST_TABLES)
        with Session(second_engine) as session:
            second = _seed(session)
            session.flush()
            assert second.created is True
            assert second.label_id == first.label_id
            assert second.submission_id == first.submission_id
            assert second.reference_ids == first.reference_ids
    finally:
        SQLModel.metadata.drop_all(second_engine, tables=_TEST_TABLES)
        second_engine.dispose()


def test_caller_rollback_discards_seed(engine):
    with Session(engine) as session:
        result = _seed(session)
        session.flush()
        assert _counts(session)["embedding"] == 6
        session.rollback()

    with Session(engine) as session:
        assert _counts(session) == {
            "label": 0,
            "submission": 0,
            "reference": 0,
            "embedding": 0,
        }
        again = _seed(session)
        session.flush()
        assert again.created is True
        assert again.label_id == result.label_id
