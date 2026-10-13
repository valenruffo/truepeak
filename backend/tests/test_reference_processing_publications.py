"""SQLite contract tests for successful READY reference-processing publication."""

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
from app.ar_matching.reference_processing_publications import (
    publish_reference_processing_success,
)
from app.ar_matching.reference_validation import ValidatedReferenceUpload
from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding
from app.audio.embedding.schemas import (
    EmbeddingMetadata,
    EmbeddingValidationError,
    SegmentEmbedding,
    TrackEmbedding,
)
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


def _embedding():
    return TrackEmbedding(metadata=_METADATA, vector=(1.0,) * 512, created_at=_EMBEDDED_AT)


def _seed_embedding(engine):
    with Session(engine) as session:
        session.add(
            MusicEmbedding(
                label_id=_LABEL,
                reference_track_id=_REFERENCE,
                embedding=(1.0,) * 512,
                provider=_METADATA.provider,
                model=_METADATA.model,
                version=_METADATA.version,
                dimension=512,
                pipeline_version=_VERSION,
            )
        )
        session.commit()


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


def _embeddings(engine):
    with Session(engine) as session:
        return session.query(MusicEmbedding).all()


def _tracked_factory(engine, calls):
    @contextmanager
    def factory():
        calls.append(True)
        with Session(engine) as session:
            yield session

    return factory


def _publish(engine, receipt, embedding=None, version=_VERSION):
    return publish_reference_processing_success(
        receipt,
        embedding if embedding is not None else _embedding(),
        version,
        session_factory=lambda: Session(engine),
    )


def test_successful_publication_commits_ready_status_and_exactly_one_aggregate(engine):
    receipt = _receipt(engine)
    before = _stored(engine)
    embedding = _embedding()
    assert _publish(engine, receipt, embedding) is None
    after = _stored(engine)
    assert after.status == "ready" and after.processing_claim_token is None
    assert after.updated_at.replace(tzinfo=UTC) > _OLD
    immutable = (
        "created_at",
        "label_id",
        "title",
        "artist",
        "duration_seconds",
        "is_active",
        "upload_idempotency_key",
        "staging_key",
        "staging_etag",
        "storage_key",
        "final_etag",
        "upload_filename",
        "upload_size_bytes",
        "upload_limit_bytes",
    )
    assert [(field, getattr(after, field)) for field in immutable] == [
        (field, getattr(before, field)) for field in immutable
    ]
    rows = _embeddings(engine)
    assert len(rows) == 1
    row = rows[0]
    assert row.label_id == _LABEL and row.reference_track_id == _REFERENCE
    assert row.submission_id is None and row.segment_index == -1
    assert row.start_seconds is None and row.end_seconds is None
    assert (row.provider, row.model, row.version, row.dimension) == (
        _METADATA.provider,
        _METADATA.model,
        _METADATA.version,
        512,
    )
    assert row.pipeline_version == _VERSION
    assert row.created_at.replace(tzinfo=UTC) == _EMBEDDED_AT
    assert len(row.embedding) == 512
    assert row.embedding[0] == pytest.approx(embedding.vector[0])
    assert sum(value * value for value in row.embedding) == pytest.approx(1.0)


@pytest.mark.parametrize("status", ["uploaded", "ready", "failed"])
def test_does_not_publish_nonprocessing_status(engine, status):
    receipt = _receipt(engine)
    _change(engine, "label_reference_tracks", "status", status)
    with pytest.raises(ReferenceProcessingClaimConflictError):
        _publish(engine, receipt)
    assert _stored(engine).status == status
    assert len(_embeddings(engine)) == 0


