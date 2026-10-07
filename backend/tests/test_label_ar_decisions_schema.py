"""SQLite/source-contract tests for the label A&R decision schema.

Portable row checks and migration source structure only; not PostgreSQL run
evidence. RLS policies, convalidated constraint probes, and transactional
rollback are PostgreSQL semantics asserted structurally against the migration
source; no SQL is executed against PostgreSQL by this module.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import Column, DateTime, Integer, MetaData, Table, delete, event, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.ar_matching.storage_models import LabelArDecisionRow
from app.database_schema import create_legacy_tables
from app.models import Label, Submission

MIGRATION = Path(__file__).parents[1] / "migrations" / "013_label_ar_decisions.sql"


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
            LabelArDecisionRow.__table__,
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


def _decision_row(label: Label, submission: Submission, **overrides) -> LabelArDecisionRow:
    values = {
        "label_id": label.id,
        "submission_id": submission.id,
        "decision": "shortlist",
        "decided_by": "reviewer-1",
        "decided_at": datetime.now(UTC),
    }
    return LabelArDecisionRow(**{**values, **overrides})


def test_model_contract_and_legacy_creation_exclusion():
    """Column/type/constraint contract plus legacy-table creation exclusion."""
    assert LabelArDecisionRow.__table__.info.get("migration_managed") is True
    columns = LabelArDecisionRow.__table__.columns
    assert "|".join(columns.keys()) == (
        "id|label_id|submission_id|decision|decided_by|decided_at|note|created_at"
    )
    for name, column in columns.items():
        assert column.nullable == (name == "note")
    assert isinstance(columns["decided_at"].type, DateTime)
    assert isinstance(columns["created_at"].type, DateTime)
    # Append-only history: rows are immutable after insert, so there is no
    # mutable-timestamp column and no unique suppression constraint; the
    # current decision derives on read from the latest decided_at.
    assert "updated_at" not in columns
    assert "|".join(
        sorted(
            constraint.name
            for constraint in LabelArDecisionRow.__table__.constraints
            if constraint.name
        )
    ) == (
        "ck_label_ar_decisions_decided_by_nonempty|ck_label_ar_decisions_decision_allowed"
        "|fk_label_ar_decisions_label|fk_label_ar_decisions_submission_label"
    )
    decision_check = next(
        constraint
        for constraint in LabelArDecisionRow.__table__.constraints
        if constraint.name == "ck_label_ar_decisions_decision_allowed"
    )
    assert "decision in ('shortlist', 'rejected')" in str(decision_check.sqltext).lower()

    # Legacy creation excludes migration-managed tables (flag above).
    metadata = MetaData()
    Table("legacy_record", metadata, Column("id", Integer, primary_key=True))
    legacy_engine = create_engine("sqlite://")
    create_legacy_tables(legacy_engine, metadata)
    assert inspect(legacy_engine).get_table_names() == ["legacy_record"]
    legacy_engine.dispose()


def test_decision_vocabulary_and_actor_are_checked_by_sqlite_inserts(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "checks")
        session.commit()
        bad_rows = [
            _decision_row(label, submission, decision="inbox"),
            _decision_row(label, submission, decision="auto_rejected"),
            _decision_row(label, submission, decision="interested"),
            _decision_row(label, submission, decided_by="  "),
            _decision_row(label, submission, decided_by=""),
        ]
        for row in bad_rows:
            session.add(row)
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()


def test_composite_and_label_fks_are_enforced_with_pragma(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "fks")
        other_label = Label(
            id=str(uuid4()),
            name="Other label",
            slug=f"other-{uuid4()}",
            owner_email=f"{uuid4()}@example.test",
        )
        session.add(other_label)
        session.commit()

        session.add(_decision_row(label, submission))
        session.commit()  # the valid composite key commits

        session.add(_decision_row(label, submission, submission_id=str(uuid4())))
        with pytest.raises(IntegrityError):
            session.commit()  # unknown submission fails the composite FK
        session.rollback()
        session.add(_decision_row(label, submission, label_id=str(uuid4())))
        with pytest.raises(IntegrityError):
            session.commit()  # unknown label fails the label FK
        session.rollback()
        session.add(_decision_row(other_label, submission))
        with pytest.raises(IntegrityError):
            session.commit()  # (submission, label) pair mismatch fails the composite FK
        session.rollback()


def test_append_only_history_keeps_distinct_rows_and_cascades(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "history")
        first = _decision_row(label, submission, decided_by="reviewer-1")
        second = _decision_row(label, submission, decided_by="reviewer-2", decision="rejected")
        session.add_all([first, second])
        session.commit()  # exact-duplicate suppression is a service-layer concern
        rows = session.exec(
            select(LabelArDecisionRow).where(LabelArDecisionRow.submission_id == submission.id)
        ).all()
        assert len(rows) == 2

        # A label cannot be deleted while submissions still reference it, so
        # the direct label->decision cascade is only reachable after the
        # submission chain is gone; the composite-FK cascade is the live path.
        with pytest.raises(IntegrityError):
            session.exec(delete(Label).where(Label.id == label.id))
        session.rollback()

        session.exec(delete(Submission).where(Submission.id == submission.id))
        session.commit()  # composite-FK ON DELETE CASCADE removes the decision rows
        assert (
            session.exec(
                select(LabelArDecisionRow).where(LabelArDecisionRow.label_id == label.id)
            ).all()
            == []
        )
        assert session.exec(select(LabelArDecisionRow)).all() == []


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
    assert "if not exists" not in sql
    assert "after migration 012" in sql
    assert (
        "public.label_ar_decisions already exists; inspect migration history before retrying" in sql
    )
    assert "to_regclass('public.label')" in sql and "to_regclass('public.submission')" in sql
    assert "to_regprocedure('auth.uid()')" in sql
    assert "rolname = 'anon'" in sql and "rolname = 'authenticated'" in sql
    assert "to_regclass('public.label_catalog_fit_scores')" in sql
    assert "ck_label_catalog_fit_scores_aggregate_xor" in sql and "convalidated" in sql
    assert "inspect migration history before retrying" in sql
    preflight_end = sql.index("$label_ar_decisions_preflight$")
    assert preflight_end < sql.index("create table public.label_ar_decisions")
    assert "decision in ('shortlist', 'rejected')" in sql
    assert "ck_label_ar_decisions_decision_allowed" in sql
    assert "ck_label_ar_decisions_decided_by_nonempty" in sql
    assert "length(trim(decided_by)) > 0" in sql
    assert "foreign key (submission_id, label_id)" in sql
    assert "references public.submission (id, label_id)" in sql
    assert "foreign key (label_id) references public.label (id) on delete cascade" in sql
    assert sql.count("on delete cascade") == 2
    assert "ix_label_ar_decisions_label_submission" in sql
    assert "(label_id, submission_id, decided_at)" in sql
    assert "enable row level security" in sql
    assert "create policy label_ar_decisions_owner_insert" in sql
    assert "create policy label_ar_decisions_owner_select" in sql
    assert "for insert to authenticated" in sql
    assert "for select to authenticated" in sql
    assert "for all to authenticated" not in sql
    assert sql.count("create policy ") == 2
    assert sql.count("label_id = auth.uid()::text") == 2
    assert "$default_acl_preflight$" in sql and "unexpected default privilege" in sql
    assert "revoke all" in sql and "from public, anon, authenticated" in sql
    # Append-only at the database boundary: no UPDATE/DELETE grant or policy
    # on any executable (non-comment) statement line.
    executable = "\n".join(code)
    assert "grant select, insert" in executable
    assert "update" not in executable.replace("grant select, insert", "")
    assert "delete" not in executable.replace("on delete cascade", "")
    # Append-only: no mutable-timestamp column anywhere in the migration.
    assert "updated_at" not in sql
    # Plain table: no extension bootstrap DO block.
    assert "create extension" not in sql
