from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from sqlmodel import Session

from app.ar_matching import reference_processing_worker as worker
from app.ar_matching.reference_processing_claims import (
    ReferenceProcessingClaimConflictError,
    claim_reference_processing,
)
from app.ar_matching.reference_processing_resumptions import resume_reference_processing
from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding
from app.audio.embedding.schemas import EmbeddingMetadata, TrackEmbedding

pytest_plugins = ("test_reference_processing_publications",)

_LABEL = "11111111-1111-4111-8111-111111111111"
_REFERENCE = "22222222-2222-4222-8222-222222222222"
_VERSION = "pipeline-v1"
_EMBEDDING = TrackEmbedding(EmbeddingMetadata("test", "fixture", "v1", 512), (1.0,) * 512)


def _claim(engine):
    return claim_reference_processing(_LABEL, _REFERENCE, session_factory=lambda: Session(engine))


def _run(receipt, engine, reader, provider):
    return worker.process_claimed_reference(
        receipt,
        provider=provider,
        original_reader=reader,
        session_factory=lambda: Session(engine),
        pipeline_version=_VERSION,
    )


def test_claimed_work_runs_outside_service_sessions_and_publishes(engine):
    receipt = _claim(engine)
    events = []
    audio = b"exact retained original"
    embedding = _EMBEDDING

    @contextmanager
    def sessions():
        events.append("session-open")
        with Session(engine) as session:
            yield session
        events.append("session-close")

    class Reader:
        def read_original(self, label_id, reference_id, upload, final_etag):
            assert (label_id, reference_id, upload, final_etag) == (
                receipt.label_id,
                receipt.reference_id,
                receipt.upload,
                receipt.final_etag,
            )
            assert events == []
            events.append("read")
            return audio

    class Provider:
        def generate_track_embedding(self, supplied_audio):
            assert supplied_audio is audio
            assert events == ["read"]
            events.append("infer")
            return embedding

    worker.process_claimed_reference(
        receipt,
        provider=Provider(),
        original_reader=Reader(),
        session_factory=sessions,
        pipeline_version=_VERSION,
    )

    assert events == ["read", "infer", "session-open", "session-close"]
    with Session(engine) as session:
        row = session.get(LabelReferenceTrack, _REFERENCE)
        saved = session.query(MusicEmbedding).all()
    assert row.status == "ready" and row.processing_claim_token is None
    assert len(saved) == 1 and saved[0].pipeline_version == _VERSION
    assert saved[0].provider == "test" and saved[0].embedding[0] == pytest.approx(1 / 512**0.5)


@pytest.mark.parametrize("stage", ["read", "infer", "rotated-read"])
def test_computation_errors_fail_once_and_preserve_conflict_evidence(engine, monkeypatch, stage):
    receipt, failure, calls, completions = _claim(engine), RuntimeError(stage), [], []

    def read_original(*_):
        calls.append("read")
        if stage == "rotated-read":
            resume_reference_processing(receipt, session_factory=lambda: Session(engine))
        if stage != "infer":
            raise failure
        return b"audio"

    def infer(_audio):
        calls.append("infer")
        raise failure

    complete = worker.fail_reference_processing

    def tracked_completion(claim, *, session_factory):
        completions.append(claim)
        return complete(claim, session_factory=session_factory)

    monkeypatch.setattr(worker, "fail_reference_processing", tracked_completion)
    monkeypatch.setattr(
        worker,
        "publish_reference_processing_success",
        lambda *_args, **_kwargs: pytest.fail("computation failure must not publish"),
    )
    with pytest.raises(RuntimeError) as raised:
        _run(
            receipt,
            engine,
            SimpleNamespace(read_original=read_original),
            SimpleNamespace(generate_track_embedding=infer),
        )

    assert raised.value is failure and completions == [receipt]
    assert calls == (["read", "infer"] if stage == "infer" else ["read"])
    with Session(engine) as session:
        row = session.get(LabelReferenceTrack, _REFERENCE)
        assert session.query(MusicEmbedding).count() == 0
    if stage == "rotated-read":
        assert isinstance(raised.value.__cause__, ReferenceProcessingClaimConflictError)
        assert (
            row.status == "processing"
            and row.processing_claim_token != receipt.processing_claim_token
        )
    else:
        assert raised.value.__cause__ is None
        assert row.status == "failed" and row.processing_claim_token is None


@pytest.mark.parametrize("outcome", ["stale-conflict", "publication-error"])
def test_publication_errors_never_trigger_failure_completion(engine, monkeypatch, outcome):
    receipt = _claim(engine)
    expected_token = receipt.processing_claim_token
    if outcome == "stale-conflict":
        new_receipt = resume_reference_processing(receipt, session_factory=lambda: Session(engine))
        assert new_receipt.processing_claim_token != receipt.processing_claim_token
        expected = ReferenceProcessingClaimConflictError
        expected_token = new_receipt.processing_claim_token
    else:
        expected = RuntimeError

        def fail_publication(*_args, **_kwargs):
            raise RuntimeError("publication failed")

        monkeypatch.setattr(worker, "publish_reference_processing_success", fail_publication)

    completion_calls, complete = [], worker.fail_reference_processing

    def tracked_completion(*args, **kwargs):
        completion_calls.append(True)
        return complete(*args, **kwargs)

    monkeypatch.setattr(worker, "fail_reference_processing", tracked_completion)
    reader = SimpleNamespace(read_original=lambda *_: b"audio")
    provider = SimpleNamespace(generate_track_embedding=lambda _audio: _EMBEDDING)
    with pytest.raises(expected):
        _run(receipt, engine, reader, provider)

    assert completion_calls == []
    with Session(engine) as session:
        row = session.get(LabelReferenceTrack, _REFERENCE)
        assert row.status == "processing"
        assert row.processing_claim_token == expected_token
        assert session.query(MusicEmbedding).count() == 0
