"""SQLite unit tests for a one-time reference-processing claim."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import FrozenInstanceError
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.ar_matching.reference_processing_claims import (
    ReferenceProcessingClaimConflictError,
    ReferenceProcessingClaimNotFoundError,
    ReferenceProcessingClaimSessionError,
    ReferenceProcessingClaimValidationError,
    claim_reference_processing,
)
from app.ar_matching.reference_validation import ValidatedReferenceUpload
from app.ar_matching.storage_models import LabelReferenceTrack
from app.models import Label, Notification

_LABEL = "11111111-1111-4111-8111-111111111111"
_OTHER_LABEL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_REFERENCE = "22222222-2222-4222-8222-222222222222"
_SECOND_REFERENCE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
_MISSING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
_IDEMPOTENCY = "33333333-3333-4333-8333-333333333333"
_SECOND_IDEMPOTENCY = "44444444-4444-4444-8444-444444444444"
_CLAIM_TOKEN = "55555555-5555-4555-8555-555555555555"
_STAGE_ETAG = '"Opaque-Stage-Tag"'
_FINAL_ETAG = '"Opaque-Final-Tag"'
_LIMIT = 1_024
_OLD_UPDATED = datetime(2000, 1, 1, tzinfo=UTC)


def _final_key(label=_LABEL, reference=_REFERENCE, extension=".wav"):
    return f"label-references/{label}/{reference}/original{extension}"


def _staging_key(label=_LABEL, reference=_REFERENCE, extension=".wav"):
    return f"label-references/{label}/{reference}/staging/original{extension}"


def _reference(*, identity=_REFERENCE, label=_LABEL, idempotency=_IDEMPOTENCY, **changes):
    return LabelReferenceTrack(
        id=identity,
        label_id=label,
        title="Reference title",
        artist="Reference artist",
        status="uploaded",
        is_active=True,
        upload_idempotency_key=idempotency,
        upload_filename="reference.wav",
        upload_size_bytes=128,
        upload_limit_bytes=_LIMIT,
        staging_key=_staging_key(label, identity),
        staging_etag=_STAGE_ETAG,
        storage_key=_final_key(label, identity),
        final_etag=_FINAL_ETAG,
        updated_at=_OLD_UPDATED,
        **changes,
    )


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
        session.add_all(
            Label(
                id=identity,
                name=name,
                slug=f"{name.lower()}-{uuid4()}",
                owner_email=f"{uuid4()}@example.test",
            )
            for identity, name in ((_LABEL, "Owner"), (_OTHER_LABEL, "Other"))
        )
        session.commit()
        session.add(_reference())
        session.commit()
    try:
        yield test_engine
    finally:
        SQLModel.metadata.drop_all(test_engine, tables=list(reversed(tables)))
        test_engine.dispose()


def _mutate(engine, changes, *, table="label_reference_tracks", identity=_REFERENCE):
    with Session(engine) as session:
        session.execute(text("PRAGMA ignore_check_constraints = ON"))
        assignments = ", ".join(f"{field} = :{field}" for field in changes)
        session.execute(
            text(f"UPDATE {table} SET {assignments} WHERE id = :identity"),
            {**changes, "identity": identity},
        )
        session.commit()


def _stored(engine, identity=_REFERENCE):
    with Session(engine) as session:
        return session.get(LabelReferenceTrack, identity)


def _claim(engine, *, label=_LABEL, reference=_REFERENCE, session_factory=None):
    factory = session_factory or (lambda: Session(engine))
    return claim_reference_processing(label, reference, session_factory=factory)


@contextmanager
def _tracked_session(engine, events, *, fail_commit=False):
    session = Session(engine)
    events.append("open")
    if fail_commit:
        event.listen(
            session,
            "before_commit",
            lambda _session: (_ for _ in ()).throw(RuntimeError("injected commit failure")),
        )
    try:
        yield session
    finally:
        session.close()
        events.append("close")


@pytest.mark.parametrize(
    ("label", "reference"),
    [
        ("not-a-uuid", _REFERENCE),
        (_OTHER_LABEL.upper(), _REFERENCE),
        (_LABEL, _SECOND_REFERENCE.upper()),
        (None, _REFERENCE),
        (_LABEL, True),
    ],
)
def test_noncanonical_identities_fail_before_factory(label, reference):
    calls = []
    with pytest.raises(ReferenceProcessingClaimValidationError):
        claim_reference_processing(label, reference, session_factory=lambda: calls.append(True))
    assert calls == []


@pytest.mark.parametrize(
    ("label", "reference", "change", "table"),
    [
        (_OTHER_LABEL, _REFERENCE, None, "label_reference_tracks"),
        (_LABEL, _MISSING, None, "label_reference_tracks"),
        (_LABEL, _REFERENCE, {"is_active": 0}, "label_reference_tracks"),
        (_LABEL, _REFERENCE, {"subscription_status": "frozen"}, "label"),
    ],
)
def test_unowned_missing_or_inactive_identity_is_redacted_not_found(
    engine, label, reference, change, table
):
    if change:
        _mutate(engine, change, table=table, identity=_LABEL if table == "label" else _REFERENCE)
    with pytest.raises(ReferenceProcessingClaimNotFoundError) as error:
        _claim(engine, label=label, reference=reference)
    assert _STAGE_ETAG not in str(error.value) and _FINAL_ETAG not in str(error.value)


@pytest.mark.parametrize("status", ["processing", "ready", "failed"])
def test_non_uploaded_status_cannot_be_claimed_or_reused(engine, status):
    _mutate(engine, {"status": status})
    pytest.raises(ReferenceProcessingClaimConflictError, lambda: _claim(engine))


@pytest.mark.parametrize(
    "changes",
    [
        {"processing_claim_token": _CLAIM_TOKEN},
        {"upload_idempotency_key": "not-a-uuid"},
        {"upload_filename": "private.exe"},
        {"upload_size_bytes": 0},
        {"upload_limit_bytes": 0},
        {"staging_key": "private/staging/key"},
        {"staging_etag": None},
        {"staging_etag": "bad\r\netag"},
        {"storage_key": None},
        {"storage_key": "private/final/key"},
        {"final_etag": None},
        {"final_etag": "bad\r\netag"},
        {"title": "  padded title"},
    ],
)
def test_incomplete_or_malformed_persisted_metadata_conflicts_without_leaking_values(
    engine, changes
):
    _mutate(engine, changes)
    with pytest.raises(ReferenceProcessingClaimConflictError) as error:
        _claim(engine)
    assert "private/" not in str(error.value) and "bad\r\n" not in str(error.value)
    row = _stored(engine)
    assert row.status == "uploaded"
    assert row.processing_claim_token == changes.get("processing_claim_token")


def test_claim_commits_minimal_update_and_returns_immutable_internal_receipt(engine):
    before = _stored(engine)
    calls = []
    events = []

    def factory():
        calls.append(True)
        return _tracked_session(engine, events)

    receipt = _claim(engine, session_factory=factory)

    assert calls == [True] and events == ["open", "close"]
    assert receipt.label_id == _LABEL and receipt.reference_id == _REFERENCE
    assert receipt.status == "processing"
    assert str(UUID(receipt.processing_claim_token)) == receipt.processing_claim_token
    assert receipt.processing_claim_token != _IDEMPOTENCY
    assert receipt.title == before.title and receipt.artist == before.artist
    assert receipt.upload == ValidatedReferenceUpload(
        "reference.wav", ".wav", "audio/wav", 128, _LIMIT
    )
    assert receipt.staging_key == _staging_key() and receipt.staging_etag == _STAGE_ETAG
    assert receipt.final_key == _final_key() and receipt.final_etag == _FINAL_ETAG
    assert not hasattr(receipt, "storage_url") and not hasattr(receipt, "credentials")
    with pytest.raises(FrozenInstanceError):
        receipt.status = "ready"

    after = _stored(engine)
    assert (
        after.status == "processing"
        and after.processing_claim_token == receipt.processing_claim_token
    )
    assert after.updated_at.replace(tzinfo=UTC) > _OLD_UPDATED
    assert (
        after.label_id,
        after.title,
        after.artist,
        after.upload_idempotency_key,
        after.upload_filename,
        after.upload_size_bytes,
        after.upload_limit_bytes,
        after.staging_key,
        after.staging_etag,
        after.storage_key,
        after.final_etag,
        after.created_at,
    ) == (
        before.label_id,
        before.title,
        before.artist,
        before.upload_idempotency_key,
        before.upload_filename,
        before.upload_size_bytes,
        before.upload_limit_bytes,
        before.staging_key,
        before.staging_etag,
        before.storage_key,
        before.final_etag,
        before.created_at,
    )


def test_initial_claim_is_once_only_and_tokens_are_fresh_across_references(engine):
    first = _claim(engine)
    with Session(engine) as session:
        session.add(
            _reference(
                identity=_SECOND_REFERENCE,
                idempotency=_SECOND_IDEMPOTENCY,
            )
        )
        session.commit()
    second = _claim(engine, reference=_SECOND_REFERENCE)
    assert first.processing_claim_token != second.processing_claim_token
    pytest.raises(ReferenceProcessingClaimConflictError, lambda: _claim(engine))


@pytest.mark.parametrize(
    ("table", "field", "value"),
    [
        ("label_reference_tracks", "label_id", _OTHER_LABEL),
        ("label_reference_tracks", "is_active", 0),
        ("label_reference_tracks", "status", "failed"),
        ("label_reference_tracks", "processing_claim_token", _CLAIM_TOKEN),
        ("label_reference_tracks", "title", "Raced title"),
        ("label_reference_tracks", "artist", None),
        ("label_reference_tracks", "upload_idempotency_key", _SECOND_IDEMPOTENCY),
        ("label_reference_tracks", "upload_filename", "raced.flac"),
        ("label_reference_tracks", "upload_size_bytes", 129),
        ("label_reference_tracks", "upload_limit_bytes", 2_048),
        ("label_reference_tracks", "staging_key", "raced/staging/key"),
        ("label_reference_tracks", "staging_etag", '"raced-stage"'),
        ("label_reference_tracks", "storage_key", "raced/final/key"),
        ("label_reference_tracks", "final_etag", '"raced-final"'),
        ("label", "subscription_status", "frozen"),
    ],
)
def test_compare_and_set_rejects_each_stale_snapshot_field(engine, table, field, value):
    raced = []

    def interleave(connection, cursor, statement, _parameters, _context, _many):
        if not raced and statement.lstrip().upper().startswith("UPDATE LABEL_REFERENCE_TRACKS"):
            cursor.execute("PRAGMA ignore_check_constraints=ON")
            identity = _LABEL if table == "label" else _REFERENCE
            cursor.execute(f"UPDATE {table} SET {field} = ? WHERE id = ?", (value, identity))
            raced.append(True)

    event.listen(engine, "before_cursor_execute", interleave)
    pytest.raises(ReferenceProcessingClaimConflictError, lambda: _claim(engine))
    assert raced == [True]
    row = _stored(engine)
    assert row.status != "processing" or row.processing_claim_token is None


@pytest.mark.parametrize("dirty_state", ["new", "dirty", "deleted", "transaction"])
def test_factory_session_must_be_clean_and_is_closed_without_committing_unrelated_work(
    engine, dirty_state
):
    def factory():
        session = Session(engine)
        if dirty_state == "new":
            session.add(
                Label(
                    id=_MISSING,
                    name="Pending",
                    slug=f"pending-{uuid4()}",
                    owner_email=f"{uuid4()}@example.test",
                )
            )
        elif dirty_state in ("dirty", "deleted"):
            label = session.get(Label, _OTHER_LABEL)
            if dirty_state == "dirty":
                label.name = "Uncommitted"
            else:
                session.delete(label)
        else:
            session.begin()
        return session

    pytest.raises(
        ReferenceProcessingClaimSessionError,
        lambda: _claim(engine, session_factory=factory),
    )
    with Session(engine) as session:
        other = session.get(Label, _OTHER_LABEL)
        assert other is not None and other.name == "Other"


@pytest.mark.parametrize("fault", ["query", "commit"])
def test_query_or_commit_failure_propagates_and_rolls_back_claim(engine, fault):
    events = []

    def factory():
        return _tracked_session(engine, events, fail_commit=fault == "commit")

    def fail_query(_connection, _cursor, statement, *_args):
        if "label.subscription_status" in statement:
            raise RuntimeError("injected query failure")

    if fault == "query":
        event.listen(engine, "before_cursor_execute", fail_query)
    expected = "injected query failure" if fault == "query" else "injected commit failure"
    error = pytest.raises(RuntimeError, lambda: _claim(engine, session_factory=factory))
    assert expected in str(error.value) and events == ["open", "close"]
    row = _stored(engine)
    assert row.status == "uploaded" and row.processing_claim_token is None
