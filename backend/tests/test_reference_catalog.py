"""Read-only tenant-scoped catalog and label-DNA readiness tests."""

from __future__ import annotations

import json
from dataclasses import FrozenInstanceError, fields
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.ar_matching.reference_catalog import (
    CorruptReferenceEmbeddingError,
    ReadinessState,
    get_label_dna_readiness,
    list_reference_catalog,
)
from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding
from app.audio.embedding.schemas import EmbeddingMetadata
from app.models import Label, Submission

_TEST_TABLES = [
    Label.__table__,
    Submission.__table__,
    LabelReferenceTrack.__table__,
    MusicEmbedding.__table__,
]
_METADATA = EmbeddingMetadata("test-provider", "test-model", "v1", 512)
_VECTOR = [3.0, 4.0, *([0.0] * 510)]


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
    status: str = "ready",
    is_active: bool = True,
    created_at: datetime | None = None,
) -> LabelReferenceTrack:
    values = {"label_id": label.id, "title": title, "status": status, "is_active": is_active}
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
    **overrides,
) -> MusicEmbedding:
    values = {
        "label_id": label.id,
        "reference_track_id": reference.id,
        "embedding": _VECTOR,
        "provider": _METADATA.provider,
        "model": _METADATA.model,
        "version": _METADATA.version,
        "dimension": _METADATA.dimension,
        "pipeline_version": "prep-v1",
        "segment_index": -1,
    }
    values.update(overrides)
    row = MusicEmbedding(**values)
    session.add(row)
    session.flush()
    return row


def _add_ready_reference(session: Session, label: Label, index: int) -> LabelReferenceTrack:
    reference = _new_reference(session, label, title=f"Reference {index}")
    _add_embedding(session, label, reference)
    return reference


def test_catalog_is_tenant_scoped_deterministic_metadata_only_and_immutable(engine):
    base = datetime(2025, 1, 1, tzinfo=UTC)
    with Session(engine) as session:
        label_a = _new_label(session, "Label A")
        label_b = _new_label(session, "Label B")
        second = _new_reference(
            session,
            label_a,
            title="Second",
            created_at=base + timedelta(days=1),
        )
        first_tie = _new_reference(session, label_a, title="First tie", created_at=base)
        second_tie = _new_reference(session, label_a, title="Second tie", created_at=base)
        _new_reference(session, label_b, title="Private tenant title")
        first_tie.storage_key = "private/object/key"
        session.commit()

        catalog = list_reference_catalog(session, label_a.id)

        tie_order = sorted((first_tie, second_tie), key=lambda item: item.id)
        assert [item.id for item in catalog] == [tie_order[0].id, tie_order[1].id, second.id]
        assert [item.title for item in catalog] == [
            tie_order[0].title,
            tie_order[1].title,
            "Second",
        ]
        assert {field.name for field in fields(catalog[0])} == {
            "id",
            "title",
            "artist",
            "status",
            "is_active",
            "duration_seconds",
            "created_at",
            "updated_at",
        }
        assert not hasattr(catalog[0], "storage_key")
        assert not hasattr(catalog[0], "embedding")
        assert "Private tenant title" not in {item.title for item in catalog}
        with pytest.raises(FrozenInstanceError):
            catalog[0].title = "mutated"


def test_empty_catalog_reports_no_dna_and_queries_do_not_mutate_session(engine):
    with Session(engine) as session:
        label = _new_label(session, "Empty")
        session.commit()
        snapshot = get_label_dna_readiness(session, label.id, _METADATA, "prep-v1")

        assert snapshot.state is ReadinessState.NO_DNA
        assert snapshot.active_reference_count == 0
        assert snapshot.eligible_count == 0
        assert snapshot.eligible_references == ()
        assert not session.new and not session.dirty and not session.deleted