@pytest.mark.parametrize(
    "token", ["55555555-5555-4555-8555-555555555555", None, "malformed-private-token"]
)
def test_stale_missing_or_replaced_token_cannot_publish(engine, token):
    receipt = _receipt(engine)
    _change(engine, "label_reference_tracks", "processing_claim_token", token)
    with pytest.raises(ReferenceProcessingClaimConflictError):
        _publish(engine, receipt)
    assert (
        _stored(engine).status == "processing" and _stored(engine).processing_claim_token == token
    )
    assert len(_embeddings(engine)) == 0


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
def test_frozen_field_mismatch_conflicts_and_rolls_back_the_embedding(engine, field, value):
    receipt = _receipt(engine)
    _change(engine, "label_reference_tracks", field, value)
    with pytest.raises(ReferenceProcessingClaimConflictError):
        _publish(engine, receipt)
    row = _stored(engine)
    assert (
        row.status == "processing" and row.processing_claim_token == receipt.processing_claim_token
    )
    assert getattr(row, field) == value
    assert len(_embeddings(engine)) == 0


def test_preseeded_aggregate_identity_conflicts_without_status_change(engine):
    receipt = _receipt(engine)
    _seed_embedding(engine)
    with pytest.raises(ReferenceProcessingClaimConflictError):
        _publish(engine, receipt)
    row = _stored(engine)
    assert (
        row.status == "processing" and row.processing_claim_token == receipt.processing_claim_token
    )
    assert len(_embeddings(engine)) == 1


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
        _publish(engine, receipt)
    assert _STAGE not in str(error.value) and _FINAL not in str(error.value)
    assert len(_embeddings(engine)) == 0


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("label_id", "not-a-uuid"),
        ("reference_id", _OTHER),
        ("processing_claim_token", "not-a-uuid"),
        ("status", "ready"),
        ("title", "  "),
        ("artist", 3),
        ("staging_key", "private/stage"),
        ("final_key", "private/final"),
        ("staging_etag", "g" * 32),
        ("final_etag", "bad\r\netag"),
        ("upload", ValidatedReferenceUpload("reference.wav", ".flac", "audio/flac", 128, _LIMIT)),
    ],
)
def test_forged_receipt_is_rejected_before_opening_service_session(engine, field, value):
    receipt = _receipt(engine)
    object.__setattr__(receipt, field, value)
    calls = []
    with pytest.raises(ReferenceProcessingClaimValidationError):
        publish_reference_processing_success(
            receipt, _embedding(), _VERSION, session_factory=lambda: calls.append(True)
        )
    assert calls == []


@pytest.mark.parametrize(
    ("staging_etag", "final_etag"),
    [
        ("a9cfebbe8cff1e7e27774a5e2812efb7", "bb1d2f4c9cae5e7e27774a5e2812efb7"),
        ('"a9cfebbe8cff1e7e27774a5e2812efb7"', '"bb1d2f4c9cae5e7e27774a5e2812efb7"'),
        ("a9cfebbe8cff1e7e27774a5e2812efb7-1", "bb1d2f4c9cae5e7e27774a5e2812efb7-2"),
    ],
)
def test_real_storage_etag_formats_are_accepted(engine, staging_etag, final_etag):
    _change(engine, "label_reference_tracks", "staging_etag", staging_etag)
    _change(engine, "label_reference_tracks", "final_etag", final_etag)

    _publish(engine, _receipt(engine))

    assert _stored(engine).status == "ready"
    assert len(_embeddings(engine)) == 1


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
        publish_reference_processing_success(
            receipt, _embedding(), _VERSION, session_factory=_tracked_factory(engine, calls)
        )
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
        publish_reference_processing_success(
            receipt, _embedding(), _VERSION, session_factory=_tracked_factory(engine, calls)
        )
    assert calls == []


def test_nonreceipt_object_is_not_accepted(engine):
    with pytest.raises(ReferenceProcessingClaimValidationError):
        publish_reference_processing_success(
            object(), _embedding(), _VERSION, session_factory=lambda: pytest.fail("factory called")
        )


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
        publish_reference_processing_success(
            receipt, _embedding(), _VERSION, session_factory=factory
        )
    assert events == ["open", "close"]
    assert _stored(engine).status == "processing" and len(_embeddings(engine)) == 0


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
            publish_reference_processing_success(
                receipt, _embedding(), _VERSION, session_factory=factory
            )
    finally:
        if fault == "query":
            event.remove(engine, "before_cursor_execute", fail_select)
    assert events == ["open", "close"]
    assert _stored(engine).status == "processing" and len(_embeddings(engine)) == 0


