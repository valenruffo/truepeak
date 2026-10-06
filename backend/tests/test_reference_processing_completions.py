"""SQLite contract tests for failure-only reference-processing completion."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.ar_matching.reference_processing_claims import (
    ReferenceProcessingClaimConflictError,
    ReferenceProcessingClaimNotFoundError,
    ReferenceProcessingClaimReceipt,
    ReferenceProcessingClaimSessionError,
    ReferenceProcessingClaimValidationError,
    claim_reference_processing,
)
from app.ar_matching.reference_processing_completions import fail_reference_processing
from app.ar_matching.reference_validation import ValidatedReferenceUpload
from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding
from app.models import Label, Notification, Submission

_LABEL = "11111111-1111-4111-8111-111111111111"
_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_REFERENCE = "22222222-2222-4222-8222-222222222222"
_OLD = datetime(2000, 1, 1, tzinfo=UTC)
_STAGE = '"Opaque-Stage-Tag"'
_FINAL = '"Opaque-Final-Tag"'
_LIMIT = 1024


def _key(kind, label=_LABEL, reference=_REFERENCE, extension=".wav"):
    middle = "/staging" if kind == "staging" else ""
    return f"label-references/{label}/{reference}{middle}/original{extension}"


def _reference():
    return LabelReferenceTrack(
        id=_REFERENCE,
        label_id=_LABEL,
        title="Reference title",
        artist="Reference artist",
        status="uploaded",
        is_active=True,
        upload_idempotency_key="33333333-3333-4333-8333-333333333333",
        upload_filename="reference.wav",
        upload_size_bytes=128,
        upload_limit_bytes=_LIMIT,
        staging_key=_key("staging"),
        staging_etag=_STAGE,
        storage_key=_key("final"),
        final_etag=_FINAL,
        duration_seconds=12.5,
        updated_at=_OLD,
    )


@pytest.fixture
def engine():
    db = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(db, "connect")
    def _foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    tables = [
        Label.__table__,
        Notification.__table__,
        Submission.__table__,
        LabelReferenceTrack.__table__,
        MusicEmbedding.__table__,
    ]
    SQLModel.metadata.create_all(db, tables=tables)
    with Session(db) as session:
        session.add_all(
            Label(
                id=identity,
                name=name,
                slug=f"{name}-{uuid4()}",
                owner_email=f"{uuid4()}@test.invalid",
            )
            for identity, name in ((_LABEL, "Owner"), (_OTHER, "Other"))
        )
        session.commit()
        session.add(_reference())
        session.commit()
    yield db
    SQLModel.metadata.drop_all(db, tables=list(reversed(tables)))
    db.dispose()


def _receipt(engine) -> ReferenceProcessingClaimReceipt:
    return claim_reference_processing(_LABEL, _REFERENCE, session_factory=lambda: Session(engine))


def _change(engine, table, field, value, identity=_REFERENCE):
    with Session(engine) as session:
        session.execute(text("PRAGMA ignore_check_constraints=ON"))
        session.execute(
            text(f"UPDATE {table} SET {field}=:value WHERE id=:id"),
            {"value": value, "id": identity},
        )
        session.commit()


def _stored(engine):
    with Session(engine) as session:
        return session.get(LabelReferenceTrack, _REFERENCE)


def _tracked_factory(engine, calls):
    @contextmanager
    def factory():
        calls.append(True)
        with Session(engine) as session:
            yield session

    return factory


def test_failure_completion_commits_only_terminal_fields_and_never_writes_embeddings(engine):
    receipt = _receipt(engine)
    before = _stored(engine)
    statements = []

    def record_statement(_connection, _cursor, sql, *_):
        statements.append(sql.lstrip().split()[0].upper())

    event.listen(engine, "before_cursor_execute", record_statement)
    calls, events = [], []

    @contextmanager
    def factory():
        calls.append(True)
        session = Session(engine)
        events.append("open")
        try:
            yield session
        finally:
            session.close()
            events.append("close")

    try:
        completed = fail_reference_processing(receipt, session_factory=factory)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    assert completed is None
    assert calls == [True] and events == ["open", "close"]
    assert statements.count("SELECT") == 1 and statements.count("UPDATE") == 1
    after = _stored(engine)
    assert after.status == "failed" and after.processing_claim_token is None
    assert after.updated_at.replace(tzinfo=UTC) > _OLD
    assert (
        after.created_at,
        after.label_id,
        after.title,
        after.artist,
        after.duration_seconds,
        after.is_active,
    ) == (
        before.created_at,
        before.label_id,
        before.title,
        before.artist,
        before.duration_seconds,
        before.is_active,
    )
    assert (
        after.upload_idempotency_key,
        after.upload_filename,
        after.upload_size_bytes,
        after.upload_limit_bytes,
    ) == (
        before.upload_idempotency_key,
        before.upload_filename,
        before.upload_size_bytes,
        before.upload_limit_bytes,
    )
    assert (after.staging_key, after.staging_etag, after.storage_key, after.final_etag) == (
        before.staging_key,
        before.staging_etag,
        before.storage_key,
        before.final_etag,
    )
    with Session(engine) as session:
        assert session.query(MusicEmbedding).count() == 0


@pytest.mark.parametrize("status", ["uploaded", "ready", "failed"])
def test_does_not_adopt_or_recomplete_nonprocessing_status(engine, status):
    receipt = _receipt(engine)
    _change(engine, "label_reference_tracks", "status", status)
    with pytest.raises(ReferenceProcessingClaimConflictError):
        fail_reference_processing(receipt, session_factory=lambda: Session(engine))
    assert _stored(engine).status == status


@pytest.mark.parametrize(
    "token", [None, "55555555-5555-4555-8555-555555555555", "malformed-private-token"]
)
def test_stale_missing_or_replaced_token_cannot_complete(engine, token):
    receipt = _receipt(engine)
    _change(engine, "label_reference_tracks", "processing_claim_token", token)
    with pytest.raises(ReferenceProcessingClaimConflictError):
        fail_reference_processing(receipt, session_factory=lambda: Session(engine))
    assert (
        _stored(engine).status == "processing" and _stored(engine).processing_claim_token == token
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("title", "Raced title"),
        ("artist", None),
        ("upload_filename", "raced.flac"),
        ("upload_size_bytes", 129),
        ("upload_limit_bytes", 2048),
        ("staging_key", "private/staging"),
        ("staging_etag", '"raced-stage"'),
        ("storage_key", "private/final"),
        ("final_etag", '"raced-final"'),
    ],
)
def test_current_frozen_metadata_mismatch_conflicts_without_overwriting(engine, field, value):
    receipt = _receipt(engine)
    _change(engine, "label_reference_tracks", field, value)
    with pytest.raises(ReferenceProcessingClaimConflictError):
        fail_reference_processing(receipt, session_factory=lambda: Session(engine))
    row = _stored(engine)
    assert (
        row.status == "processing" and row.processing_claim_token == receipt.processing_claim_token
    )
    assert getattr(row, field) == value


@pytest.mark.parametrize(
    ("table", "field", "value", "identity"),
    [
        ("label_reference_tracks", "label_id", _OTHER, _REFERENCE),
        ("label_reference_tracks", "is_active", 0, _REFERENCE),
        ("label", "subscription_status", "frozen", _LABEL),
        ("label_reference_tracks", "status", "processing", "missing"),
    ],
)
def test_missing_wrong_owner_or_inactive_reference_is_redacted_not_found(
    engine, table, field, value, identity
):
    receipt = _receipt(engine)
    if identity == "missing":
        with Session(engine) as session:
            session.execute(
                text("DELETE FROM label_reference_tracks WHERE id=:id"), {"id": _REFERENCE}
            )
            session.commit()
    else:
        _change(engine, table, field, value, identity)
    with pytest.raises(ReferenceProcessingClaimNotFoundError) as error:
        fail_reference_processing(receipt, session_factory=lambda: Session(engine))
    assert _STAGE not in str(error.value) and _FINAL not in str(error.value)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("label_id", "not-a-uuid"),
        ("reference_id", _OTHER),
        ("processing_claim_token", "not-a-uuid"),
        ("status", "failed"),
        ("title", "  "),
        ("artist", 3),
        ("staging_key", "private/stage"),
        ("final_key", "private/final"),
        ("staging_etag", "a" * 32),
        ("final_etag", "bad\r\netag"),
        ("upload", ValidatedReferenceUpload("reference.wav", ".flac", "audio/flac", 128, _LIMIT)),
    ],
)
def test_forged_receipt_is_rejected_before_opening_service_session(engine, field, value):
    receipt = _receipt(engine)
    object.__setattr__(receipt, field, value)
    calls = []
    with pytest.raises(ReferenceProcessingClaimValidationError):
        fail_reference_processing(receipt, session_factory=lambda: calls.append(True))
    assert calls == []


def test_same_named_upload_spoof_is_rejected_before_opening_service_session(engine):
    class ValidatedReferenceUpload:
        filename = "reference.wav"
        canonical_extension = ".wav"
        canonical_mime = "audio/wav"
        size_bytes = 128
        effective_limit_bytes = _LIMIT

        def __eq__(self, _other):
            return True

        def __ne__(self, _other):
            return False

    receipt = _receipt(engine)
    object.__setattr__(receipt, "upload", ValidatedReferenceUpload())
    calls = []
    with pytest.raises(ReferenceProcessingClaimValidationError):
        fail_reference_processing(receipt, session_factory=_tracked_factory(engine, calls))
    assert calls == []


@pytest.mark.parametrize("field", ["staging_key", "final_key"])
def test_nonstring_storage_key_spoof_is_rejected_before_opening_service_session(engine, field):
    class EqualString(str):
        def __eq__(self, _other):
            return True

        def __ne__(self, _other):
            return False

    receipt = _receipt(engine)
    object.__setattr__(receipt, field, EqualString(getattr(receipt, field)))
    calls = []
    with pytest.raises(ReferenceProcessingClaimValidationError):
        fail_reference_processing(receipt, session_factory=_tracked_factory(engine, calls))
    assert calls == []


def test_nonreceipt_object_is_not_accepted(engine):
    with pytest.raises(ReferenceProcessingClaimValidationError):
        fail_reference_processing(object(), session_factory=lambda: pytest.fail("factory called"))


@pytest.mark.parametrize("state", ["new", "dirty", "deleted", "transaction"])
def test_dirty_or_active_service_session_is_rejected_and_closed(engine, state):
    receipt, events = _receipt(engine), []

    @contextmanager
    def factory():
        session = Session(engine)
        events.append("open")
        if state == "new":
            session.add(
                Label(
                    id=str(uuid4()),
                    name="Pending",
                    slug=str(uuid4()),
                    owner_email=f"{uuid4()}@test.invalid",
                )
            )
        elif state in ("dirty", "deleted"):
            label = session.get(Label, _OTHER)
            session.delete(label) if state == "deleted" else setattr(label, "name", "Pending")
        else:
            session.begin()
        try:
            yield session
        finally:
            session.close()
            events.append("close")

    with pytest.raises(ReferenceProcessingClaimSessionError):
        fail_reference_processing(receipt, session_factory=factory)
    assert events == ["open", "close"]
    with Session(engine) as session:
        assert session.get(Label, _OTHER).name == "Other"


@pytest.mark.parametrize("fault", ["query", "commit"])
def test_query_and_commit_failures_propagate_rollback_and_close(engine, fault):
    receipt, events = _receipt(engine), []

    @contextmanager
    def factory():
        session = Session(engine)
        events.append("open")
        if fault == "commit":
            event.listen(
                session,
                "before_commit",
                lambda *_: (_ for _ in ()).throw(RuntimeError("commit fault")),
            )
        try:
            yield session
        finally:
            session.close()
            events.append("close")

    def fail_select(_connection, _cursor, sql, *_):
        if sql.lstrip().upper().startswith("SELECT"):
            raise RuntimeError("query fault")

    if fault == "query":
        event.listen(engine, "before_cursor_execute", fail_select)
    try:
        with pytest.raises(RuntimeError, match=f"{fault} fault"):
            fail_reference_processing(receipt, session_factory=factory)
    finally:
        if fault == "query":
            event.remove(engine, "before_cursor_execute", fail_select)
    assert events == ["open", "close"]
    assert _stored(engine).status == "processing"


@pytest.mark.parametrize("field", ["status", "processing_claim_token", "title", "is_active"])
def test_compare_and_set_rechecks_state_changed_after_initial_read(engine, field):
    receipt = _receipt(engine)
    raced = []

    values = {
        "status": "ready",
        "processing_claim_token": "55555555-5555-4555-8555-555555555555",
        "title": "Raced",
        "is_active": 0,
    }

    def race(_connection, cursor, sql, *_):
        if not raced and sql.lstrip().upper().startswith("UPDATE LABEL_REFERENCE_TRACKS"):
            cursor.execute("PRAGMA ignore_check_constraints=ON")
            cursor.execute(
                f"UPDATE label_reference_tracks SET {field}=? WHERE id=?",
                (values[field], _REFERENCE),
            )
            cursor.connection.commit()
            raced.append(True)

    event.listen(engine, "before_cursor_execute", race)
    try:
        with pytest.raises(ReferenceProcessingClaimConflictError):
            fail_reference_processing(receipt, session_factory=lambda: Session(engine))
    finally:
        event.remove(engine, "before_cursor_execute", race)
    assert raced == [True]
    assert getattr(_stored(engine), field) == values[field]