def test_four_valid_references_building_five_ready_and_tenant_isolation(engine):
    with Session(engine) as session:
        label_a = _new_label(session, "Label A")
        label_b = _new_label(session, "Label B")
        refs_a = [_add_ready_reference(session, label_a, i) for i in range(4)]
        refs_b = [_add_ready_reference(session, label_b, i) for i in range(5)]
        session.commit()

        a_before = get_label_dna_readiness(session, label_a.id, _METADATA, "prep-v1")
        b_before = get_label_dna_readiness(session, label_b.id, _METADATA, "prep-v1")
        refs_a.append(_add_ready_reference(session, label_a, 4))
        session.commit()
        a_after = get_label_dna_readiness(session, label_a.id, _METADATA, "prep-v1")

        assert a_before.state is ReadinessState.BUILDING and a_before.eligible_count == 4
        assert b_before.state is ReadinessState.READY and b_before.eligible_count == 5
        assert {item.reference_id for item in b_before.eligible_references} == {
            ref.id for ref in refs_b
        }
        assert a_after.state is ReadinessState.READY and a_after.eligible_count == 5
        assert {item.reference_id for item in a_after.eligible_references} == {
            ref.id for ref in refs_a
        }
        assert all(item.embedding.metadata == _METADATA for item in a_after.eligible_references)
        expected_vector = pytest.approx((0.6, 0.8, *([0.0] * 510)))
        assert all(item.embedding.vector == expected_vector for item in a_after.eligible_references)
        with pytest.raises(FrozenInstanceError):
            a_after.eligible_references[0].reference_id = "changed"


def test_readiness_counts_active_nonready_refs_as_building_but_excludes_them(engine):
    with Session(engine) as session:
        label = _new_label(session, "Pending references")
        for status in ("uploaded", "processing", "failed"):
            reference = _new_reference(session, label, status=status)
            _add_embedding(session, label, reference)
        inactive = _new_reference(session, label, is_active=False)
        _add_embedding(session, label, inactive)
        ready_segment_only = _new_reference(session, label)
        _add_embedding(
            session,
            label,
            ready_segment_only,
            segment_index=0,
            start_seconds=0.0,
            end_seconds=1.0,
        )
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
            ready_segment_only,
            reference_track_id=None,
            submission_id=submission.id,
        )
        session.commit()

        snapshot = get_label_dna_readiness(session, label.id, _METADATA, "prep-v1")

        assert snapshot.state is ReadinessState.BUILDING
        assert snapshot.active_reference_count == 4
        assert snapshot.eligible_count == 0
        assert snapshot.eligible_references == ()


@pytest.mark.parametrize(
    ("field", "mismatch"),
    [
        ("provider", "other-provider"),
        ("model", "other-model"),
        ("version", "v2"),
        ("pipeline_version", "prep-v2"),
    ],
)
def test_readiness_requires_every_identity_field_and_pipeline(field, mismatch, engine):
    with Session(engine) as session:
        label = _new_label(session, f"Mismatch {field}")
        refs = [_new_reference(session, label, title=f"R{i}") for i in range(5)]
        for reference in refs[:4]:
            _add_embedding(session, label, reference)
        _add_embedding(session, label, refs[4], **{field: mismatch})
        session.commit()

        snapshot = get_label_dna_readiness(session, label.id, _METADATA, "prep-v1")

        assert snapshot.state is ReadinessState.BUILDING
        assert snapshot.eligible_count == 4
        assert refs[4].id not in {item.reference_id for item in snapshot.eligible_references}


def test_model_versions_coexist_and_each_query_selects_exact_revision(engine):
    metadata_v2 = EmbeddingMetadata("test-provider", "test-model", "v2", 512)
    with Session(engine) as session:
        label = _new_label(session, "Version coexistence")
        references = [_new_reference(session, label, title=f"R{i}") for i in range(5)]
        for reference in references:
            _add_embedding(session, label, reference)
            _add_embedding(session, label, reference, version="v2")
        session.commit()

        v1 = get_label_dna_readiness(session, label.id, _METADATA, "prep-v1")
        v2 = get_label_dna_readiness(session, label.id, metadata_v2, "prep-v1")

        assert v1.state is v2.state is ReadinessState.READY
        assert {item.embedding.metadata.version for item in v1.eligible_references} == {"v1"}
        assert {item.embedding.metadata.version for item in v2.eligible_references} == {"v2"}


@pytest.mark.parametrize("label_id", ["", "   ", None, 12])
def test_invalid_label_scope_is_rejected_without_normalizing_identity(engine, label_id):
    with Session(engine) as session, pytest.raises(ValueError):
        list_reference_catalog(session, label_id)