def test_rollback_fault_propagates_and_leaves_reference_unpublished(engine):
    receipt, events = _receipt(engine), []

    @contextmanager
    def factory():
        session = Session(engine)
        events.append("open")
        event.listen(
            session,
            "after_rollback",
            lambda *_: (_ for _ in ()).throw(RuntimeError("rollback fault")),
        )
        _change(engine, "label_reference_tracks", "status", "ready")
        try:
            yield session
        finally:
            session.close()
            events.append("close")

    with pytest.raises(RuntimeError, match="rollback fault"):
        publish_reference_processing_success(
            receipt, _embedding(), _VERSION, session_factory=factory
        )
    assert events == ["open", "close"]
    row = _stored(engine)
    assert row.status == "ready" and row.processing_claim_token == receipt.processing_claim_token
    assert len(_embeddings(engine)) == 0


def test_close_fault_propagates_instead_of_a_success_return(engine):
    receipt, events = _receipt(engine), []

    @contextmanager
    def factory():
        session = Session(engine)
        events.append("open")
        try:
            yield session
        finally:
            session.close()
            raise RuntimeError("close fault")

    with pytest.raises(RuntimeError, match="close fault"):
        publish_reference_processing_success(
            receipt, _embedding(), _VERSION, session_factory=factory
        )
    assert events == ["open"]
    row = _stored(engine)
    assert row.status == "ready" and row.processing_claim_token is None
    assert len(_embeddings(engine)) == 1


@pytest.mark.parametrize("version", ["", "  ", 3])
def test_invalid_pipeline_version_is_rejected_before_opening_service_session(engine, version):
    calls = []
    with pytest.raises(ReferenceProcessingClaimValidationError):
        publish_reference_processing_success(
            _receipt(engine),
            _embedding(),
            version,
            session_factory=_tracked_factory(engine, calls),
        )
    assert calls == []


def _segment_embedding():
    return SegmentEmbedding(
        metadata=_METADATA, vector=(1.0,) * 512, start_seconds=0.0, end_seconds=1.0
    )


def _impostor_embedding():
    class TrackEmbedding:
        metadata = _METADATA
        vector = (1.0,) * 512
        created_at = _EMBEDDED_AT

    return TrackEmbedding()


def _dimension_768_embedding():
    metadata = EmbeddingMetadata(provider="p", model="m", version="v", dimension=768)
    return TrackEmbedding(metadata=metadata, vector=(1.0,) * 768)


@pytest.mark.parametrize(
    "make_embedding", [_segment_embedding, _impostor_embedding, _dimension_768_embedding]
)
def test_invalid_track_embeddings_are_rejected_before_opening_service_session(
    engine, make_embedding
):
    calls = []
    with pytest.raises(ReferenceProcessingClaimValidationError):
        publish_reference_processing_success(
            _receipt(engine),
            make_embedding(),
            _VERSION,
            session_factory=_tracked_factory(engine, calls),
        )
    assert calls == []


@pytest.mark.parametrize("vector", [(0.0,) * 512, (1.0,) * 511, (float("nan"),) + (1.0,) * 511])
def test_unusable_vectors_never_construct_track_embeddings(vector):
    metadata = EmbeddingMetadata(provider="p", model="m", version="v", dimension=512)
    with pytest.raises(EmbeddingValidationError):
        TrackEmbedding(metadata=metadata, vector=vector)


def test_already_ready_reference_is_not_published_twice(engine):
    receipt = _receipt(engine)
    assert _publish(engine, receipt) is None
    with pytest.raises(ReferenceProcessingClaimConflictError):
        _publish(engine, receipt)
    row = _stored(engine)
    assert row.status == "ready" and row.processing_claim_token is None
    assert len(_embeddings(engine)) == 1
