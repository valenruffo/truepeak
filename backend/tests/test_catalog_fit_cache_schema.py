"""SQLite/source-contract tests for the catalog fit scores cache schema.

Portable row checks and migration source structure only; not PostgreSQL run
evidence. SQLite cannot reject NaN via CHECK (score = score) like PostgreSQL;
the static SQL assertions carry the PostgreSQL NaN/finite semantics.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import Column, Integer, MetaData, Table, event, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.ar_matching.storage_models import LabelCatalogFitScoreRow, LabelReferenceTrack
from app.database_schema import create_legacy_tables
from app.models import Label, Submission

MIGRATION = Path(__file__).parents[1] / "migrations" / "012_label_catalog_fit_scores.sql"


@pytest.fixture
def engine():
    test_engine = create_engine("sqlite://", poolclass=StaticPool)

    @event.listens_for(test_engine, "connect")
    def _enable_foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(
        test_engine,
        tables=[
            Label.__table__,
            Submission.__table__,
            LabelReferenceTrack.__table__,
            LabelCatalogFitScoreRow.__table__,
        ],
    )
    yield test_engine
    test_engine.dispose()


def _seed(session: Session, suffix: str) -> tuple[Label, Submission]:
    token = str(uuid4())
    label = Label(
        id=token,
        name=f"Label {suffix}",
        slug=f"label-{suffix}-{token}",
        owner_email=f"{token}@example.test",
    )
    submission = Submission(
        id=str(uuid4()),
        label_id=label.id,
        producer_name="Producer",
        producer_email="producer@example.test",
        track_name="Demo track",
    )
    session.add_all([label, submission])
    session.flush()
    return label, submission


def _cache_row(label: Label, submission: Submission, **overrides) -> LabelCatalogFitScoreRow:
    values = {
        "label_id": label.id,
        "query_submission_id": submission.id,
        "provider": "test-provider",
        "model": "test-model",
        "version": "v1",
        "dimension": 512,
        "pipeline_version": "pipeline-v1",
        "k": 10,
        "score": 0.5,
        "eligible_count": 3,
        "eligible_fingerprint": "fingerprint",
    }
    return LabelCatalogFitScoreRow(**{**values, **overrides})


def test_model_contract_and_legacy_creation_exclusion():
    assert LabelCatalogFitScoreRow.__table__.info.get("migration_managed") is True
    columns = LabelCatalogFitScoreRow.__table__.columns
    assert "|".join(columns.keys()) == (
        "id|label_id|query_submission_id|reference_track_id|provider|model|version"
        "|dimension|pipeline_version|k|score|eligible_count|eligible_fingerprint"
        "|created_at|updated_at"
    )
    for name, column in columns.items():
        assert column.nullable == (name == "reference_track_id")
    assert columns["score"].type.python_type is float
    assert columns["dimension"].type.python_type is columns["k"].type.python_type is int
    assert columns["created_at"].type.python_type is datetime
    declared = "|".join(
        sorted(
            constraint.name
            for constraint in LabelCatalogFitScoreRow.__table__.constraints
            if constraint.name
        )
    )
    assert "ck_label_catalog_fit_scores_aggregate_xor" in declared
    assert "ck_label_catalog_fit_scores_identity_nonempty" in declared
    assert "ck_label_catalog_fit_scores_fingerprint_nonempty" in declared
    assert "ck_label_catalog_fit_scores_dimension" in declared
    assert "ck_label_catalog_fit_scores_k_positive" in declared
    assert "ck_label_catalog_fit_scores_eligible_count" in declared
    assert "ck_label_catalog_fit_scores_score_finite" in declared
    score_check = next(
        constraint
        for constraint in LabelCatalogFitScoreRow.__table__.constraints
        if constraint.name == "ck_label_catalog_fit_scores_score_finite"
    )
    # SQLite cannot reject NaN; the migration-source test carries PG semantics.
    assert "score = score" in str(score_check.sqltext).lower()

    # Legacy creation excludes migration-managed tables (flag above).
    metadata = MetaData()
    Table("legacy_record", metadata, Column("id", Integer, primary_key=True))
    legacy_engine = create_engine("sqlite://")
    create_legacy_tables(legacy_engine, metadata)
    assert inspect(legacy_engine).get_table_names() == ["legacy_record"]
    legacy_engine.dispose()


def test_identity_fingerprint_and_bounds_are_checked_by_sqlite_inserts(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "checks")
        session.commit()
        bad_rows = [
            _cache_row(label, submission, provider="  "),
            _cache_row(label, submission, model=""),
            _cache_row(label, submission, eligible_fingerprint=" "),
            _cache_row(label, submission, k=0),
            _cache_row(label, submission, dimension=384),
            _cache_row(label, submission, eligible_count=-1),
        ]
        for row in bad_rows:
            session.add(row)
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()


def test_row_shapes_partial_uniques_and_composite_fks_are_enforced(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "shapes")
        session.add(_cache_row(label, submission))
        session.commit()
        session.add(_cache_row(label, submission))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        session.add(_cache_row(label, submission, k=25))
        session.commit()

        reference = LabelReferenceTrack(id=str(uuid4()), label_id=label.id, title="Reference")
        session.add(reference)
        session.flush()
        session.add(_cache_row(label, submission, reference_track_id=reference.id))
        session.commit()  # a per-reference row coexists with the aggregate row
        session.add(_cache_row(label, submission, reference_track_id=reference.id))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        session.add(_cache_row(label, submission, reference_track_id=reference.id, version="v2"))
        session.commit()

        session.add(_cache_row(label, submission, reference_track_id=str(uuid4())))
        with pytest.raises(IntegrityError):
            session.commit()  # unknown reference_track_id fails the composite FK
        session.rollback()
        session.add(_cache_row(label, submission, query_submission_id=str(uuid4())))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        session.add(_cache_row(label, submission, label_id=str(uuid4())))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        session.add(_cache_row(label, submission, reference_track_id=reference.id, k=50))
        session.commit()  # the valid composite keys commit


def test_migration_source_declares_locked_structure():
    """Structural source check only; it does not prove PostgreSQL behavior."""
    sql = MIGRATION.read_text(encoding="utf-8").lower()
    code = [
        stripped
        for line in sql.splitlines()
        if (stripped := line.strip().lower()) and not line.lstrip().startswith("--")
    ]

    assert code[0] == "begin;"
    assert code[-1] == "commit;"
    assert "if not exists" not in sql and "after migration 011" in sql
    assert "already exists; inspect migration history before retrying" in sql
    assert "ck_label_reference_tracks_processing_claim_token_nonempty" in sql
    preflight_end = sql.index("$label_catalog_fit_scores_preflight$")
    assert preflight_end < sql.index("create table public.label_catalog_fit_scores")
    assert (
        "foreign key (reference_track_id, label_id)" in sql
        and "references public.label_reference_tracks (id, label_id)" in sql
        and "foreign key (query_submission_id, label_id)" in sql
        and "references public.submission (id, label_id)" in sql
        and "ck_label_catalog_fit_scores_aggregate_xor" in sql
    )
    assert "score = score" in sql and "1.7976931348623157e308" in sql
    assert "enable row level security" in sql and "label_id = auth.uid()::text" in sql
    assert (
        "revoke all" in sql
        and "from public, anon, authenticated" in sql
        and "grant select, insert, update, delete" in sql
    )
    assert (
        "where reference_track_id is not null" in sql and "where reference_track_id is null" in sql
    )
