"""SQLite contract tests for explicit authorized reference-processing resumption."""

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
from app.ar_matching.reference_processing_publications import (
    publish_reference_processing_success,
)
from app.ar_matching.reference_processing_resumptions import resume_reference_processing
from app.ar_matching.reference_validation import ValidatedReferenceUpload
from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding
from app.audio.embedding.schemas import EmbeddingMetadata, TrackEmbedding
from app.models import Label, Notification, Submission

_LABEL = "11111111-1111-4111-8111-111111111111"
_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_REFERENCE = "22222222-2222-4222-8222-222222222222"
_OLD = datetime(2000, 1, 1, tzinfo=UTC)
_EMBEDDED_AT = datetime(2010, 6, 1, tzinfo=UTC)
_STAGE = '"Opaque-Stage-Tag"'
_FINAL = '"Opaque-Final-Tag"'
_LIMIT = 1024
_VERSION = "pipeline-v1"
_METADATA = EmbeddingMetadata(
    provider="unit-provider", model="unit-model", version="model-v9", dimension=512
)


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


def _embedding():
    return TrackEmbedding(metadata=_METADATA, vector=(1.0,) * 512, created_at=_EMBEDDED_AT)


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


def _tracked_factory(engine, calls, events):
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

    return factory


def test_resumption_rotates_the_token_and_preserves_all_identity(engine):
    old = _receipt(engine)
    before = _stored(engine)
    resumed = resume_reference_processing(old, session_factory=lambda: Session(engine))
    assert resumed.processing_claim_token != old.processing_claim_token
    assert resumed.status == "processing"
    assert (
        resumed.label_id,
        resumed.reference_id,
        resumed.title,
        resumed.artist,
        resumed.upload,
        resumed.staging_key,
        resumed.staging_etag,
        resumed.final_key,
        resumed.final_etag,
    ) == (
        old.label_id,
        old.reference_id,
        old.title,
        old.artist,
        old.upload,
        old.staging_key,
        old.staging_etag,
        old.final_key,
        old.final_etag,
    )
    row = _stored(engine)
    assert (
        row.status == "processing" and row.processing_claim_token == resumed.processing_claim_token
    )
    assert row.updated_at.replace(tzinfo=UTC) > _OLD
    assert row.created_at == before.created_at
    assert row.is_active is True


def test_commit_precedes_close_and_return(engine):
    receipt, events = _receipt(engine), []

    @contextmanager
    def factory():
        session = Session(engine)
        events.append("open")
        event.listen(session, "before_commit", lambda *_: events.append("commit"))
        try:
            yield session
        finally:
            session.close()
            events.append("close")

    resumed = resume_reference_processing(receipt, session_factory=factory)
    assert events == ["open", "commit", "close"]
    assert _stored(engine).processing_claim_token == resumed.processing_claim_token


def test_resumption_emits_one_select_one_update_and_preserves_frozen_fields(engine):
    old = _receipt(engine)
    before = _stored(engine)
    statements, calls, events = [], [], []

    def record_statement(_connection, _cursor, sql, *_):
        statements.append(sql.lstrip().split()[0].upper())

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        resume_reference_processing(old, session_factory=_tracked_factory(engine, calls, events))
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    assert calls == [True] and events == ["open", "close"]
    assert statements.count("SELECT") == 1 and statements.count("UPDATE") == 1
    assert "INSERT" not in statements and "DELETE" not in statements
    with Session(engine) as session:
        assert session.query(MusicEmbedding).count() == 0
    after = _stored(engine)
    assert (
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
        after.duration_seconds,
    ) == (
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
        before.duration_seconds,
    )


@pytest.mark.parametrize("completion", ["publish", "fail"])
def test_old_receipt_completions_are_fenced_after_resumption(engine, completion):
    old = _receipt(engine)
    resumed = resume_reference_processing(old, session_factory=lambda: Session(engine))
    with pytest.raises(ReferenceProcessingClaimConflictError):
        if completion == "publish":
            publish_reference_processing_success(
                old, _embedding(), _VERSION, session_factory=lambda: Session(engine)
            )
        else:
            fail_reference_processing(old, session_factory=lambda: Session(engine))
    row = _stored(engine)
    assert row.status == "processing"
    assert row.processing_claim_token == resumed.processing_claim_token
    with Session(engine) as session:
        assert session.query(MusicEmbedding).count() == 0


