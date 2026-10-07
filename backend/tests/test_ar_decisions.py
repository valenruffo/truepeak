"""SQLite behavior tests for the human A&R decision service.

Covers record/list semantics of app.ar_matching.ar_decisions: validation
before session use, append-only history, per-latest exact-duplicate
suppression (note excluded), caller-derived latest-wins, event-only
interaction with submissions, caller-owned transactions, and live foreign
keys. SQLite only; PostgreSQL RLS/grants are asserted elsewhere.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from time import sleep
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.ar_matching.ar_decisions import (
    list_label_ar_decisions,
    record_label_ar_decision,
)
from app.ar_matching.storage_models import LabelArDecisionRow
from app.models import Label, Submission


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


def _row(label: Label, submission: Submission, **overrides) -> LabelArDecisionRow:
    values = {
        "id": str(uuid4()),
        "label_id": label.id,
        "submission_id": submission.id,
        "decision": "shortlist",
        "decided_by": "reviewer-1",
        "decided_at": datetime.now(UTC),
        "note": None,
    }
    return LabelArDecisionRow(**{**values, **overrides})


def _decision_count(session: Session) -> int:
    return len(session.exec(select(LabelArDecisionRow)).all())


def _record(session: Session, label: Label, submission: Submission, **overrides):
    kwargs = {
        "label_id": label.id,
        "submission_id": submission.id,
        "decision": "shortlist",
        "decided_by": "reviewer-1",
        "note": None,
    }
    return record_label_ar_decision(session, **{**kwargs, **overrides})


def test_record_valid_decision_creates_row_with_exact_fields(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "valid")
        session.commit()

        outcome = _record(session, label, submission, note="Strong hook, weak low end")

        assert outcome.created is True
        record = outcome.record
        assert UUID(record.decision_id).version == 4
        assert record.label_id == label.id
        assert record.submission_id == submission.id
        assert record.decision == "shortlist"
        assert record.decided_by == "reviewer-1"
        assert record.note == "Strong hook, weak low end"
        assert record.decided_at.tzinfo is not None
        assert record.decided_at <= datetime.now(UTC)

        session.expire_all()
        stored = session.exec(select(LabelArDecisionRow)).one()
        assert stored.id == record.decision_id
        assert stored.decision == "shortlist"
        assert stored.decided_by == "reviewer-1"
        assert stored.note == "Strong hook, weak low end"
        # SQLite's DATETIME dialect drops the offset on round-trip; compare
        # instants with UTC re-attached (PostgreSQL timestamptz would keep it).
        assert stored.decided_at.replace(tzinfo=UTC) == record.decided_at
        assert stored.created_at.replace(tzinfo=UTC) <= datetime.now(UTC)


def test_record_without_note_round_trips_none(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "nonote")
        session.commit()

        outcome = _record(session, label, submission)

        assert outcome.created is True
        assert outcome.record.note is None
        session.expire_all()
        assert session.exec(select(LabelArDecisionRow)).one().note is None


def test_exact_duplicate_reaffirmation_is_suppressed(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "dup")
        session.commit()

        first = _record(session, label, submission, note="first note")
        second = _record(session, label, submission, note="different note")

        assert second.created is False
        assert second.record.decision_id == first.record.decision_id
        # SQLite round-trips decided_at naive; the instant is identical.
        assert second.record.decided_at.replace(tzinfo=UTC) == first.record.decided_at
        assert _decision_count(session) == 1  # note content does not defeat suppression


def test_suppression_is_per_decision_and_decided_by(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "combo")
        session.commit()

        base = _record(session, label, submission)
        same_decision_other_actor = _record(session, label, submission, decided_by="reviewer-2")
        other_decision_same_actor = _record(session, label, submission, decision="rejected")

        assert same_decision_other_actor.created is True
        assert other_decision_same_actor.created is True
        assert _decision_count(session) == 3
        assert (
            len(
                {
                    base.record.decision_id,
                    same_decision_other_actor.record.decision_id,
                    other_decision_same_actor.record.decision_id,
                }
            )
            == 3
        )


def test_latest_wins_is_derived_as_last_history_element(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "latest")
        session.commit()

        _record(session, label, submission, decision="rejected", decided_by="reviewer-1")
        sleep(0.01)
        _record(session, label, submission, decision="shortlist", decided_by="reviewer-2")
        sleep(0.01)
        last = _record(session, label, submission, decision="rejected", decided_by="reviewer-3")

        history = list_label_ar_decisions(session, label_id=label.id, submission_id=submission.id)
        assert len(history) == 3
        assert [entry.decision for entry in history] == ["rejected", "shortlist", "rejected"]
        latest = history[-1]
        assert latest.decision_id == last.record.decision_id
        assert latest.decision == "rejected"
        assert latest.decided_by == "reviewer-3"


def test_history_order_is_deterministic_by_decided_at_then_id(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "order")
        session.commit()

        tie = datetime.now(UTC) - timedelta(hours=1)
        earlier = _row(
            label,
            submission,
            id="ffffffff-0000-0000-0000-000000000000",
            decided_at=tie,
            decision="rejected",
            decided_by="late-id",
        )
        later = _row(
            label,
            submission,
            id="aaaaaaaa-0000-0000-0000-000000000000",
            decided_at=tie + timedelta(hours=1),
            decision="shortlist",
            decided_by="later-time",
        )
        session.add_all([earlier, later])
        session.commit()

        history = list_label_ar_decisions(session, label_id=label.id, submission_id=submission.id)
        # Ascending (decided_at, id): the tie row sorts before tie + 1 hour.
        assert [entry.decided_by for entry in history] == ["late-id", "later-time"]

        # Same decided_at: id ascending breaks the tie deterministically.
        tie_rows = [
            _row(label, submission, id="dddddddd-0000-0000-0000-000000000000", decided_at=tie),
            _row(label, submission, id="bbbbbbbb-0000-0000-0000-000000000000", decided_at=tie),
        ]
        session.add_all(tie_rows)
        session.commit()
        history = list_label_ar_decisions(session, label_id=label.id, submission_id=submission.id)
        assert [entry.decision_id[:8] for entry in history] == [
            "bbbbbbbb",
            "dddddddd",
            "ffffffff",
            "aaaaaaaa",
        ]


def test_list_returns_empty_tuple_without_history(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "empty")
        session.commit()

        history = list_label_ar_decisions(session, label_id=label.id, submission_id=submission.id)
        assert history == ()


BAD_CANONICAL_IDS = [str(uuid4()).upper(), uuid4().hex, None]
BAD_DECISIONS = ["inbox", "auto_rejected", "interested", "Shortlist", "", None]
BAD_DECIDERS = ["", "   ", None, 123]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        *(("label_id", value) for value in BAD_CANONICAL_IDS),
        *(("submission_id", value) for value in BAD_CANONICAL_IDS),
        *(("decision", value) for value in BAD_DECISIONS),
        *(("decided_by", value) for value in BAD_DECIDERS),
        ("note", 123),
    ],
)
def test_validation_rejects_bad_input_and_writes_nothing(engine, field, value):
    with Session(engine) as session:
        label, submission = _seed(session, "neg")
        session.commit()

        with pytest.raises(ValueError):
            _record(session, label, submission, **{field: value})
        assert _decision_count(session) == 0


def test_event_only_service_never_touches_submission_columns(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "event-only")
        session.commit()

        def snapshot() -> dict[str, object]:
            session.expire_all()
            stored = session.get(Submission, submission.id)
            names = [column.name for column in Submission.__table__.columns]
            return {name: getattr(stored, name) for name in names}

        before = snapshot()
        assert before["status"] == "inbox"  # unseeded default

        _record(session, label, submission, decision="rejected", decided_by="reviewer-1")
        sleep(0.01)
        _record(session, label, submission, decision="shortlist", decided_by="reviewer-2")

        assert snapshot() == before  # status stays 'inbox'; no Submission column changes


def test_caller_owned_rollback_discards_then_re_records(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "rollback")
        session.commit()

        session.begin()  # caller-owned outer transaction
        outcome = _record(session, label, submission, decision="rejected")
        assert outcome.created is True
        session.rollback()  # the caller's rollback wins; the service never commits

        assert _decision_count(session) == 0

        re_recorded = _record(session, label, submission, decision="rejected")
        assert re_recorded.created is True
        assert _decision_count(session) == 1


def test_live_foreign_keys_reject_unknown_pairs_on_flush(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "fk")
        other_label = Label(
            id=str(uuid4()),
            name="Other label",
            slug=f"other-{uuid4()}",
            owner_email=f"{uuid4()}@example.test",
        )
        session.add(other_label)
        session.commit()

        with pytest.raises(IntegrityError):
            _record(session, label, submission, submission_id=str(uuid4()))
        session.rollback()

        with pytest.raises(IntegrityError):
            _record(session, label, submission, label_id=str(uuid4()))
        session.rollback()

        with pytest.raises(IntegrityError):
            _record(session, other_label, submission)  # (submission, label) pair mismatch
        session.rollback()
        assert _decision_count(session) == 0


def test_duplicate_suppression_compares_only_the_latest_row(engine):
    with Session(engine) as session:
        label, submission = _seed(session, "per-latest")
        session.commit()

        _record(session, label, submission, decision="rejected", decided_by="reviewer-a")
        sleep(0.01)
        shortlist = _record(
            session, label, submission, decision="shortlist", decided_by="reviewer-b"
        )

        reaffirmed = _record(
            session, label, submission, decision="shortlist", decided_by="reviewer-b"
        )
        assert reaffirmed.created is False
        assert reaffirmed.record.decision_id == shortlist.record.decision_id
        assert _decision_count(session) == 2

        # The older (rejected, reviewer-a) combination is not the latest row,
        # so re-recording it appends new history instead of suppressing.
        revived = _record(session, label, submission, decision="rejected", decided_by="reviewer-a")
        assert revived.created is True
        assert _decision_count(session) == 3
