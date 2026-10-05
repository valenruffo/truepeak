"""SQLite contract tests for the unused Label DNA storage-model slice.

SQLite exercises ORM constraints and bind validation only; PostgreSQL vector,
extension, grants, and RLS behavior require the isolated checks documented in
``docs/label-dna-storage.md``.
"""

from __future__ import annotations

import builtins
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import delete, event, func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding
from app.ar_matching.vector_type import Vector512
from app.models import Label, Submission

_TEST_TABLES = [
    Label.__table__,
    Submission.__table__,
    LabelReferenceTrack.__table__,
    MusicEmbedding.__table__,
]
_VECTOR = [3.0, 4.0, *([0.0] * 510)]


@pytest.fixture
def engine():
    """Provide isolated SQLite tables with FK enforcement explicitly enabled."""
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


def _new_label(session: Session, suffix: str) -> Label:
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


def _new_submission(session: Session, label: Label) -> Submission:
    submission = Submission(
        label_id=label.id,
        producer_name="Producer",
        producer_email="producer@example.test",
        track_name="Demo",
    )
    session.add(submission)
    session.flush()
    return submission


def _new_reference(session: Session, label: Label) -> LabelReferenceTrack:
    reference = LabelReferenceTrack(label_id=label.id, title="Reference")
    session.add(reference)
    session.flush()
    return reference


def _embedding(
    label: Label,
    *,
    reference_id: str | None = None,
    submission_id: str | None = None,
    **overrides,
) -> MusicEmbedding:
    values = {
        "label_id": label.id,
        "reference_track_id": reference_id,
        "submission_id": submission_id,
        "embedding": _VECTOR,
        "provider": "test-provider",
        "model": "test-model",
        "version": "v1",
        "dimension": 512,
        "pipeline_version": "prep-v1",
        "segment_index": -1,
    }
    values.update(overrides)
    return MusicEmbedding(**values)


def test_valid_reference_and_submission_embeddings_round_trip_normalized(engine):
    with Session(engine) as session:
        label = _new_label(session, "valid")
        reference = _new_reference(session, label)
        submission = _new_submission(session, label)
        reference_embedding = _embedding(label, reference_id=reference.id)
        demo_embedding = _embedding(label, submission_id=submission.id)
        session.add_all([reference_embedding, demo_embedding])
        session.commit()

        loaded = session.get(MusicEmbedding, reference_embedding.id)
        assert loaded is not None
        assert loaded.embedding[:2] == pytest.approx([0.6, 0.8])
        assert loaded.embedding[2:] == [0.0] * 510
        assert session.get(MusicEmbedding, demo_embedding.id) is not None


def test_reference_title_status_and_embedding_identity_checks_run_in_database(engine):
    with Session(engine) as session:
        label = _new_label(session, "checks")
        reference = _new_reference(session, label)
        session.commit()
        invalid_rows = [
            (LabelReferenceTrack(label_id=label.id, title="  "), "empty title"),
            (
                LabelReferenceTrack(label_id=label.id, title="Valid", status="queued"),
                "reference status",
            ),
            (
                _embedding(label, reference_id=reference.id, provider="  "),
                "empty identity",
            ),
            (
                _embedding(label, reference_id=reference.id, dimension=511),
                "dimension",
            ),
        ]
        for row, _reason in invalid_rows:
            session.add(row)
            with pytest.raises((IntegrityError, StatementError)):
                session.commit()
            session.rollback()


def test_embedding_requires_exactly_one_owner_in_database(engine):
    with Session(engine) as session:
        label = _new_label(session, "owner-check")
        session.commit()
        invalid_rows = [
            _embedding(label),
            _embedding(label, reference_id=str(uuid4()), submission_id=str(uuid4())),
        ]
        for row in invalid_rows:
            session.add(row)
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()