def test_chained_resumptions_fence_every_prior_receipt(engine):
    first = _receipt(engine)
    second = resume_reference_processing(first, session_factory=lambda: Session(engine))
    third = resume_reference_processing(second, session_factory=lambda: Session(engine))
    assert (
        len(
            {
                first.processing_claim_token,
                second.processing_claim_token,
                third.processing_claim_token,
            }
        )
        == 3
    )
    with pytest.raises(ReferenceProcessingClaimConflictError):
        fail_reference_processing(first, session_factory=lambda: Session(engine))
    with pytest.raises(ReferenceProcessingClaimConflictError):
        publish_reference_processing_success(
            second, _embedding(), _VERSION, session_factory=lambda: Session(engine)
        )
    row = _stored(engine)
    assert row.status == "processing" and row.processing_claim_token == third.processing_claim_token


@pytest.mark.parametrize(("completion", "expected"), [("publish", "ready"), ("fail", "failed")])
def test_new_receipt_completes_successfully_after_resumption(engine, completion, expected):
    resumed = resume_reference_processing(_receipt(engine), session_factory=lambda: Session(engine))
    if completion == "publish":
        publish_reference_processing_success(
            resumed, _embedding(), _VERSION, session_factory=lambda: Session(engine)
        )
    else:
        fail_reference_processing(resumed, session_factory=lambda: Session(engine))
    row = _stored(engine)
    assert row.status == expected and row.processing_claim_token is None
    with Session(engine) as session:
        assert session.query(MusicEmbedding).count() == (1 if expected == "ready" else 0)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("status", "uploaded"),
        ("status", "failed"),
        ("status", "ready"),
        ("processing_claim_token", None),
    ],
)
def test_resume_does_not_adopt_drifted_gate_fields(engine, field, value):
    receipt = _receipt(engine)
    _change(engine, "label_reference_tracks", field, value)
    with pytest.raises(ReferenceProcessingClaimConflictError):
        resume_reference_processing(receipt, session_factory=lambda: Session(engine))
    assert getattr(_stored(engine), field) == value


@pytest.mark.parametrize(
    "token", ["55555555-5555-4555-8555-555555555555", "malformed-replaced-token"]
)
def test_stale_or_replaced_token_cannot_resume(engine, token):
    receipt = _receipt(engine)
    _change(engine, "label_reference_tracks", "processing_claim_token", token)
    with pytest.raises(ReferenceProcessingClaimConflictError):
        resume_reference_processing(receipt, session_factory=lambda: Session(engine))
    row = _stored(engine)
    assert row.status == "processing" and row.processing_claim_token == token


def test_initial_claim_is_impossible_while_processing(engine):
    receipt = _receipt(engine)
    with pytest.raises(ReferenceProcessingClaimConflictError):
        claim_reference_processing(_LABEL, _REFERENCE, session_factory=lambda: Session(engine))
    row = _stored(engine)
    assert (
        row.status == "processing" and row.processing_claim_token == receipt.processing_claim_token
    )


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
        resume_reference_processing(receipt, session_factory=lambda: Session(engine))
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
        ("staging_key", 5),
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
        resume_reference_processing(receipt, session_factory=lambda: calls.append(True))
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
        resume_reference_processing(receipt, session_factory=_tracked_factory(engine, calls, []))
    assert calls == []


def test_nonreceipt_object_is_not_accepted(engine):
    with pytest.raises(ReferenceProcessingClaimValidationError):
        resume_reference_processing(object(), session_factory=lambda: pytest.fail("factory called"))


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
        resume_reference_processing(receipt, session_factory=factory)
    assert events == ["open", "close"]
    with Session(engine) as session:
        assert session.get(Label, _OTHER).name == "Other"


@pytest.mark.parametrize("statement", ["SELECT", "UPDATE"])
def test_statement_failures_propagate_rollback_and_close(engine, statement):
    receipt, events = _receipt(engine), []

    def fail_statement(_connection, _cursor, sql, *_):
        if sql.lstrip().upper().startswith(statement):
            raise RuntimeError("query fault")

    event.listen(engine, "before_cursor_execute", fail_statement)
    try:
        with pytest.raises(RuntimeError, match="query fault"):
            resume_reference_processing(
                receipt, session_factory=_tracked_factory(engine, [], events)
            )
    finally:
        event.remove(engine, "before_cursor_execute", fail_statement)
    assert events == ["open", "close"]
    row = _stored(engine)
    assert row.status == "processing"
    assert row.processing_claim_token == receipt.processing_claim_token


