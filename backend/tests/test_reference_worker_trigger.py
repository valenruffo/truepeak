"""Offline tests: reference finalization schedules fenced in-process processing."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api import reference_catalog as api
from app.ar_matching.reference_processing_claims import claim_reference_processing
from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding
from app.audio.embedding.openl3_provider import OpenL3EmbeddingProvider
from app.audio.embedding.schemas import EmbeddingMetadata, EmbeddingProviderError, TrackEmbedding
from app.models import Label, Submission
from app.services import reference_r2_promotion
from app.services import reference_worker_runtime as runtime

_OWNER = "11111111-1111-4111-8111-111111111111"
_REFERENCE = "22222222-2222-4222-8222-222222222222"
_TOKEN = "33333333-3333-4333-8333-333333333333"
_LIMIT = 1024
_STAGING_ETAG = '"Opaque-Stage-Tag"'
_FINAL_ETAG = '"Opaque-Final-Tag"'
_PATH = f"/api/labels/me/reference-uploads/{_REFERENCE}/finalize"
_METADATA = EmbeddingMetadata(provider="stub", model="stub-model", version="stub-v1", dimension=512)


@pytest.fixture(autouse=True)
def _fresh_runtime(monkeypatch):
    monkeypatch.setattr(runtime, "_PROVIDER", None, raising=False)
    monkeypatch.setattr(runtime, "_READER", None, raising=False)


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

    tables = [
        Label.__table__,
        Submission.__table__,
        LabelReferenceTrack.__table__,
        MusicEmbedding.__table__,
    ]
    SQLModel.metadata.create_all(test_engine, tables=tables)
    with Session(test_engine) as session:
        session.add(
            Label(
                id=_OWNER,
                name="Owner",
                slug=f"owner-{uuid4()}",
                owner_email=f"{uuid4()}@example.test",
            )
        )
        session.commit()
    with Session(test_engine) as session:
        session.add(_reference())
        session.commit()
    try:
        yield test_engine
    finally:
        SQLModel.metadata.drop_all(test_engine, tables=list(reversed(tables)))
        test_engine.dispose()


def _reference():
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
    )


def _row(engine):
    with Session(engine) as session:
        return session.exec(
            select(LabelReferenceTrack).where(LabelReferenceTrack.id == _REFERENCE)
        ).one()


def _mutate(engine, **changes):
    with Session(engine) as session:
        row = session.exec(
            select(LabelReferenceTrack).where(LabelReferenceTrack.id == _REFERENCE)
        ).one()
        for name, value in changes.items():
            setattr(row, name, value)
        session.add(row)
        session.commit()


def _embeddings(engine):
    with Session(engine) as session:
        return session.exec(
            select(MusicEmbedding).where(MusicEmbedding.reference_track_id == _REFERENCE)
        ).all()


class _StubAdapter:
    def promote(self, owner, reference, upload, staging_etag):
        final_key = f"label-references/{owner}/{reference}/original.wav"
        return reference_r2_promotion.FinalReferencePromotion(final_key, _FINAL_ETAG)


class _StubProvider:
    def __init__(self, error=None):
        self.audio = []
        self.error = error

    def generate_track_embedding(self, audio):
        self.audio.append(audio)
        if self.error is not None:
            raise self.error
        return TrackEmbedding(_METADATA, tuple(float(index % 7) for index in range(512)))


class _StubReader:
    def __init__(self):
        self.calls = []

    def read_original(self, label_id, reference_id, upload, final_etag):
        self.calls.append((label_id, reference_id, final_etag))
        return b"stub-audio-bytes"


def _client(monkeypatch, engine, *, stub_runtime=True, provider=None, reader=None):
    monkeypatch.setattr(
        runtime.os,
        "environ",
        {"LABEL_DNA_ENABLED": "true", "LABEL_DNA_UPLOADS_ENABLED": "true"},
    )
    monkeypatch.setattr(api, "_verify_token", lambda _token: {"label_id": _OWNER})

    def sessions():
        session = Session(engine)
        try:
            yield session
        finally:
            session.close()

    monkeypatch.setattr(api, "_get_session", sessions)
    monkeypatch.setattr(api, "_create_reference_promotion_adapter", lambda: _StubAdapter())
    if stub_runtime:
        monkeypatch.setattr(runtime, "runtime_provider", lambda: provider)
        monkeypatch.setattr(runtime, "runtime_original_reader", lambda: reader)
    app = FastAPI()
    app.include_router(api.router)
    return TestClient(app)


def test_finalize_processes_claimed_reference_to_ready_with_one_embedding(monkeypatch, engine):
    provider, reader = _StubProvider(), _StubReader()
    client = _client(monkeypatch, engine, provider=provider, reader=reader)

    response = client.post(_PATH, headers={"Authorization": "Bearer owner"})

    assert response.status_code == 201
    assert response.json() == {"reference_id": _REFERENCE, "status": "uploaded", "reused": False}
    row = _row(engine)
    assert row.status == "ready"
    assert row.processing_claim_token is None
    assert provider.audio == [b"stub-audio-bytes"]
    assert reader.calls == [(_OWNER, _REFERENCE, _FINAL_ETAG)]
    stored = _embeddings(engine)
    assert len(stored) == 1
    assert stored[0].pipeline_version == runtime.PIPELINE_VERSION
    assert stored[0].dimension == 512


def test_provider_failure_completes_reference_as_failed(monkeypatch, engine):
    provider = _StubProvider(error=EmbeddingProviderError("inference unavailable"))
    client = _client(monkeypatch, engine, provider=provider, reader=_StubReader())

    assert client.post(_PATH, headers={"Authorization": "Bearer owner"}).status_code == 201

    row = _row(engine)
    assert row.status == "failed"
    assert row.processing_claim_token is None
    assert provider.audio == [b"stub-audio-bytes"]
    assert _embeddings(engine) == []


def test_pre_rotated_claim_conflict_skips_processing_without_touching_original(engine):
    _mutate(
        engine,
        storage_key=f"label-references/{_OWNER}/{_REFERENCE}/original.wav",
        final_etag=_FINAL_ETAG,
    )
    claim = claim_reference_processing(_OWNER, _REFERENCE, session_factory=lambda: Session(engine))
    provider, reader = _StubProvider(), _StubReader()

    runtime.process_finalized_reference(_OWNER, _REFERENCE, lambda: Session(engine))

    row = _row(engine)
    assert row.status == "processing"
    assert row.processing_claim_token == claim.processing_claim_token
    assert provider.audio == [] and reader.calls == []
    assert _embeddings(engine) == []


def test_misconfigured_runtime_finalizes_without_claiming_processing(monkeypatch, engine):
    client = _client(monkeypatch, engine, stub_runtime=False)

    assert client.post(_PATH, headers={"Authorization": "Bearer owner"}).status_code == 201

    assert _row(engine).status == "uploaded"
    assert _embeddings(engine) == []


def test_runtime_singletons_are_lazy_cached_and_env_overridable(monkeypatch):
    monkeypatch.setattr(
        runtime.os,
        "environ",
        {"LABEL_REFERENCE_MAX_DECODED_FRAMES": "100", "LABEL_REFERENCE_MAX_DECODED_CHANNELS": "1"},
    )

    provider = runtime.runtime_provider()

    assert isinstance(provider, OpenL3EmbeddingProvider)
    assert provider.max_decoded_frames == 100
    assert provider.max_channels == 1
    assert provider is runtime.runtime_provider()
    assert runtime._DEFAULT_MAX_DECODED_FRAMES == 8_640_000
    assert runtime._DEFAULT_MAX_DECODED_CHANNELS == 2
    constructions = []

    def fake_reader(**_kwargs):
        constructions.append(1)
        return object()

    monkeypatch.setattr(runtime, "create_private_reference_original_reader", fake_reader)
    reader = runtime.runtime_original_reader()
    assert reader is runtime.runtime_original_reader()
    assert constructions == [1]
