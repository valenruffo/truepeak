from __future__ import annotations

from contextlib import contextmanager
from dataclasses import FrozenInstanceError, replace
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.ar_matching.reference_stage_observations import (
    ReferenceStageObservationConflictError,
    ReferenceStageObservationNotFoundError,
    ReferenceStageObservationSessionError,
    ReferenceStageObservationValidationError,
    observe_reference_staging,
)
from app.ar_matching.reference_validation import validate_reference_upload
from app.ar_matching.storage_models import LabelReferenceTrack
from app.models import Label
from app.services.reference_r2 import ReferenceR2ResponseError, StagingObjectVerification

_OWNER = "11111111-1111-4111-8111-111111111111"
_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_REFERENCE = "22222222-2222-4222-8222-222222222222"
_MISSING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
_TOKEN = "33333333-3333-4333-8333-333333333333"
_LIMIT = 1024
_OLD_UPDATED_AT = datetime(2000, 1, 1, tzinfo=UTC)


@pytest.fixture
def engine():
    test_engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(test_engine, "connect")
    def _foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    tables = [Label.__table__, LabelReferenceTrack.__table__]
    SQLModel.metadata.create_all(test_engine, tables=tables)
    with Session(test_engine) as session:
        session.add_all(
            [
                Label(
                    id=identity,
                    name=name,
                    slug=f"{name.lower()}-{uuid4()}",
                    owner_email=f"{uuid4()}@example.test",
                )
                for identity, name in ((_OWNER, "Owner"), (_OTHER, "Other"))
            ]
        )
        session.commit()
        session.add(_reference(updated_at=_OLD_UPDATED_AT))
        session.commit()
    try:
        yield test_engine
    finally:
        SQLModel.metadata.drop_all(test_engine, tables=list(reversed(tables)))
        test_engine.dispose()


def _reference(**changes):
    extension = validate_reference_upload("reference.wav", 128, _LIMIT).canonical_extension
    return LabelReferenceTrack(
        id=_REFERENCE,
        label_id=_OWNER,
        title="Reference",
        status="uploaded",
        is_active=True,
        upload_idempotency_key=_TOKEN,
        upload_filename="reference.wav",
        upload_size_bytes=128,
        upload_limit_bytes=_LIMIT,
        staging_key=f"label-references/{_OWNER}/{_REFERENCE}/staging/original{extension}",
        **changes,
    )


class FakeAdapter:
    def __init__(self, etag='"stage-1"', callback=None, changes=None):
        self.etag = etag
        self.callback = callback
        self.changes = changes or {}
        self.calls = []

    def verify_uploaded_reference(self, owner, reference, upload):
        self.calls.append((owner, reference, upload))
        if self.callback is not None:
            self.callback()
        key = f"label-references/{owner}/{reference}/staging/original{upload.canonical_extension}"
        result = StagingObjectVerification(key, upload.size_bytes, upload.canonical_mime, self.etag)
        return replace(result, **self.changes)


@contextmanager
def _tracked_sessions(engine, events):
    session = Session(engine)
    events.append("open")
    try:
        yield session
    finally:
        session.close()
        events.append("close")


def _mutate(engine, changes, *, delete=False):
    with Session(engine) as session:
        session.execute(text("PRAGMA ignore_check_constraints = ON"))
        if delete:
            session.execute(
                text("DELETE FROM label_reference_tracks WHERE id = :id"),
                {"id": _REFERENCE},
            )
        else:
            assignments = ", ".join(f"{field} = :{field}" for field in changes)
            session.execute(
                text(f"UPDATE label_reference_tracks SET {assignments} WHERE id = :id"),
                {**changes, "id": _REFERENCE},
            )
        session.commit()


def test_first_observation_pins_provider_etag_without_changing_uploaded_identity(engine):
    adapter = FakeAdapter()
    result = observe_reference_staging(
        _OWNER,
        _REFERENCE,
        session_factory=lambda: Session(engine),
        adapter_factory=lambda: adapter,
    )

    assert result.reference_id == _REFERENCE
    assert result.label_id == _OWNER
    assert result.status == "uploaded"
    assert result.observed_etag == '"stage-1"'
    assert result.reused is False
    assert len(adapter.calls) == 1
    with pytest.raises(FrozenInstanceError):
        result.reused = True
    assert not hasattr(result, "url") and not hasattr(result, "embeddings")
    with Session(engine) as session:
        row = session.get(LabelReferenceTrack, _REFERENCE)
        assert row.staging_etag == '"stage-1"'
        assert row.status == "uploaded" and row.is_active is True
        assert row.storage_key is None and row.final_etag is None
        assert row.upload_idempotency_key == _TOKEN
        assert row.upload_filename == "reference.wav"
        assert row.upload_size_bytes == 128 and row.upload_limit_bytes == _LIMIT
        assert row.staging_key.endswith("/staging/original.wav")
        assert row.updated_at.replace(tzinfo=UTC) > _OLD_UPDATED_AT