def test_nonblank_label_identity_is_used_without_trimming(engine):
    with Session(engine) as session:
        label = _new_label(session, "Spaced identity")
        original_id = label.id
        label.id = f" {original_id} "
        session.flush()
        reference = _new_reference(session, label)
        session.commit()

        assert [item.id for item in list_reference_catalog(session, label.id)] == [reference.id]
        assert list_reference_catalog(session, original_id) == ()


@pytest.mark.parametrize(
    "metadata,pipeline",
    [
        (EmbeddingMetadata("provider", "model", "v1", 511), "prep-v1"),
        (_METADATA, ""),
        (_METADATA, "   "),
        (_METADATA, None),
        (None, "prep-v1"),
    ],
)
def test_invalid_embedding_scope_is_rejected(engine, metadata, pipeline):
    with Session(engine) as session, pytest.raises(ValueError):
        get_label_dna_readiness(session, "label", metadata, pipeline)


def test_malformed_persisted_raw_vector_raises_typed_catalog_error(engine):
    with Session(engine) as session:
        label = _new_label(session, "Corrupt vector")
        reference = _new_reference(session, label)
        embedding = _add_embedding(session, label, reference)
        session.execute(
            text("UPDATE music_embeddings SET embedding = :value WHERE id = :id"),
            {"value": json.dumps([float("nan"), *([0.0] * 511)]), "id": embedding.id},
        )
        session.commit()
        session.expire_all()

        with pytest.raises(CorruptReferenceEmbeddingError):
            get_label_dna_readiness(session, label.id, _METADATA, "prep-v1")


def test_unrelated_database_failures_propagate(engine, monkeypatch):
    with Session(engine) as session:
        label = _new_label(session, "DB failure")
        session.commit()

        def fail(*_args, **_kwargs):
            raise RuntimeError("database unavailable")

        monkeypatch.setattr(session, "exec", fail)
        with pytest.raises(RuntimeError, match="database unavailable"):
            list_reference_catalog(session, label.id)


@pytest.mark.parametrize("query_kind", ["catalog", "readiness"])
def test_catalog_reads_do_not_autoflush_or_change_persisted_view(engine, query_kind):
    with Session(engine, autoflush=True) as session:
        label = _new_label(session, f"Autoflush {query_kind}")
        reference = _add_ready_reference(session, label, 0)
        label_id = label.id
        reference_id = reference.id
        session.commit()
        session.expire_all()

        existing = session.get(LabelReferenceTrack, reference_id)
        existing.title = "Dirty but unflushed"
        pending = LabelReferenceTrack(
            label_id=label_id,
            title="Pending but unflushed",
            status="ready",
            is_active=True,
        )
        session.add(pending)
        pending_id = pending.id

        flushes: list[bool] = []
        selects: list[str] = []

        def record_flush(*_args):
            flushes.append(True)

        def record_select(_connection, _cursor, statement, _parameters, _context, _executemany):
            if statement.lstrip().upper().startswith("SELECT"):
                selects.append(statement)

        event.listen(session, "before_flush", record_flush)
        event.listen(engine, "before_cursor_execute", record_select)
        try:
            if query_kind == "catalog":
                result = list_reference_catalog(session, label_id)
            else:
                result = get_label_dna_readiness(session, label_id, _METADATA, "prep-v1")
        finally:
            event.remove(session, "before_flush", record_flush)
            event.remove(engine, "before_cursor_execute", record_select)

        assert flushes == []
        assert pending in session.new
        assert existing in session.dirty
        assert pending.title == "Pending but unflushed"
        assert existing.title == "Dirty but unflushed"
        assert len(selects) == 1

        connection = session.connection()
        persisted_title = connection.exec_driver_sql(
            "SELECT title FROM label_reference_tracks WHERE id = ?", (reference_id,)
        ).scalar_one()
        pending_count = connection.exec_driver_sql(
            "SELECT COUNT(*) FROM label_reference_tracks WHERE id = ?", (pending_id,)
        ).scalar_one()
        assert persisted_title == "Reference 0"
        assert pending_count == 0

        if query_kind == "catalog":
            assert [item.title for item in result] == ["Reference 0"]
        else:
            assert result.active_reference_count == 1
            assert result.eligible_count == 1
            assert result.eligible_references[0].title == "Reference 0"
