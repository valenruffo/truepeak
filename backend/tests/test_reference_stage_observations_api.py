"""Standalone HTTP contract tests for provisional staging observations."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.api import reference_catalog as api
from app.ar_matching.reference_stage_observations import (
    ReferenceStageObservationConflictError,
    ReferenceStageObservationNotFoundError,
    ReferenceStageObservationSessionError,
    ReferenceStageObservationValidationError,
)
from app.ar_matching.reference_validation import (
    TypedReferenceValidationError,
    validate_reference_upload,
)
from app.ar_matching.storage_models import LabelReferenceTrack
from app.models import Label
from app.services.reference_r2 import (
    ReferenceR2ConfigurationError,
    ReferenceR2ResponseError,
    StagingObjectVerification,
)
from app.services.reference_r2_factory import ReferenceR2FactoryError

_OWNER = "11111111-1111-4111-8111-111111111111"
_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_REFERENCE = "22222222-2222-4222-8222-222222222222"
_TOKEN = "33333333-3333-4333-8333-333333333333"
_PATH = f"/api/labels/me/reference-uploads/{_REFERENCE}/observe"
_LIMIT = 1024
_OLD = datetime(2000, 1, 1, tzinfo=UTC)


@pytest.fixture
def database():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [Label.__table__, LabelReferenceTrack.__table__]
    SQLModel.metadata.create_all(engine, tables=tables)
    with Session(engine) as session:
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
    _insert_reference(engine)
    try:
        yield engine
    finally:
        SQLModel.metadata.drop_all(engine, tables=list(reversed(tables)))
        engine.dispose()


def _insert_reference(engine, *, owner=_OWNER, reference=_REFERENCE, etag=None):
    upload = validate_reference_upload("reference.wav", 128, _LIMIT)
    row = LabelReferenceTrack(
        id=reference,
        label_id=owner,
        title="Persisted reference",
        status="uploaded",
        is_active=True,
        upload_idempotency_key=_TOKEN,
        upload_filename=upload.filename,
        upload_size_bytes=upload.size_bytes,
        upload_limit_bytes=_LIMIT,
        staging_key=(
            f"label-references/{owner}/{reference}/staging/original{upload.canonical_extension}"
        ),
        staging_etag=etag,
        created_at=_OLD,
        updated_at=_OLD,
    )
    with Session(engine) as session:
        session.add(row)
        session.commit()


def _client(monkeypatch, engine=None, *, tokens=None):
    app = FastAPI()
    app.include_router(api.router)
    calls, closes = [], []
    owners = tokens or {"owner": _OWNER, "other": _OTHER, "cookie": _OWNER}

    def verify(token):
        calls.append(("verify", token))
        if token not in owners:
            raise ValueError("private verifier details")
        return {"label_id": owners[token]}

    def sessions():
        calls.append(("session", None))
        if engine is None:
            raise AssertionError("unexpected session acquisition")
        session = Session(engine)
        try:
            yield session
        finally:
            session.close()
            closes.append(True)

    monkeypatch.setattr(api, "_verify_token", verify)
    monkeypatch.setattr(api, "_get_session", sessions)
    return TestClient(app), calls, closes


def _enable(monkeypatch):
    monkeypatch.setenv("LABEL_DNA_ENABLED", "true")
    monkeypatch.setenv("LABEL_DNA_UPLOADS_ENABLED", "true")


def _result(owner, reference, *, reused=False):
    return SimpleNamespace(
        label_id=owner,
        reference_id=reference,
        status="uploaded",
        observed_etag='"private-etag"',
        reused=reused,
    )


def _failing_observer(error):
    return lambda *_args, **_kwargs: _raise(error)


def _install_adapter(monkeypatch, *, etag='"stage-1"'):
    factories, verifications = [], []

    class Adapter:
        def verify_uploaded_reference(self, owner, reference, upload):
            verifications.append((owner, reference, upload))
            key = (
                f"label-references/{owner}/{reference}/staging/original{upload.canonical_extension}"
            )
            return StagingObjectVerification(key, upload.size_bytes, upload.canonical_mime, etag)

    def factory():
        factories.append(True)
        return Adapter()

    monkeypatch.setattr(api, "_create_reference_staging_adapter", factory)
    return factories, verifications


def test_observe_route_returns_only_provisional_receipt(monkeypatch):
    _enable(monkeypatch)
    client, _, _ = _client(monkeypatch)
    calls = []
    monkeypatch.setattr(
        api,
        "observe_reference_staging",
        lambda owner, reference, **factories: (
            calls.append((owner, reference, factories)) or _result(owner, reference)
        ),
    )
    response = client.post(_PATH, headers={"Authorization": "Bearer owner"})

    assert response.status_code == 200
    assert response.json() == {
        "reference_id": _REFERENCE,
        "status": "uploaded",
        "reused": False,
        "provisional": True,
    }
    assert calls[0][:2] == (_OWNER, _REFERENCE)
    assert set(calls[0][2]) == {"session_factory", "adapter_factory"}


@pytest.mark.parametrize(
    ("dna", "uploads"), [(None, None), ("true", "false"), ("false", "true"), ("yes", "1")]
)
def test_both_flags_gate_before_auth_path_session_or_factory(monkeypatch, dna, uploads):
    if dna is None:
        monkeypatch.delenv("LABEL_DNA_ENABLED", raising=False)
    else:
        monkeypatch.setenv("LABEL_DNA_ENABLED", dna)
    if uploads is None:
        monkeypatch.delenv("LABEL_DNA_UPLOADS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("LABEL_DNA_UPLOADS_ENABLED", uploads)
    client, calls, _ = _client(monkeypatch)
    monkeypatch.setattr(api, "_verify_token", lambda _token: pytest.fail("auth ran"))
    monkeypatch.setattr(api, "_get_session", lambda: pytest.fail("session opened"))
    monkeypatch.setattr(
        api, "_create_reference_staging_adapter", lambda: pytest.fail("factory ran")
    )

    response = client.post(_PATH.replace(_REFERENCE, "not-a-uuid"), content="{")

    assert response.status_code == 404
    assert calls == []


@pytest.mark.parametrize(
    ("token", "headers", "cookies"),
    [
        ("owner", {"Authorization": "Bearer owner", "X-Label-Token": "other"}, {"token": "other"}),
        ("other", {"X-Label-Token": "other"}, {}),
        ("cookie", {}, {"token": "cookie"}),
    ],
)
def test_auth_precedence_and_supported_token_forms(monkeypatch, token, headers, cookies):
    _enable(monkeypatch)
    client, calls, _ = _client(monkeypatch)
    observed = []
    monkeypatch.setattr(
        api,
        "observe_reference_staging",
        lambda owner, reference, **_factories: (
            observed.append((owner, reference)) or _result(owner, reference)
        ),
    )

    response = client.post(_PATH, headers=headers, cookies=cookies)

    expected_owner = _OTHER if token == "other" else _OWNER
    assert response.status_code == 200
    assert calls == [("verify", token)]
    assert observed == [(expected_owner, _REFERENCE)]


def test_selected_invalid_bearer_does_not_fall_through(monkeypatch):
    _enable(monkeypatch)
    client, calls, _ = _client(monkeypatch)

    response = client.post(
        _PATH,
        headers={"Authorization": "Bearer invalid", "X-Label-Token": "owner"},
        cookies={"token": "owner"},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid or expired token."}
    assert calls == [("verify", "invalid")]


@pytest.mark.parametrize(
    ("claim", "path", "expected"), [("bad", _REFERENCE, 401), (_OWNER, "bad", 422)]
)
def test_owner_and_path_uuid_validation_order(monkeypatch, claim, path, expected):
    _enable(monkeypatch)
    client, calls, _ = _client(monkeypatch, tokens={"owner": claim})
    monkeypatch.setattr(
        api, "_create_reference_staging_adapter", lambda: pytest.fail("factory ran")
    )

    response = client.post(
        f"/api/labels/me/reference-uploads/{path}/observe", headers={"X-Label-Token": "owner"}
    )

    assert response.status_code == expected
    assert calls == [("verify", "owner")]


def test_real_service_persists_only_first_observation_and_ignores_caller_data(
    monkeypatch, database
):
    _enable(monkeypatch)
    client, calls, closes = _client(monkeypatch, database)
    factories, verifications = _install_adapter(monkeypatch)

    response = client.post(
        _PATH + "?label_id=" + _OTHER,
        headers={"Authorization": "Bearer owner"},
        json={"label_id": _OTHER, "etag": "attacker-value", "limit": 1},
    )

    assert response.status_code == 200
    assert response.json() == {
        "reference_id": _REFERENCE,
        "status": "uploaded",
        "reused": False,
        "provisional": True,
    }
    assert all(secret not in response.text for secret in (_OWNER, "private-etag", "staging_key"))
    assert calls == [("verify", "owner"), ("session", None), ("session", None)]
    assert len(factories) == len(verifications) == 1
    assert len(closes) == 2
    owner, reference, upload = verifications[0]
    assert (owner, reference, upload.filename, upload.size_bytes) == (
        _OWNER,
        _REFERENCE,
        "reference.wav",
        128,
    )
    with Session(database) as session:
        row = session.get(LabelReferenceTrack, _REFERENCE)
        assert row.staging_etag == '"stage-1"'
        assert row.status == "uploaded" and row.is_active is True
        assert row.storage_key is None and row.final_etag is None
        assert row.updated_at.replace(tzinfo=UTC) > _OLD


def test_reverified_same_etag_reuses_without_update_and_changed_etag_conflicts(
    monkeypatch, database
):
    _enable(monkeypatch)
    client, _calls, closes = _client(monkeypatch, database)
    _factories, verifications = _install_adapter(monkeypatch)
    statements = []
    event.listen(
        database,
        "before_cursor_execute",
        lambda _conn, _cursor, statement, *_args: statements.append(statement),
    )

    first = client.post(_PATH, headers={"X-Label-Token": "owner"})
    with Session(database) as session:
        first_timestamp = session.get(LabelReferenceTrack, _REFERENCE).updated_at
    statements.clear()
    reused = client.post(_PATH, headers={"X-Label-Token": "owner"})

    assert first.status_code == 200 and first.json()["reused"] is False
    assert reused.status_code == 200 and reused.json()["reused"] is True
    assert len(verifications) == 2
    assert not any(sql.lstrip().upper().startswith("UPDATE") for sql in statements)
    with Session(database) as session:
        assert session.get(LabelReferenceTrack, _REFERENCE).updated_at == first_timestamp

    _install_adapter(monkeypatch, etag='"stage-2"')
    changed = client.post(_PATH, headers={"X-Label-Token": "owner"})
    assert changed.status_code == 409
    assert len(closes) == 5
    with Session(database) as session:
        row = session.get(LabelReferenceTrack, _REFERENCE)
        assert row.staging_etag == '"stage-1"' and row.updated_at == first_timestamp
        assert row.status == "uploaded" and row.storage_key is None and row.final_etag is None


def test_wrong_owner_is_not_found_before_adapter_factory(monkeypatch, database):
    _enable(monkeypatch)
    client, _calls, closes = _client(monkeypatch, database)
    monkeypatch.setattr(
        api, "_create_reference_staging_adapter", lambda: pytest.fail("factory ran")
    )

    response = client.post(_PATH, headers={"X-Label-Token": "other"})

    assert response.status_code == 404
    assert closes == [True]


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (ReferenceStageObservationNotFoundError("private"), 404),
        (ReferenceStageObservationConflictError("private"), 409),
        (ReferenceStageObservationSessionError("private"), 409),
        (ReferenceStageObservationValidationError("provider etag private"), 503),
        (TypedReferenceValidationError("bad header private"), 422),
    ],
)
def test_typed_service_errors_are_safely_mapped(monkeypatch, error, status):
    _enable(monkeypatch)
    client, _, _ = _client(monkeypatch)
    monkeypatch.setattr(api, "observe_reference_staging", _failing_observer(error))
    response = client.post(_PATH, headers={"Authorization": "Bearer owner"})

    assert response.status_code == status
    assert "private" not in response.text


@pytest.mark.parametrize(
    "error",
    [
        RuntimeError("POSTGRES_URL environment variable is required"),
        RuntimeError("pgvector is required for PostgreSQL Vector512 storage"),
        OperationalError("SELECT", {}, RuntimeError("no such table: label_reference_tracks")),
    ],
)
def test_known_storage_unavailability_is_redacted(monkeypatch, error):
    _enable(monkeypatch)
    client, _, _ = _client(monkeypatch)
    monkeypatch.setattr(api, "observe_reference_staging", _failing_observer(error))
    response = client.post(_PATH, headers={"Authorization": "Bearer owner"})

    assert response.status_code == 503
    assert "POSTGRES_URL" not in response.text and "no such table" not in response.text


@pytest.mark.parametrize(
    ("error", "factory_failure"),
    [
        (ReferenceR2FactoryError("private SDK setup"), True),
        (ReferenceR2ConfigurationError("private adapter config"), False),
        (ReferenceR2ResponseError("private provider response"), False),
    ],
)
def test_known_adapter_and_factory_errors_are_redacted_and_close_session(
    monkeypatch, database, error, factory_failure
):
    _enable(monkeypatch)
    client, _calls, closes = _client(monkeypatch, database)

    class FailedAdapter:
        def verify_uploaded_reference(self, *_args):
            raise error

    if factory_failure:
        monkeypatch.setattr(api, "_create_reference_staging_adapter", lambda: _raise(error))
    else:
        monkeypatch.setattr(api, "_create_reference_staging_adapter", FailedAdapter)
    response = client.post(_PATH, headers={"Authorization": "Bearer owner"})

    assert response.status_code == 503
    assert str(error) not in response.text
    assert closes == [True]


def _raise(error):
    raise error


def test_sdk_availability_error_is_redacted(monkeypatch, database):
    botocore = pytest.importorskip("botocore.exceptions")
    _enable(monkeypatch)
    client, _calls, closes = _client(monkeypatch, database)

    class FailedAdapter:
        def verify_uploaded_reference(self, *_args):
            raise botocore.BotoCoreError(error_msg="private SDK response")

    monkeypatch.setattr(api, "_create_reference_staging_adapter", FailedAdapter)
    response = client.post(_PATH, headers={"Authorization": "Bearer owner"})

    assert response.status_code == 503
    assert "private SDK response" not in response.text
    assert closes == [True]


def test_unexpected_runtime_error_propagates_after_session_closes(monkeypatch, database):
    _enable(monkeypatch)
    client, _calls, closes = _client(monkeypatch, database)

    def fail_factory():
        raise RuntimeError("unexpected programming failure")

    monkeypatch.setattr(api, "_create_reference_staging_adapter", fail_factory)
    with pytest.raises(RuntimeError, match="unexpected programming failure"):
        client.post(_PATH, headers={"Authorization": "Bearer owner"})
    assert closes == [True]


@pytest.mark.parametrize(
    "error",
    [
        RuntimeError("unexpected programming failure"),
        OperationalError("SELECT", {}, RuntimeError("database broke")),
    ],
)
def test_unexpected_programming_and_sql_errors_propagate(monkeypatch, error):
    _enable(monkeypatch)
    client, _, _ = _client(monkeypatch)
    monkeypatch.setattr(api, "observe_reference_staging", _failing_observer(error))
    with pytest.raises(type(error)):
        client.post(_PATH, headers={"Authorization": "Bearer owner"})