def test_same_etag_is_reverified_then_reused_without_database_update(engine):
    statements = []
    event.listen(
        engine,
        "before_cursor_execute",
        lambda _conn, _cursor, statement, *_args: statements.append(statement),
    )
    adapter = FakeAdapter()
    first = observe_reference_staging(
        _OWNER, _REFERENCE, session_factory=lambda: Session(engine), adapter_factory=lambda: adapter
    )
    with Session(engine) as session:
        first_timestamp = session.get(LabelReferenceTrack, _REFERENCE).updated_at
    statements.clear()
    second = observe_reference_staging(
        _OWNER, _REFERENCE, session_factory=lambda: Session(engine), adapter_factory=lambda: adapter
    )

    assert first.reused is False and second.reused is True
    assert second.observed_etag == first.observed_etag
    assert len(adapter.calls) == 2
    assert not any(statement.lstrip().upper().startswith("UPDATE") for statement in statements)
    with Session(engine) as session:
        assert session.get(LabelReferenceTrack, _REFERENCE).updated_at == first_timestamp


def test_changed_etag_conflicts_without_second_session_or_overwrite(engine):
    events = []
    observe_reference_staging(
        _OWNER,
        _REFERENCE,
        session_factory=lambda: _tracked_sessions(engine, events),
        adapter_factory=FakeAdapter,
    )
    events.clear()
    adapter = FakeAdapter(etag='"stage-2"')
    with pytest.raises(ReferenceStageObservationConflictError):
        observe_reference_staging(
            _OWNER,
            _REFERENCE,
            session_factory=lambda: _tracked_sessions(engine, events),
            adapter_factory=lambda: adapter,
        )

    assert events == ["open", "close"]
    assert len(adapter.calls) == 1
    with Session(engine) as session:
        assert session.get(LabelReferenceTrack, _REFERENCE).staging_etag == '"stage-1"'


@pytest.mark.parametrize(
    ("case", "expected"),
    [
        ("missing", ReferenceStageObservationNotFoundError),
        ("cross-owner", ReferenceStageObservationNotFoundError),
        ("inactive", ReferenceStageObservationNotFoundError),
        ("status", ReferenceStageObservationConflictError),
        ("final", ReferenceStageObservationConflictError),
        ("legacy", ReferenceStageObservationConflictError),
        ("tuple", ReferenceStageObservationConflictError),
        ("key", ReferenceStageObservationConflictError),
        ("blank-etag", ReferenceStageObservationConflictError),
    ],
)
def test_ineligible_or_corrupt_rows_never_construct_adapter(engine, case, expected):
    owner, reference = _OWNER, _REFERENCE
    if case == "missing":
        reference = _MISSING
    elif case == "cross-owner":
        owner = _OTHER
    else:
        changes = {
            "inactive": {"is_active": 0},
            "status": {"status": "failed"},
            "final": {
                "staging_etag": '"old"',
                "storage_key": f"label-references/{_OWNER}/{_REFERENCE}/original.wav",
                "final_etag": '"final"',
            },
            "legacy": {
                "upload_idempotency_key": None,
                "upload_filename": None,
                "upload_size_bytes": None,
                "upload_limit_bytes": None,
                "staging_key": None,
            },
            "tuple": {"upload_idempotency_key": "not-a-canonical-uuid"},
            "key": {"staging_key": "wrong/staging/key"},
            "blank-etag": {"staging_etag": "  "},
        }[case]
        _mutate(engine, changes)

    with pytest.raises(expected):
        observe_reference_staging(
            owner,
            reference,
            session_factory=lambda: Session(engine),
            adapter_factory=lambda: pytest.fail("adapter must not be constructed"),
        )


