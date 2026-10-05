"""Standalone HTTP contract tests for reference-upload reservations."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.api import reference_catalog as api
from app.ar_matching.storage_models import LabelReferenceTrack
from app.models import Label, Notification

_OWNER = "abcdefab-cdef-4abc-8def-abcdefabcdef"
_OTHER = "fedcbafe-dcba-4fed-8cba-fedcbafedcba"
_KEY = "01234567-89ab-4cde-8f01-23456789abcd"
_PATH = "/api/labels/me/reference-uploads"
_TABLES = [Label.__table__, Notification.__table__, LabelReferenceTrack.__table__]


@pytest.fixture
def database():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def _foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(engine, tables=_TABLES)
    with Session(engine) as session:
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
    try:
        yield engine
    finally:
        SQLModel.metadata.drop_all(engine, tables=list(reversed(_TABLES)))
        engine.dispose()


def _client(monkeypatch, database=None, *, tokens=None):
    app = FastAPI()
    app.include_router(api.router)
    calls = []
    token_owners = tokens or {"owner": _OWNER, "other": _OTHER}

    def verify(token):
        calls.append(("verify", token))
        if token not in token_owners:
            raise ValueError("private token error")
        return {"label_id": token_owners[token]}

    def sessions():
        calls.append(("session", None))
        if database is None:
            raise AssertionError("database session must not be acquired")
        with Session(database) as session:
            yield session

    monkeypatch.setattr(api, "_verify_token", verify)
    monkeypatch.setattr(api, "_get_session", sessions)
    return TestClient(app), calls


def _enable(monkeypatch):
    monkeypatch.setenv("LABEL_DNA_ENABLED", "true")
    monkeypatch.setenv("LABEL_DNA_UPLOADS_ENABLED", "true")


def _payload(**changes):
    return {
        "title": "  Reference title  ",
        "artist": "  Reference artist  ",
        "filename": "reference.AIF",
        "size_bytes": 128,
        "idempotency_key": _KEY,
        **changes,
    }


def _headers(token="owner"):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize(
    ("dna_flag", "uploads_flag"),
    [(None, None), ("true", None), ("false", "true"), ("true", "false"), ("yes", "1")],
)
@pytest.mark.parametrize("body", [None, "{"])
def test_both_flags_are_required_before_auth_or_body_parsing(
    monkeypatch, dna_flag, uploads_flag, body
):
    if dna_flag is None:
        monkeypatch.delenv("LABEL_DNA_ENABLED", raising=False)
    else:
        monkeypatch.setenv("LABEL_DNA_ENABLED", dna_flag)
    if uploads_flag is None:
        monkeypatch.delenv("LABEL_DNA_UPLOADS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("LABEL_DNA_UPLOADS_ENABLED", uploads_flag)
    client, calls = _client(monkeypatch)
    monkeypatch.setattr(api, "_verify_token", lambda _token: pytest.fail("auth ran"))
    monkeypatch.setattr(api, "_get_session", lambda: pytest.fail("database opened"))

    response = client.post(_PATH, content=body, headers=_headers())

    assert response.status_code == 404
    assert calls == []


def test_auth_precedes_body_parsing_and_selected_invalid_token_does_not_fall_through(
    monkeypatch,
):
    _enable(monkeypatch)
    client, calls = _client(monkeypatch)

    missing = client.post(_PATH, content="{")
    client.cookies.set("token", "owner")
    invalid = client.post(
        _PATH,
        content="{",
        headers={"Authorization": "Bearer invalid", "X-Label-Token": "owner"},
    )
    malformed = client.post(_PATH, content="{", headers={"X-Label-Token": "owner"})

    assert missing.status_code == invalid.status_code == 401
    assert malformed.status_code == 422
    assert invalid.json() == {"detail": "Invalid or expired token."}
    assert calls == [("verify", "invalid"), ("verify", "owner")]


@pytest.mark.parametrize(
    "headers,use_cookie",
    [(_headers(), False), ({"X-Label-Token": "owner"}, False), ({}, True)],
)
def test_bearer_header_and_cookie_authenticate_reservation(
    monkeypatch, database, headers, use_cookie
):
    _enable(monkeypatch)
    client, calls = _client(monkeypatch, database)
    if use_cookie:
        client.cookies.set("token", "owner")

    response = client.post(_PATH, json=_payload(), headers=headers)

    assert response.status_code == 201
    assert calls == [("verify", "owner"), ("session", None)]
    assert response.json()["status"] == "uploaded"


def test_created_and_reused_responses_expose_only_reservation_snapshot(monkeypatch, database):
    _enable(monkeypatch)
    for variable in (
        "AR_EMBEDDING_PROVIDER",
        "AR_EMBEDDING_MODEL",
        "AR_EMBEDDING_VERSION",
        "AR_EMBEDDING_DIMENSION",
        "AR_EMBEDDING_PIPELINE_VERSION",
    ):
        monkeypatch.delenv(variable, raising=False)
    client, _ = _client(monkeypatch, database)

    created = client.post(_PATH, json=_payload(), headers=_headers())
    reused = client.post(
        _PATH,
        json=_payload(title="Reference title", artist="Reference artist"),
        headers=_headers(),
    )

    assert created.status_code == 201
    assert reused.status_code == 200
    assert set(created.json()) == {"reference_id", "reused", "status"}
    assert created.json() == {
        "reference_id": reused.json()["reference_id"],
        "reused": False,
        "status": "uploaded",
    }
    assert reused.json() == {
        "reference_id": created.json()["reference_id"],
        "reused": True,
        "status": "uploaded",
    }
    for private in ("staging_key", "storage_key", "etag", "url", "vector", "limit", "label_id"):
        assert private not in created.text
    with Session(database) as session:
        rows = list(session.execute(select(LabelReferenceTrack)).scalars())
        assert len(rows) == 1
        assert rows[0].title == "Reference title"
        assert rows[0].artist == "Reference artist"
        assert rows[0].upload_limit_bytes == 100 * 1024 * 1024


@pytest.mark.parametrize("stored_status", ["processing", "ready"])
def test_reuse_returns_actual_stored_status_without_claiming_upload_completion(
    monkeypatch, database, stored_status
):
    _enable(monkeypatch)
    client, _ = _client(monkeypatch, database)
    created = client.post(_PATH, json=_payload(), headers=_headers())
    with Session(database) as session:
        row = session.get(LabelReferenceTrack, created.json()["reference_id"])
        row.status = stored_status
        row.staging_etag = '"staging"'
        row.final_etag = '"final"'
        row.storage_key = f"label-references/{_OWNER}/{row.id}/original.aiff"
        session.commit()

    response = client.post(_PATH, json=_payload(), headers=_headers())

    assert response.status_code == 200
    assert response.json() == {
        "reference_id": created.json()["reference_id"],
        "reused": True,
        "status": stored_status,
    }


def test_authenticated_identity_is_exclusive_owner_and_client_ids_are_forbidden(
    monkeypatch, database
):
    _enable(monkeypatch)
    client, _ = _client(monkeypatch, database)

    forged = client.post(
        _PATH,
        json=_payload(label_id=_OTHER),
        headers=_headers(),
    )
    created = client.post(_PATH, json=_payload(), headers=_headers("other"))

    assert forged.status_code == 422
    assert created.status_code == 201
    with Session(database) as session:
        [row] = list(session.execute(select(LabelReferenceTrack)).scalars())
        assert row.label_id == _OTHER


@pytest.mark.parametrize("bad_key", [_KEY.upper(), _KEY.replace("-", ""), "{" + _KEY + "}"])
def test_noncanonical_idempotency_uuid_is_rejected(monkeypatch, database, bad_key):
    _enable(monkeypatch)
    client, _ = _client(monkeypatch, database)

    response = client.post(_PATH, json=_payload(idempotency_key=bad_key), headers=_headers())

    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid reference upload reservation request."}


@pytest.mark.parametrize("bad_size", [True, 1.5, "128", 0, -1])
def test_size_bytes_requires_strict_positive_integer(monkeypatch, database, bad_size):
    _enable(monkeypatch)
    client, _ = _client(monkeypatch, database)

    response = client.post(_PATH, json=_payload(size_bytes=bad_size), headers=_headers())

    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid reference upload reservation request."}


@pytest.mark.parametrize(
    "body",
    [
        [],
        {"title": "Song", "filename": "song.wav", "size_bytes": 1},
        _payload(client_label_id=_OTHER),
        _payload(reference_id=str(uuid4())),
        _payload(storage_key="private/key"),
        _payload(title=True),
        _payload(artist=3),
        _payload(title="Song", filename="song.exe"),
        _payload(title="Song", size_bytes=100 * 1024 * 1024 + 1),
    ],
)
def test_schema_and_service_input_errors_are_generic_422_without_insert(
    monkeypatch, database, body
):
    _enable(monkeypatch)
    client, _ = _client(monkeypatch, database)

    response = client.post(_PATH, json=body, headers=_headers())

    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid reference upload reservation request."}
    with Session(database) as session:
        assert list(session.execute(select(LabelReferenceTrack)).scalars()) == []


def test_same_key_with_different_payload_is_409_and_does_not_overwrite(monkeypatch, database):
    _enable(monkeypatch)
    client, _ = _client(monkeypatch, database)
    created = client.post(_PATH, json=_payload(), headers=_headers())

    conflict = client.post(_PATH, json=_payload(title="Different"), headers=_headers())

    assert created.status_code == 201
    assert conflict.status_code == 409
    assert conflict.json() == {"detail": "Reservation conflicts with an existing request."}
    with Session(database) as session:
        [row] = list(session.execute(select(LabelReferenceTrack)).scalars())
        assert row.id == created.json()["reference_id"] and row.title == "Reference title"


def test_missing_verified_owner_is_404_and_database_config_is_redacted(monkeypatch, database):
    _enable(monkeypatch)
    client, _ = _client(
        monkeypatch,
        database,
        tokens={"owner": "98765432-10fe-4dcb-8fed-9876543210fe"},
    )
    missing = client.post(_PATH, json=_payload(), headers=_headers())
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Label not found."}

    def missing_config():
        raise RuntimeError("POSTGRES_URL environment variable is required")
        yield

    monkeypatch.setattr(api, "_get_session", missing_config)
    unavailable = client.post(_PATH, json=_payload(), headers=_headers())
    assert unavailable.status_code == 503
    assert unavailable.json() == {"detail": "Reference catalog is temporarily unavailable."}
    assert "POSTGRES_URL" not in unavailable.text


def test_missing_reservation_table_is_redacted_but_unrelated_failures_propagate(
    monkeypatch, database
):
    _enable(monkeypatch)
    client, _ = _client(monkeypatch, database)
    SQLModel.metadata.drop_all(database, tables=[LabelReferenceTrack.__table__])

    unavailable = client.post(_PATH, json=_payload(), headers=_headers())
    assert unavailable.status_code == 503
    assert "label_reference_tracks" not in unavailable.text

    def unrelated():
        raise RuntimeError("unrelated programming error")
        yield

    monkeypatch.setattr(api, "_get_session", unrelated)
    with pytest.raises(RuntimeError, match="unrelated programming error"):
        client.post(_PATH, json=_payload(), headers=_headers())


def test_unrelated_sqlalchemy_error_is_not_converted_to_unavailable(monkeypatch, database):
    _enable(monkeypatch)
    client, _ = _client(monkeypatch, database)

    def fail(*_args, **_kwargs):
        raise OperationalError("SELECT", {}, Exception("unrelated constraint"))

    monkeypatch.setattr(api, "reserve_reference_upload", fail)
    with pytest.raises(OperationalError, match="unrelated constraint"):
        client.post(_PATH, json=_payload(), headers=_headers())


@pytest.mark.parametrize("content", [None, "{not-json"])
def test_missing_or_malformed_json_is_generic_422(monkeypatch, content):
    _enable(monkeypatch)
    client, _ = _client(monkeypatch)

    response = client.post(_PATH, content=content, headers=_headers())

    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid reference upload reservation request."}
    assert "not-json" not in response.text


def test_openapi_documents_only_supported_request_fields_and_safe_response(monkeypatch):
    _enable(monkeypatch)
    client, _ = _client(monkeypatch)

    operation = client.get("/openapi.json").json()["paths"][_PATH]["post"]
    schema = operation["requestBody"]["content"]["application/json"]["schema"]

    assert set(schema["properties"]) == {
        "title",
        "artist",
        "filename",
        "size_bytes",
        "idempotency_key",
    }
    assert schema["additionalProperties"] is False
    assert (
        operation["responses"]["200"]["content"]["application/json"]["schema"]
        == operation["responses"]["201"]["content"]["application/json"]["schema"]
    )