def test_commit_failure_propagates_rolls_back_and_closes(engine):
    receipt, events = _receipt(engine), []

    @contextmanager
    def factory():
        session = Session(engine)
        events.append("open")
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

    with pytest.raises(RuntimeError, match="commit fault"):
        resume_reference_processing(receipt, session_factory=factory)
    assert events == ["open", "close"]
    row = _stored(engine)
    assert row.status == "processing"
    assert row.processing_claim_token == receipt.processing_claim_token


def test_fault_after_update_before_commit_rolls_the_rotation_back(engine):
    receipt, events, fired = _receipt(engine), [], []

    def fail_after_update(_connection, _cursor, sql, *_):
        if sql.lstrip().upper().startswith("UPDATE LABEL_REFERENCE_TRACKS"):
            fired.append(True)
            raise RuntimeError("post-update fault")

    event.listen(engine, "after_cursor_execute", fail_after_update)
    try:
        with pytest.raises(RuntimeError, match="post-update fault"):
            resume_reference_processing(
                receipt, session_factory=_tracked_factory(engine, [], events)
            )
    finally:
        event.remove(engine, "after_cursor_execute", fail_after_update)
    assert fired == [True] and events == ["open", "close"]
    row = _stored(engine)
    assert row.status == "processing"
    assert row.processing_claim_token == receipt.processing_claim_token


def test_factory_exit_fault_after_commit_keeps_rotation_without_receipt(engine):
    """Accepted edge (no new policy): a fault raised in the factory exit after the
    commit persists the rotation while the caller receives no new receipt. The next
    authorized resumption with the ORIGINAL receipt then conflicts on the rotated
    token; that is the documented manual-follow-up behavior, asserted honestly here."""

    receipt, events = _receipt(engine), []

    @contextmanager
    def factory():
        session = Session(engine)
        events.append("open")
        try:
            yield session
        finally:
            session.close()
            events.append("close")
        raise RuntimeError("factory exit fault")

    with pytest.raises(RuntimeError, match="factory exit fault"):
        resume_reference_processing(receipt, session_factory=factory)
    assert events == ["open", "close"]
    row = _stored(engine)
    assert row.status == "processing"
    assert row.processing_claim_token != receipt.processing_claim_token
    with pytest.raises(ReferenceProcessingClaimConflictError):
        resume_reference_processing(receipt, session_factory=lambda: Session(engine))


def test_conflict_propagates_rolls_back_and_closes_cleanly(engine):
    receipt, events = _receipt(engine), []
    _change(engine, "label_reference_tracks", "processing_claim_token", _OTHER)

    with pytest.raises(ReferenceProcessingClaimConflictError):
        resume_reference_processing(receipt, session_factory=_tracked_factory(engine, [], events))
    assert events == ["open", "close"]
    row = _stored(engine)
    assert row.status == "processing" and row.processing_claim_token == _OTHER


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("title", "Raced"),
        ("artist", None),
        ("upload_filename", "raced.flac"),
        ("staging_etag", '"raced-stage"'),
        ("is_active", 0),
    ],
)
def test_cas_rechecks_frozen_field_drift_after_the_owner_read(engine, field, value):
    receipt = _receipt(engine)
    raced = []

    def race(_connection, cursor, sql, *_):
        if not raced and sql.lstrip().upper().startswith("UPDATE LABEL_REFERENCE_TRACKS"):
            cursor.execute("PRAGMA ignore_check_constraints=ON")
            cursor.execute(
                f"UPDATE label_reference_tracks SET {field}=? WHERE id=?", (value, _REFERENCE)
            )
            cursor.connection.commit()
            raced.append(True)

    event.listen(engine, "before_cursor_execute", race)
    try:
        with pytest.raises(ReferenceProcessingClaimConflictError):
            resume_reference_processing(receipt, session_factory=lambda: Session(engine))
    finally:
        event.remove(engine, "before_cursor_execute", race)
    assert raced == [True]
    row = _stored(engine)
    assert row.status == "processing"
    assert row.processing_claim_token == receipt.processing_claim_token
    assert getattr(row, field) == value


def test_concurrent_resumption_with_same_old_receipt_exactly_one_wins(engine):
    receipt = _receipt(engine)
    winner = resume_reference_processing(receipt, session_factory=lambda: Session(engine))
    with pytest.raises(ReferenceProcessingClaimConflictError):
        resume_reference_processing(receipt, session_factory=lambda: Session(engine))
    row = _stored(engine)
    assert row.status == "processing"
    assert row.processing_claim_token == winner.processing_claim_token
    assert winner.processing_claim_token != receipt.processing_claim_token
