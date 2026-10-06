"""Tests for compute-on-read label catalog fit scores (T05-S).

Catalog fit scores are raw cosine-family similarities computed at read time;
the tests pin determinism, honest no-score state mapping, tenant isolation,
read-only session behavior, and exact propagation of readiness/similarity
errors. Nothing here asserts calibrated 0-100 probabilities or quality.
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.ar_matching.catalog_fit_scores import (
    CatalogFitScore,
    LabelCatalogFitResult,
    compute_label_catalog_fit,
)
from app.ar_matching.reference_catalog import (
    CorruptReferenceEmbeddingError,
    ReadinessState,
)
from app.ar_matching.similarity import catalog_fit, cosine_similarity, normalized_centroid
from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding
from app.audio.embedding.schemas import EmbeddingMetadata, SegmentEmbedding, TrackEmbedding
from app.models import Label, Submission

_TEST_TABLES = [
    Label.__table__,
    Submission.__table__,
    LabelReferenceTrack.__table__,
    MusicEmbedding.__table__,
]
_METADATA = EmbeddingMetadata("test-provider", "test-model", "v1", 512)
_PIPELINE_VERSION = "prep-v1"
_BASE = datetime(2025, 3, 1, tzinfo=UTC)


def _dir(x: float, y: float) -> list[float]:
    """Return a deterministic raw 512-dimensional direction vector."""
    return [x, y, *([0.0] * 510)]


_QUERY = TrackEmbedding(metadata=_METADATA, vector=_dir(1.0, 2.0), created_at=_BASE)


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


def _new_label(session: Session, name: str) -> Label:
    token = str(uuid4())
    label = Label(
        id=token,
        name=name,
        slug=f"{name.lower().replace(' ', '-')}-{token}",
        owner_email=f"{token}@example.test",
    )
    session.add(label)
    session.flush()
    return label


def _new_reference(
    session: Session,
    label: Label,
    *,
    title: str = "Reference",
    artist: str | None = None,
    status: str = "ready",
    is_active: bool = True,
    created_at: datetime | None = None,
) -> LabelReferenceTrack:
    values = {
        "label_id": label.id,
        "title": title,
        "artist": artist,
        "status": status,
        "is_active": is_active,
    }
    if created_at is not None:
        values["created_at"] = created_at
    reference = LabelReferenceTrack(**values)
    session.add(reference)
    session.flush()
    return reference


def _add_embedding(
    session: Session,
    label: Label,
    reference: LabelReferenceTrack,
    *,
    vector: list[float] | None = None,
    **overrides,
) -> MusicEmbedding:
    values = {
        "label_id": label.id,
        "reference_track_id": reference.id,
        "embedding": vector if vector is not None else _dir(3.0, 4.0),
        "provider": _METADATA.provider,
        "model": _METADATA.model,
        "version": _METADATA.version,
        "dimension": _METADATA.dimension,
        "pipeline_version": _PIPELINE_VERSION,
        "segment_index": -1,
    }
    values.update(overrides)
    row = MusicEmbedding(**values)
    session.add(row)
    session.flush()
    return row


def _add_ready_reference(
    session: Session,
    label: Label,
    index: int,
    *,
    vector: list[float] | None = None,
    created_at: datetime | None = None,
    artist: str | None = None,
) -> LabelReferenceTrack:
    reference = _new_reference(
        session,
        label,
        title=f"Reference {index}",
        artist=artist,
        created_at=created_at,
    )
    _add_embedding(session, label, reference, vector=vector)
    return reference


def _row_counts(session: Session) -> dict[str, int]:
    return {
        "label": session.exec(select(func.count()).select_from(Label)).one(),
        "reference": session.exec(select(func.count()).select_from(LabelReferenceTrack)).one(),
        "embedding": session.exec(select(func.count()).select_from(MusicEmbedding)).one(),
    }


def _stored_then_seam_vector(raw: list[float]) -> tuple[float, ...]:
    """Mirror the exact stored round-trip: Vector512 normalizes on write, then
    the readiness seam re-normalizes the stored unit vector inside
    TrackEmbedding. Both steps reuse the public normalized_centroid algorithm."""
    stored = normalized_centroid((tuple(raw),))
    return TrackEmbedding(metadata=_METADATA, vector=list(stored), created_at=_BASE).vector


def test_ready_scores_match_similarity_contract_and_are_deterministic(engine):
    raw_vectors = [_dir(3.0, 4.0), _dir(1.0, 1.0), _dir(4.0, 1.0), _dir(2.0, 2.0), _dir(5.0, 1.0)]
    with Session(engine) as session:
        label = _new_label(session, "Ready label")
        refs = [
            _add_ready_reference(
                session,
                label,
                index,
                vector=raw_vectors[index],
                created_at=_BASE.replace(minute=index),
                artist=None if index % 2 else "Artist",
            )
            for index in range(5)
        ]
        session.commit()
        counts_before = _row_counts(session)

        result = compute_label_catalog_fit(session, label.id, _QUERY, _METADATA, _PIPELINE_VERSION)

        counts_after = _row_counts(session)
        expected_vectors = [_stored_then_seam_vector(raw) for raw in raw_vectors]
        expected_aggregate = catalog_fit(_QUERY.vector, expected_vectors, k=3)
        assert result.state is ReadinessState.READY
        assert result.active_reference_count == 5
        assert result.eligible_count == 5
        assert result.minimum_valid_references == 5
        assert result.aggregate_score == expected_aggregate
        assert result.aggregate_score == pytest.approx(expected_aggregate, rel=0.0)
        assert [score.reference_id for score in result.scores] == [ref.id for ref in refs]
        assert [score.score for score in result.scores] == [
            cosine_similarity(_QUERY.vector, expected_vectors[index]) for index in range(5)
        ]
        # Independent hand computation: cos((1,2,0...), (3,4,0...)) = 11 / (5 * sqrt(5)).
        assert result.scores[0].score == pytest.approx(11.0 / (5.0 * math.sqrt(5.0)))
        assert [score.title for score in result.scores] == [
            f"Reference {index}" for index in range(5)
        ]
        assert [score.artist for score in result.scores] == [
            "Artist",
            None,
            "Artist",
            None,
            "Artist",
        ]
        assert all(-1.0 <= score.score <= 1.0 for score in result.scores)
        assert isinstance(result.scores[0], CatalogFitScore)
        assert result == compute_label_catalog_fit(
            session, label.id, _QUERY, _METADATA, _PIPELINE_VERSION
        )
        assert counts_before == counts_after
        assert not session.new and not session.dirty and not session.deleted


def test_no_dna_label_maps_to_no_score_result_not_error(engine):
    with Session(engine) as session:
        label = _new_label(session, "Empty label")
        session.commit()
        counts_before = _row_counts(session)

        result = compute_label_catalog_fit(session, label.id, _QUERY, _METADATA, _PIPELINE_VERSION)

        assert result.state is ReadinessState.NO_DNA
        assert result.scores == ()
        assert result.aggregate_score is None
        assert result.active_reference_count == 0
        assert result.eligible_count == 0
        assert result.minimum_valid_references == 5
        assert counts_before == _row_counts(session)


def test_building_label_below_minimum_maps_to_no_score_result(engine):
    with Session(engine) as session:
        label = _new_label(session, "Building label")
        refs = [
            _add_ready_reference(session, label, index, created_at=_BASE.replace(minute=index))
            for index in range(4)
        ]
        pending = _new_reference(session, label, title="Pending", status="processing")
        _add_embedding(session, label, pending)
        _new_reference(session, label, title="Missing embedding")
        session.commit()
        counts_before = _row_counts(session)

        result = compute_label_catalog_fit(session, label.id, _QUERY, _METADATA, _PIPELINE_VERSION)

        assert result.state is ReadinessState.BUILDING
        assert result.scores == ()
        assert result.aggregate_score is None
        assert result.active_reference_count == 6
        assert result.eligible_count == 4
        assert result.minimum_valid_references == 5
        assert {ref.id for ref in refs}.isdisjoint({score.reference_id for score in result.scores})
        assert counts_before == _row_counts(session)


def test_demo_submission_arm_embedding_is_never_scored(engine):
    with Session(engine) as session:
        label = _new_label(session, "Demo arm label")
        refs = [_add_ready_reference(session, label, index) for index in range(5)]
        submission = Submission(
            label_id=label.id,
            producer_name="Producer",
            producer_email="producer@example.test",
            track_name="Demo",
        )
        session.add(submission)
        session.flush()
        _add_embedding(
            session,
            label,
            refs[0],
            reference_track_id=None,
            submission_id=submission.id,
        )
        session.commit()

        result = compute_label_catalog_fit(session, label.id, _QUERY, _METADATA, _PIPELINE_VERSION)

        assert result.state is ReadinessState.READY
        assert result.eligible_count == 5
        assert all(score.reference_id for score in result.scores)


def test_inactive_and_nonready_references_are_never_scored(engine):
    with Session(engine) as session:
        label = _new_label(session, "Exclusions label")
        refs = [
            _add_ready_reference(session, label, index, created_at=_BASE.replace(minute=index))
            for index in range(5)
        ]
        inactive = _new_reference(session, label, title="Inactive", is_active=False)
        _add_embedding(session, label, inactive)
        active_nonready = _new_reference(session, label, title="Staging", status="uploaded")
        _add_embedding(session, label, active_nonready)
        session.commit()
        counts_before = _row_counts(session)

        result = compute_label_catalog_fit(session, label.id, _QUERY, _METADATA, _PIPELINE_VERSION)

        scored_ids = {score.reference_id for score in result.scores}
        assert result.state is ReadinessState.READY
        assert result.active_reference_count == 6
        assert result.eligible_count == 5
        assert scored_ids == {ref.id for ref in refs}
        assert inactive.id not in scored_ids
        assert active_nonready.id not in scored_ids
        assert counts_before == _row_counts(session)


def test_scores_never_include_another_labels_references(engine):
    with Session(engine) as session:
        label_a = _new_label(session, "Label A")
        label_b = _new_label(session, "Label B")
        refs_a = [
            _add_ready_reference(session, label_a, index, created_at=_BASE.replace(minute=index))
            for index in range(5)
        ]
        refs_b = [_add_ready_reference(session, label_b, index) for index in range(5)]
        session.commit()

        result_a = compute_label_catalog_fit(
            session, label_a.id, _QUERY, _METADATA, _PIPELINE_VERSION
        )
        result_b = compute_label_catalog_fit(
            session, label_b.id, _QUERY, _METADATA, _PIPELINE_VERSION
        )

        assert {score.reference_id for score in result_a.scores} == {ref.id for ref in refs_a}
        assert {score.reference_id for score in result_b.scores} == {ref.id for ref in refs_b}
        assert result_a.scores != result_b.scores


def test_corrupt_stored_vector_propagates_readiness_error(engine):
    with Session(engine) as session:
        label = _new_label(session, "Corrupt label")
        embeddings = [
            _add_embedding(session, label, _new_reference(session, label, title=f"R{index}"))
            for index in range(5)
        ]
        session.execute(
            text("UPDATE music_embeddings SET embedding = :value WHERE id = :id"),
            {"value": json.dumps([float("nan"), *([0.0] * 511)]), "id": embeddings[0].id},
        )
        session.commit()
        counts_before = _row_counts(session)

        with pytest.raises(CorruptReferenceEmbeddingError):
            compute_label_catalog_fit(session, label.id, _QUERY, _METADATA, _PIPELINE_VERSION)

        assert counts_before == _row_counts(session)


def test_cancelled_centroid_propagates_similarity_error(engine):
    cancelling = [_dir(1.0, 0.0), _dir(-1.0, 0.0), _dir(0.0, 1.0), _dir(0.0, -1.0)]
    cancelling += [_dir(2.0, 3.0), _dir(-2.0, -3.0)]
    with Session(engine) as session:
        label = _new_label(session, "Cancelled label")
        for index, vector in enumerate(cancelling):
            _add_ready_reference(session, label, index, vector=vector)
        session.commit()

        with pytest.raises(ValueError, match="centroid is cancelled"):
            compute_label_catalog_fit(session, label.id, _QUERY, _METADATA, _PIPELINE_VERSION)


def test_dimension_mismatch_metadata_uses_readiness_seam_rejection(engine):
    with Session(engine) as session:
        label = _new_label(session, "Dimension label")
        _add_ready_reference(session, label, 0)
        session.commit()
        counts_before = _row_counts(session)
        wrong_dimension = EmbeddingMetadata("test-provider", "test-model", "v1", 384)

        with pytest.raises(ValueError, match="dimension 512"):
            compute_label_catalog_fit(session, label.id, _QUERY, wrong_dimension, _PIPELINE_VERSION)

        assert counts_before == _row_counts(session)


@pytest.mark.parametrize(
    ("label_id", "query_embedding", "metadata", "pipeline_version"),
    [
        ("not-a-uuid", _QUERY, _METADATA, _PIPELINE_VERSION),
        (str(uuid4()).upper(), _QUERY, _METADATA, _PIPELINE_VERSION),
        (uuid4().hex, _QUERY, _METADATA, _PIPELINE_VERSION),
        (None, _QUERY, _METADATA, _PIPELINE_VERSION),
        (str(uuid4()), "not-an-embedding", _METADATA, _PIPELINE_VERSION),
        (str(uuid4()), _QUERY.vector, _METADATA, _PIPELINE_VERSION),
        (str(uuid4()), None, _METADATA, _PIPELINE_VERSION),
        (str(uuid4()), _QUERY, "not-metadata", _PIPELINE_VERSION),
        (str(uuid4()), _QUERY, None, _PIPELINE_VERSION),
        (str(uuid4()), _QUERY, _METADATA, ""),
        (str(uuid4()), _QUERY, _METADATA, "   "),
        (str(uuid4()), _QUERY, _METADATA, None),
    ],
)
def test_validation_fails_before_any_session_use(
    engine, label_id, query_embedding, metadata, pipeline_version
):
    # session=None proves validation precedes any session access.
    with pytest.raises(ValueError):
        compute_label_catalog_fit(None, label_id, query_embedding, metadata, pipeline_version)


def test_noncanonical_label_identity_is_rejected_before_readiness(engine):
    with Session(engine) as session:
        label = _new_label(session, "Spaced identity")
        label.id = f" {label.id} "
        session.flush()
        for index in range(5):
            _add_ready_reference(session, label, index)
        session.commit()
        counts_before = _row_counts(session)
        spaced_id = label.id

        with pytest.raises(ValueError, match="canonical UUID"):
            compute_label_catalog_fit(session, spaced_id, _QUERY, _METADATA, _PIPELINE_VERSION)

        assert counts_before == _row_counts(session)


def test_result_and_scores_are_immutable_value_records(engine):
    with Session(engine) as session:
        label = _new_label(session, "Frozen label")
        for index in range(5):
            _add_ready_reference(session, label, index)
        session.commit()

        result = compute_label_catalog_fit(session, label.id, _QUERY, _METADATA, _PIPELINE_VERSION)

        with pytest.raises(AttributeError):
            result.state = ReadinessState.NO_DNA
        with pytest.raises(AttributeError):
            result.scores[0].score = 0.5
        assert isinstance(result, LabelCatalogFitResult)


def test_segment_embedding_is_not_accepted_as_query(engine):
    segment = SegmentEmbedding(
        metadata=_METADATA,
        vector=_dir(1.0, 2.0),
        start_seconds=0.0,
        end_seconds=1.0,
        created_at=_BASE,
    )
    with pytest.raises(ValueError, match="TrackEmbedding"):
        compute_label_catalog_fit(None, str(uuid4()), segment, _METADATA, _PIPELINE_VERSION)