def test_first_session_closes_before_provider_and_second_opens_only_after_positive_result(engine):
    events = []
    adapter = FakeAdapter(callback=lambda: events == ["open", "close"] or pytest.fail(events))
    result = observe_reference_staging(
        _OWNER,
        _REFERENCE,
        session_factory=lambda: _tracked_sessions(engine, events),
        adapter_factory=lambda: adapter,
    )

    assert result.reused is False
    assert events == ["open", "close", "open", "close"]


def test_provider_failure_propagates_and_does_not_open_second_session(engine):
    events = []

    class FailedAdapter:
        def verify_uploaded_reference(self, *_args):
            raise ReferenceR2ResponseError("bounded verification failed")

    with pytest.raises(ReferenceR2ResponseError):
        observe_reference_staging(
            _OWNER,
            _REFERENCE,
            session_factory=lambda: _tracked_sessions(engine, events),
            adapter_factory=FailedAdapter,
        )

    assert events == ["open", "close"]
    with Session(engine) as session:
        assert session.get(LabelReferenceTrack, _REFERENCE).staging_etag is None


def test_malformed_adapter_identity_and_etag_are_rejected(engine):
    for changes in ({"key": "other/key"}, {"content_length": 129}, {"etag": "  "}):
        with pytest.raises(ReferenceStageObservationValidationError):
            observe_reference_staging(
                _OWNER,
                _REFERENCE,
                session_factory=lambda: Session(engine),
                adapter_factory=lambda changes=changes: FakeAdapter(changes=changes),
            )
    with Session(engine) as session:
        assert session.get(LabelReferenceTrack, _REFERENCE).staging_etag is None


@pytest.mark.parametrize(
    ("case", "changes", "delete"),
    [
        ("owner", {"label_id": _OTHER}, False),
        ("tuple", {"upload_size_bytes": 129}, False),
        ("key", {"staging_key": "raced/key"}, False),
        ("active", {"is_active": 0}, False),
        ("status", {"status": "failed"}, False),
        (
            "final",
            {
                "staging_etag": '"racer"',
                "storage_key": f"label-references/{_OWNER}/{_REFERENCE}/original.wav",
                "final_etag": '"final"',
            },
            False,
        ),
        ("etag", {"staging_etag": '"racer"'}, False),
        ("deleted", {}, True),
    ],
)
def test_conditional_write_rejects_each_interleaved_change(engine, case, changes, delete):
    events = []

    def interleave():
        assert events == ["open", "close"]
        _mutate(engine, changes, delete=delete)

    with pytest.raises(ReferenceStageObservationConflictError):
        observe_reference_staging(
            _OWNER,
            _REFERENCE,
            session_factory=lambda: _tracked_sessions(engine, events),
            adapter_factory=lambda: FakeAdapter(callback=interleave),
        )

    assert events == ["open", "close", "open", "close"]


@pytest.mark.parametrize("state", ["pending", "dirty", "deleted", "transaction"])
def test_unclean_sessions_are_rejected_without_flush_or_provider(engine, state):
    session = Session(engine)
    if state == "pending":
        session.add(
            Label(
                id=_MISSING,
                name="Pending",
                slug=f"pending-{uuid4()}",
                owner_email=f"{uuid4()}@example.test",
            )
        )
    elif state in {"dirty", "deleted"}:
        row = session.get(LabelReferenceTrack, _REFERENCE)
        if state == "dirty":
            row.title = "Caller change"
        else:
            session.delete(row)
    else:
        session.begin()
    flushes = []
    event.listen(session, "before_flush", lambda *_args: flushes.append(True))

    with pytest.raises(ReferenceStageObservationSessionError):
        observe_reference_staging(
            _OWNER,
            _REFERENCE,
            session_factory=lambda: session,
            adapter_factory=lambda: pytest.fail("adapter must not be constructed"),
        )

    assert flushes == []


def test_unrelated_sqlalchemy_errors_propagate_before_provider(engine):
    from sqlalchemy.exc import OperationalError

    error = OperationalError("SELECT", {}, RuntimeError("injected"))

    def fail_select(_conn, _cursor, statement, *_args):
        if statement.lstrip().upper().startswith("SELECT"):
            raise error

    event.listen(engine, "before_cursor_execute", fail_select)
    with pytest.raises(OperationalError) as raised:
        observe_reference_staging(
            _OWNER,
            _REFERENCE,
            session_factory=lambda: Session(engine),
            adapter_factory=lambda: pytest.fail("provider must not run"),
        )
    assert raised.value is error