@pytest.mark.parametrize("owner_kind", ["reference", "submission"])
def test_composite_owner_foreign_key_rejects_cross_label_insert(engine, owner_kind):
    with Session(engine) as session:
        owner_label = _new_label(session, "owner")
        other_label = _new_label(session, "other")
        if owner_kind == "reference":
            reference = _new_reference(session, owner_label)
            row = _embedding(other_label, reference_id=reference.id)
        else:
            submission = _new_submission(session, owner_label)
            row = _embedding(other_label, submission_id=submission.id)
        session.commit()
        session.add(row)
        with pytest.raises(IntegrityError):
            session.commit()


@pytest.mark.parametrize("owner_kind", ["reference", "submission"])
def test_composite_owner_foreign_key_rejects_cross_label_update(engine, owner_kind):
    with Session(engine) as session:
        owner_label = _new_label(session, "update-owner")
        other_label = _new_label(session, "update-other")
        if owner_kind == "reference":
            owner = _new_reference(session, owner_label)
            row = _embedding(owner_label, reference_id=owner.id)
        else:
            owner = _new_submission(session, owner_label)
            row = _embedding(owner_label, submission_id=owner.id)
        session.add(row)
        session.commit()

        row.label_id = other_label.id
        with pytest.raises(IntegrityError):
            session.commit()


@pytest.mark.parametrize("owner_kind", ["reference", "submission"])
def test_hard_owner_delete_cascades_embeddings_without_soft_delete(engine, owner_kind):
    with Session(engine) as session:
        label = _new_label(session, "cascade")
        if owner_kind == "reference":
            owner = _new_reference(session, label)
            row = _embedding(label, reference_id=owner.id)
        else:
            owner = _new_submission(session, label)
            row = _embedding(label, submission_id=owner.id)
        session.add(row)
        session.commit()
        owner_id = owner.id
        embedding_id = row.id

        if owner_kind == "reference":
            session.exec(delete(LabelReferenceTrack).where(LabelReferenceTrack.id == owner_id))
        else:
            session.exec(delete(Submission).where(Submission.id == owner_id))
        session.commit()
        assert session.get(MusicEmbedding, embedding_id) is None
        owner_type = LabelReferenceTrack if owner_kind == "reference" else Submission
        assert session.get(owner_type, owner_id) is None


@pytest.mark.parametrize(
    "bad_vector",
    [
        [1.0] * 511,
        [float("nan"), *([0.0] * 511)],
        [float("inf"), *([0.0] * 511)],
        [0.0] * 512,
        [True, *([0.0] * 511)],
        [1 + 2j, *([0.0] * 511)],
    ],
    ids=["wrong-dimension", "nan", "infinity", "zero", "boolean", "complex"],
)
def test_vector_bind_rejects_invalid_values(engine, bad_vector):
    with Session(engine) as session:
        label = _new_label(session, "bad-vector")
        reference = _new_reference(session, label)
        session.commit()
        session.add(_embedding(label, reference_id=reference.id, embedding=bad_vector))
        with pytest.raises(StatementError):
            session.commit()


def test_segment_bounds_aggregate_shape_and_status_are_checked_by_database(engine):
    with Session(engine) as session:
        label = _new_label(session, "segments")
        reference = _new_reference(session, label)
        session.commit()
        bad_rows = [
            _embedding(label, reference_id=reference.id, segment_index=-2),
            _embedding(
                label,
                reference_id=reference.id,
                segment_index=0,
                start_seconds=None,
                end_seconds=2.0,
            ),
            _embedding(
                label,
                reference_id=reference.id,
                segment_index=0,
                start_seconds=2.0,
                end_seconds=2.0,
            ),
            _embedding(
                label,
                reference_id=reference.id,
                segment_index=0,
                start_seconds=-1.0,
                end_seconds=2.0,
            ),
            _embedding(
                label,
                reference_id=reference.id,
                segment_index=-1,
                start_seconds=0.0,
                end_seconds=2.0,
            ),
            LabelReferenceTrack(label_id=label.id, title="Reference", status="ready-ish"),
        ]
        for row in bad_rows:
            session.add(row)
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()

        valid_segment = _embedding(
            label,
            reference_id=reference.id,
            segment_index=0,
            start_seconds=0.0,
            end_seconds=2.0,
        )
        session.add(valid_segment)
        session.commit()


