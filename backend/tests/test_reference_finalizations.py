"""Pure database/provider-fake tests for private reference finalization."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.ar_matching.reference_finalizations import (
    ReferenceFinalizationConflictError,
    ReferenceFinalizationNotFoundError,
    ReferenceFinalizationSessionError,
    ReferenceFinalizationValidationError,
    promote_reference_to_final,
)
from app.ar_matching.reference_validation import validate_reference_upload
from app.ar_matching.storage_models import LabelReferenceTrack
from app.models import Label, Notification
from app.services import reference_r2_promotion

_OWNER = "11111111-1111-4111-8111-111111111111"
_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_REFERENCE = "22222222-2222-4222-8222-222222222222"
_MISSING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
_TOKEN = "33333333-3333-4333-8333-333333333333"
_LIMIT = 1024
_STAGING_ETAG = '"Opaque-Stage-Tag"'
_FINAL_ETAG = '"Opaque-Final-Tag"'
_OLD_UPDATED_AT = datetime(2000, 1, 1, tzinfo=UTC)
FinalReferencePromotion = reference_r2_promotion.FinalReferencePromotion
PreconditionError = reference_r2_promotion.ReferenceR2PreconditionError
PromotionError = reference_r2_promotion.ReferenceR2PromotionProviderError


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

    tables = [Label.__table__, Notification.__table__, LabelReferenceTrack.__table__]
    SQLModel.metadata.create_all(test_engine, tables=tables)
    with Session(test_engine) as session:
        for identity, name in ((_OWNER, "Owner"), (_OTHER, "Other")):
            session.add(
                Label(
                    id=identity,
                    name=name,
                    slug=f"{name.lower()}-{uuid4()}",
                    owner_email=f"{uuid4()}@example.test",
                )
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
        staging_key=f"label-references/{_OWNER}/{_REFERENCE}/staging/original.wav",
        staging_etag=_STAGING_ETAG,
        **changes,
    )


def _final_key(owner=_OWNER, reference=_REFERENCE):
    return f"label-references/{owner}/{reference}/original.wav"


_BAD_RECEIPTS = (
    object(),
    FinalReferencePromotion("other/key", _FINAL_ETAG),
    FinalReferencePromotion(_final_key(), "bad\r\netag"),
)


def _mutate(engine, changes, *, table="label_reference_tracks", identity=_REFERENCE, delete=False):
    with Session(engine) as session:
        session.execute(text("PRAGMA ignore_check_constraints = ON"))
        if delete:
            session.execute(text(f"DELETE FROM {table} WHERE id = :id"), {"id": identity})
        else:
            assignments = ", ".join(f"{field} = :{field}" for field in changes)
            session.execute(
                text(f"UPDATE {table} SET {assignments} WHERE id = :id"),
                {**changes, "id": identity},
            )
        session.commit()


class FakeAdapter:
    def __init__(self, result=None, callback=None, error=None):
        self.result = result or FinalReferencePromotion(_final_key(), _FINAL_ETAG)
        self.callback = callback
        self.error = error
        self.calls = []
        self.copied_bytes = b"retained-after-copy"

    def promote(self, owner, reference, upload, staging_etag):
        self.calls.append((owner, reference, upload, staging_etag))
        if self.callback is not None:
            self.callback()
        if self.error is not None:
            raise self.error
        return self.result


@contextmanager
def _tracked_sessions(engine, events):
    session = Session(engine)
    events.append("open")
    try:
        yield session
    finally:
        session.close()
        events.append("close")


def _stored_row(engine):
    with Session(engine) as session:
        return session.get(LabelReferenceTrack, _REFERENCE)


def _assert_unfinalized(engine):
    row = _stored_row(engine)
    assert row.storage_key is None and row.final_etag is None
    assert row.status == "uploaded"


def _call(engine, adapter_factory, *, owner=_OWNER, reference=_REFERENCE, session_factory=None):
    return promote_reference_to_final(
        owner,
        reference,
        session_factory=session_factory or (lambda: Session(engine)),
        adapter_factory=adapter_factory,
    )


@pytest.mark.parametrize(
    ("owner", "reference", "change", "error"),
    [
        (_OTHER, _REFERENCE, None, ReferenceFinalizationNotFoundError),
        (_OWNER, _MISSING, None, ReferenceFinalizationNotFoundError),
        (_OWNER, _REFERENCE, {"is_active": 0}, ReferenceFinalizationNotFoundError),
        (_OTHER.upper(), _REFERENCE, None, ReferenceFinalizationValidationError),
        (_OWNER, _OTHER.upper(), None, ReferenceFinalizationValidationError),
        (_OWNER, _REFERENCE, {"staging_etag": None}, ReferenceFinalizationConflictError),
        (_OWNER, _REFERENCE, {"staging_key": "wrong/key"}, ReferenceFinalizationConflictError),
        (_OWNER, _REFERENCE, {"final_etag": _FINAL_ETAG}, ReferenceFinalizationConflictError),
        (_OWNER, _REFERENCE, {"storage_key": _final_key()}, ReferenceFinalizationConflictError),
    ],
)
def test_ineligible_identity_or_corrupt_reservation_never_constructs_adapter(
    engine, owner, reference, change, error
):
    if change:
        _mutate(engine, change)
    with pytest.raises(error):
        _call(
            engine,
            lambda: pytest.fail("adapter must not be constructed"),
            owner=owner,
            reference=reference,
        )


def test_inactive_label_and_invalid_descriptor_fail_before_provider(engine):
    _mutate(engine, {"subscription_status": "frozen"}, table="label", identity=_OWNER)
    with pytest.raises(ReferenceFinalizationNotFoundError):
        _call(engine, lambda: pytest.fail("inactive owner must not reach provider"))

    _mutate(engine, {"subscription_status": "active"}, table="label", identity=_OWNER)
    _mutate(engine, {"upload_size_bytes": 0})
    with pytest.raises(ReferenceFinalizationConflictError):
        _call(engine, lambda: pytest.fail("corrupt descriptor must not reach provider"))


@pytest.mark.parametrize("status", ["uploaded", "processing", "ready", "failed"])
def test_coherent_persisted_final_receipt_is_readonly_reuse(engine, status):
    _mutate(engine, {"status": status, "storage_key": _final_key(), "final_etag": _FINAL_ETAG})
    statements = []
    event.listen(engine, "before_cursor_execute", lambda _c, _cu, sql, *_a: statements.append(sql))

    result = _call(engine, lambda: pytest.fail("persisted receipt must bypass provider"))

    assert result.reused is True
    assert result.status == status
    assert result.final_key == _final_key() and result.final_etag == _FINAL_ETAG
    assert not any(sql.lstrip().upper().startswith("UPDATE") for sql in statements)
    row = _stored_row(engine)
    assert row.updated_at.replace(tzinfo=UTC) == _OLD_UPDATED_AT


def test_copy_closes_first_session_then_cas_persists_receipt_without_status_change(engine):
    events = []
    adapter = FakeAdapter(callback=lambda: events == ["open", "close"] or pytest.fail(events))
    result = _call(
        engine,
        lambda: adapter,
        session_factory=lambda: _tracked_sessions(engine, events),
    )

    assert events == ["open", "close", "open", "close"]
    assert result.reused is False and result.status == "uploaded"
    expected_upload = validate_reference_upload("reference.wav", 128, _LIMIT)
    assert adapter.calls == [(_OWNER, _REFERENCE, expected_upload, _STAGING_ETAG)]
    row = _stored_row(engine)
    assert row.storage_key == _final_key() and row.final_etag == _FINAL_ETAG
    assert row.status == "uploaded" and row.staging_etag == _STAGING_ETAG
    assert row.updated_at.replace(tzinfo=UTC) > _OLD_UPDATED_AT


@pytest.mark.parametrize("receipt", _BAD_RECEIPTS)
def test_malformed_provider_receipt_fails_closed_without_database_persist(engine, receipt):
    adapter = FakeAdapter(result=receipt)
    with pytest.raises(ReferenceFinalizationValidationError):
        _call(engine, lambda: adapter)
    assert adapter.copied_bytes == b"retained-after-copy"
    _assert_unfinalized(engine)


@pytest.mark.parametrize("error", [PreconditionError("generic"), PromotionError("generic")])
def test_provider_failure_propagates_without_second_session_or_database_change(engine, error):
    events = []
    adapter = FakeAdapter(error=error)
    with pytest.raises(type(error)):
        _call(engine, lambda: adapter, session_factory=lambda: _tracked_sessions(engine, events))
    assert events == ["open", "close"]
    assert adapter.copied_bytes == b"retained-after-copy"
    _assert_unfinalized(engine)


@pytest.mark.parametrize(
    ("changes", "table", "delete"),
    [
        ({"label_id": _OTHER}, "label_reference_tracks", False),
        ({"status": "failed"}, "label_reference_tracks", False),
        ({"upload_size_bytes": 129}, "label_reference_tracks", False),
        ({"staging_etag": '"raced"'}, "label_reference_tracks", False),
        ({"subscription_status": "frozen"}, "label", False),
        ({}, "label_reference_tracks", True),
    ],
)
def test_interleaved_cas_states(engine, changes, table, delete):
    def interleave():
        identity = _OWNER if table == "label" else _REFERENCE
        _mutate(engine, changes, table=table, identity=identity, delete=delete)

    with pytest.raises(ReferenceFinalizationConflictError):
        _call(engine, lambda: FakeAdapter(callback=interleave))
    row = _stored_row(engine)
    assert (row is None) == delete
    if row is not None:
        assert row.storage_key is None and row.final_etag is None


@pytest.mark.parametrize("fault", ["update", "commit"])
def test_second_transaction_failure_rolls_back_without_receipt_adoption(engine, fault):
    adapter = FakeAdapter()
    calls = []

    def commit_fault_factory():
        session = Session(engine)
        calls.append(session)
        if len(calls) == 2:
            event.listen(
                session,
                "before_commit",
                lambda _session: (_ for _ in ()).throw(RuntimeError("injected commit failure")),
            )
        return session

    def fail_update(_conn, _cursor, statement, *_args):
        if statement.lstrip().upper().startswith("UPDATE LABEL_REFERENCE_TRACKS"):
            raise RuntimeError("injected persistence failure")

    if fault == "update":
        event.listen(engine, "before_cursor_execute", fail_update)
    else:
        session_factory = commit_fault_factory

    factory = session_factory if fault == "commit" else None
    with pytest.raises(ReferenceFinalizationConflictError):
        _call(engine, lambda: adapter, session_factory=factory)
    assert adapter.copied_bytes == b"retained-after-copy"
    _assert_unfinalized(engine)


@pytest.mark.parametrize("dirty_phase", ["first", "second"])
def test_dirty_sessions_fail_closed_without_autoflush_or_persist(engine, dirty_phase):
    calls = []

    def session_factory():
        calls.append(True)
        session = Session(engine)
        if dirty_phase == "first" or len(calls) == 2:
            session.add(
                Label(
                    id=_MISSING,
                    name="Pending",
                    slug=f"pending-{uuid4()}",
                    owner_email=f"{uuid4()}@example.test",
                )
            )
        return session

    adapter_factory = (
        (lambda: FakeAdapter())
        if dirty_phase == "second"
        else lambda: pytest.fail("dirty session must not construct provider")
    )
    with pytest.raises(ReferenceFinalizationSessionError):
        _call(engine, adapter_factory, session_factory=session_factory)
    assert calls == ([True] if dirty_phase == "first" else [True, True])
    _assert_unfinalized(engine)


def test_retry_after_completed_copy_reuses_database_receipt_without_provider(engine):
    _call(engine, lambda: FakeAdapter())
    result = _call(engine, lambda: pytest.fail("retry must be database-only"))
    assert result.reused is True and result.status == "uploaded"