def test_same_owner_segment_identity_is_unique_but_versions_can_coexist(engine):
    with Session(engine) as session:
        label = _new_label(session, "versions")
        reference = _new_reference(session, label)
        original = _embedding(label, reference_id=reference.id)
        session.add(original)
        session.commit()

        session.add(_embedding(label, reference_id=reference.id))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        next_model_version = _embedding(label, reference_id=reference.id, version="v2")
        next_pipeline = _embedding(label, reference_id=reference.id, pipeline_version="prep-v2")
        segment = _embedding(
            label,
            reference_id=reference.id,
            segment_index=0,
            start_seconds=1.0,
            end_seconds=2.0,
        )
        session.add_all([next_model_version, next_pipeline, segment])
        session.commit()
        assert session.scalar(select(func.count()).select_from(MusicEmbedding)) == 4


def test_postgresql_vector_type_fails_closed_when_adapter_is_unavailable(monkeypatch):
    original_import = builtins.__import__

    def reject_pgvector(name, *args, **kwargs):
        if name == "pgvector" or name.startswith("pgvector."):
            raise ModuleNotFoundError("simulated missing pgvector")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", reject_pgvector)
    with pytest.raises(RuntimeError, match="pgvector.*PostgreSQL"):
        Vector512().load_dialect_impl(postgresql.dialect())


def test_migration_source_declares_tenant_rls_and_vector_extension_structurally():
    """Structural source check only; it does not prove PostgreSQL/RLS behavior."""
    migration = Path(__file__).parents[1] / "migrations" / "009_label_dna_storage.sql"
    sql = migration.read_text(encoding="utf-8").lower()

    assert "create extension" in sql and "vector" in sql
    assert "vector(512)" in sql
    assert "enable row level security" in sql
    assert "auth.uid()::text" in sql
    assert "revoke all" in sql and "from public, anon, authenticated" in sql
    assert "on delete cascade" in sql
    assert "foreign key (reference_track_id, label_id)" in sql
    assert "foreign key (submission_id, label_id)" in sql


def test_migration_one_shot_refusal_and_transaction_wrapper_are_structural():
    """Structural assertions do not prove PostgreSQL rollback behavior."""
    migration = Path(__file__).parents[1] / "migrations" / "009_label_dna_storage.sql"
    sql = migration.read_text(encoding="utf-8").lower()
    statements = [
        line.strip().lower()
        for line in sql.splitlines()
        if line.strip() and not line.lstrip().startswith("--")
    ]

    assert statements[0] == "begin;"
    assert statements[-1] == "commit;"
    preflight_end = sql.index("$private_tables_preflight$;")
    assert "to_regclass('public.label_reference_tracks')" in sql
    assert "to_regclass('public.music_embeddings')" in sql
    assert "inspect migration history" in sql
    assert preflight_end < sql.index("create extension")
    assert "create table if not exists" not in sql
    assert "create unique index if not exists uq_music_embeddings" not in sql


def test_migration_fresh_policies_and_acl_scope_are_structural():
    """Source checks only; they are not PostgreSQL ACL or RLS evidence."""
    migration = Path(__file__).parents[1] / "migrations" / "009_label_dna_storage.sql"
    sql = migration.read_text(encoding="utf-8").lower()

    assert sql.count("create policy ") == 2
    assert "create policy label_reference_tracks_owner_access" in sql
    assert "create policy music_embeddings_owner_access" in sql
    assert "pg_policy" not in sql
    assert "existing_qual" not in sql
    assert "pg_get_constraintdef" not in sql
    assert "ilike" not in sql
    assert "index_row.indisunique" in sql
    assert "index_row.indpred is null" in sql
    assert "index_row.indkey[0] = id_attnum" in sql
    assert "index_row.indkey[1] = label_id_attnum" in sql
    assert "aclexplode" in sql
    assert "unexpected default privilege" in sql
    assert "from public, anon, authenticated" in sql
    assert "grant select, insert, update, delete" in sql
