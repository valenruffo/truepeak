"""Standalone HTTP tests for owner-authorized, provisional staging PUT URLs."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.api import reference_catalog as api
from app.ar_matching.reference_validation import validate_reference_upload
from app.ar_matching.storage_models import LabelReferenceTrack
from app.models import Label
from app.services.reference_r2 import (
    ReferenceR2ConfigurationError,
    ReferenceR2ResponseError,
    StagingPresignedPut,
)
from app.services.reference_r2_factory import ReferenceR2FactoryError

_OWNER = "11111111-1111-4111-8111-111111111111"
_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_REFERENCE = "22222222-2222-4222-8222-222222222222"
_OTHER_REFERENCE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
_IDEMPOTENCY = "33333333-3333-4333-8333-333333333333"
_BASE = "/api/labels/me/reference-uploads"
_PATH = f"{_BASE}/{_REFERENCE}/presign"
_LIMIT = 1024


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

    tables = [Label.__table__, LabelReferenceTrack.__table__]
    SQLModel.metadata.create_all(engine, tables=tables)
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
        SQLModel.metadata.drop_all(engine, tables=list(reversed(tables)))
        engine.dispose()


def _staging_key(owner=_OWNER, reference=_REFERENCE, filename="reference.wav"):
    upload = validate_reference_upload(filename, 128, max_size_bytes=_LIMIT)
    return f"label-references/{owner}/{reference}/staging/original{upload.canonical_extension}"


def _insert_reference(
    engine,
    *,
    owner=_OWNER,
    reference=_REFERENCE,
    status="uploaded",
    active=True,
    filename="reference.wav",
):
    final_identity = {}
    if status in {"processing", "ready"}:
        final_identity = {
            "storage_key": f"label-references/{owner}/{reference}/original"
            f"{validate_reference_upload(filename, 128, _LIMIT).canonical_extension}",
            "staging_etag": '"observed-staging"',
            "final_etag": '"observed-final"',
        }
    row = LabelReferenceTrack(
        id=reference,
        label_id=owner,
        title="Persisted title",
        artist="Persisted artist",
        status=status,
        is_active=active,
        upload_idempotency_key=_IDEMPOTENCY,
        upload_filename=filename,
        upload_size_bytes=128,
        upload_limit_bytes=_LIMIT,
        staging_key=_staging_key(owner, reference, filename),
        **final_identity,
    )
    reference_id = row.id
    with Session(engine) as session:
        session.add(row)
        session.commit()
    return reference_id


def _corrupt_row(engine, **changes):
    allowed = {
        "upload_idempotency_key",
        "upload_filename",
        "upload_size_bytes",
        "upload_limit_bytes",
        "staging_key",
        "staging_etag",
        "storage_key",
        "final_etag",
    }
    assert set(changes) <= allowed
    assignments = ", ".join(f"{name} = :{name}" for name in changes)
    with Session(engine) as session:
        session.execute(text("PRAGMA ignore_check_constraints = ON"))
        session.execute(
            text(f"UPDATE label_reference_tracks SET {assignments} WHERE id = :identity"),
            {**changes, "identity": _REFERENCE},
        )
        session.commit()


def _enable(monkeypatch):
    monkeypatch.setenv("LABEL_DNA_ENABLED", "true")
    monkeypatch.setenv("LABEL_DNA_UPLOADS_ENABLED", "true")


def _client(monkeypatch, engine, *, tokens=None):
    app = FastAPI()
    app.include_router(api.router)
    calls = []
    closes = []
    token_owners = tokens or {"owner": _OWNER, "other": _OTHER}

    def verify(token):
        calls.append(("verify", token))
        return {"label_id": token_owners[token]}

    def sessions():
        calls.append(("session", None))
        with Session(engine) as session:
            original_close = session.close

            def close():
                closes.append(True)
                original_close()

            session.close = close
            yield session

    monkeypatch.setattr(api, "_verify_token", verify)
    monkeypatch.setattr(api, "_get_session", sessions)
    return TestClient(app), calls, closes


def _headers(token="owner"):
    return {"Authorization": f"Bearer {token}"}


def _install_signer(monkeypatch, *, error=None, factory_error=None):
    calls = []

    class FakeAdapter:
        def presign_put(self, owner, reference, upload, **kwargs):
            calls.append(((owner, reference, upload), kwargs))
            if error is not None:
                raise error
            key = (
                f"label-references/{owner}/{reference}/staging/original{upload.canonical_extension}"
            )
            return StagingPresignedPut(
                url="https://signed.example.test/private/object?signature=fake",
                key=key,
                required_headers=(
                    ("Content-Length", str(upload.size_bytes)),
                    ("Content-Type", upload.canonical_mime),
                ),
                expires_in_seconds=900,
            )

    factories = []

    def factory():
        factories.append(True)
        if factory_error is not None:
            raise factory_error
        return FakeAdapter()

    monkeypatch.setattr(api, "_create_reference_staging_adapter", factory, raising=False)
    return factories, calls


@pytest.mark.parametrize(
    ("dna_flag", "uploads_flag"),
    [(None, None), ("false", "true"), ("true", "false"), ("yes", "1")],
)
def test_both_default_off_flags_gate_before_auth_session_or_factory(
    monkeypatch, database, dna_flag, uploads_flag
):
    if dna_flag is None:
        monkeypatch.delenv("LABEL_DNA_ENABLED", raising=False)
    else:
        monkeypatch.setenv("LABEL_DNA_ENABLED", dna_flag)
    if uploads_flag is None:
        monkeypatch.delenv("LABEL_DNA_UPLOADS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("LABEL_DNA_UPLOADS_ENABLED", uploads_flag)
    client, calls, _ = _client(monkeypatch, database)
    monkeypatch.setattr(api, "_verify_token", lambda _token: pytest.fail("auth ran"))
    monkeypatch.setattr(api, "_get_session", lambda: pytest.fail("session opened"))
    monkeypatch.setattr(
        api,
        "_create_reference_staging_adapter",
        lambda: pytest.fail("factory ran"),
        raising=False,
    )

    response = client.post(_PATH, headers=_headers())

    assert response.status_code == 404
    assert calls == []


def test_auth_precedence_and_owner_scope_select_only_verified_identity(monkeypatch, database):
    _enable(monkeypatch)
    _insert_reference(database)
    _insert_reference(database, owner=_OTHER, reference=_OTHER_REFERENCE)
    client, calls, _ = _client(monkeypatch, database)
    factories, signatures = _install_signer(monkeypatch)
    requests = [
        (
            {"Authorization": "Bearer owner", "X-Label-Token": "other"},
            {"token": "other"},
            _REFERENCE,
        ),
        ({"X-Label-Token": "other"}, {}, _OTHER_REFERENCE),
        ({}, {"token": "owner"}, _REFERENCE),
    ]

    responses = []
    for headers, cookies, expected_id in requests:
        response = client.post(f"{_BASE}/{expected_id}/presign", headers=headers, cookies=cookies)
        responses.append((response, expected_id))

    assert all(response.status_code == 200 for response, _ in responses)
    assert [response.json()["reference_id"] for response, _ in responses] == [
        expected for _, expected in responses
    ]
    assert calls == [
        ("verify", "owner"),
        ("session", None),
        ("verify", "other"),
        ("session", None),
        ("verify", "owner"),
        ("session", None),
    ]
    assert len(factories) == len(signatures) == 3


def test_authentication_precedes_path_validation_and_invalid_selected_token_does_not_fall_through(
    monkeypatch, database
):
    _enable(monkeypatch)
    client, calls, _ = _client(monkeypatch, database)
    missing = client.post(f"{_BASE}/not-a-uuid/presign")
    invalid = client.post(
        f"{_BASE}/NOT-A-UUID/presign",
        headers={"Authorization": "Bearer bad", "X-Label-Token": "owner"},
    )
    malformed = client.post(f"{_BASE}/not-a-uuid/presign", headers=_headers())

    assert missing.status_code == invalid.status_code == 401
    assert malformed.status_code == 422
    assert calls == [("verify", "bad"), ("verify", "owner")]


@pytest.mark.parametrize(
    "bad_reference",
    [_OTHER.upper(), _REFERENCE.replace("-", ""), "{" + _REFERENCE + "}"],
)
def test_noncanonical_path_uuid_is_422_after_auth_without_session_or_factory(
    monkeypatch, database, bad_reference
):
    _enable(monkeypatch)
    client, calls, _ = _client(monkeypatch, database)
    monkeypatch.setattr(
        api,
        "_create_reference_staging_adapter",
        lambda: pytest.fail("factory ran"),
        raising=False,
    )

    response = client.post(f"{_BASE}/{bad_reference}/presign", headers=_headers())

    assert response.status_code == 422
    assert calls == [("verify", "owner")]


@pytest.mark.parametrize("case", ["missing", "cross-owner", "inactive"])
def test_missing_cross_owner_and_inactive_are_uniform_404_without_signing(
    monkeypatch, database, case
):
    _enable(monkeypatch)
    if case == "cross-owner":
        _insert_reference(database, owner=_OTHER)
    elif case == "inactive":
        _insert_reference(database, active=False)
    client, _, _ = _client(monkeypatch, database)
    factories, signatures = _install_signer(monkeypatch)

    response = client.post(_PATH, headers=_headers())

    assert response.status_code == 404
    assert response.json() == {"detail": "Reference not found."}
    assert factories == signatures == []


def test_corrupt_persisted_owner_uuid_is_not_normalized_into_signing(monkeypatch, database):
    _enable(monkeypatch)
    owner = "owner-without-canonical-uuid"
    with Session(database) as session:
        session.add(
            Label(
                id=owner,
                name="Corrupt owner",
                slug=f"corrupt-owner-{uuid4()}",
                owner_email=f"{uuid4()}@example.test",
            )
        )
        session.commit()
    _insert_reference(database, owner=owner)
    client, _, _ = _client(monkeypatch, database, tokens={"corrupt": owner})
    factories, signatures = _install_signer(monkeypatch)

    response = client.post(_PATH, headers=_headers("corrupt"))

    assert response.status_code == 409
    assert factories == signatures == []


@pytest.mark.parametrize("status", ["processing", "ready", "failed"])
def test_non_uploaded_owned_status_conflicts_without_signing(monkeypatch, database, status):
    _enable(monkeypatch)
    _insert_reference(database, status=status)
    client, _, _ = _client(monkeypatch, database)
    factories, signatures = _install_signer(monkeypatch)

    response = client.post(_PATH, headers=_headers())

    assert response.status_code == 409
    assert factories == signatures == []


def test_legacy_upload_identity_is_ineligible(monkeypatch, database):
    _enable(monkeypatch)
    with Session(database) as session:
        session.add(
            LabelReferenceTrack(
                id=_REFERENCE,
                label_id=_OWNER,
                title="Legacy",
                status="uploaded",
                is_active=True,
            )
        )
        session.commit()
    client, _, _ = _client(monkeypatch, database)
    factories, signatures = _install_signer(monkeypatch)

    response = client.post(_PATH, headers=_headers())

    assert response.status_code == 409
    assert factories == signatures == []


@pytest.mark.parametrize(
    "field",
    [
        "upload_idempotency_key",
        "upload_filename",
        "upload_size_bytes",
        "upload_limit_bytes",
        "staging_key",
    ],
)
def test_partial_reservation_identity_is_ineligible(monkeypatch, database, field):
    _enable(monkeypatch)
    _insert_reference(database)
    _corrupt_row(database, **{field: None})
    client, _, _ = _client(monkeypatch, database)
    factories, signatures = _install_signer(monkeypatch)

    response = client.post(_PATH, headers=_headers())

    assert response.status_code == 409
    assert factories == signatures == []


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("upload_filename", "track.mp3"),
        ("upload_filename", "../track.wav"),
        ("upload_size_bytes", 0),
        ("upload_size_bytes", 2048),
        ("upload_size_bytes", 128.5),
        ("upload_limit_bytes", 0),
        ("upload_limit_bytes", 209_715_201),
        ("upload_limit_bytes", 1024.5),
        ("upload_idempotency_key", "abcdefab-cdef-4abc-8def-abcdefabcdef".upper()),
        ("upload_idempotency_key", _IDEMPOTENCY.replace("-", "")),
        ("staging_key", "label-references/other/key/staging/original.wav"),
    ],
)
def test_corrupt_persisted_descriptor_identity_is_ineligible(monkeypatch, database, field, value):
    _enable(monkeypatch)
    _insert_reference(database)
    _corrupt_row(database, **{field: value})
    client, _, _ = _client(monkeypatch, database)
    factories, signatures = _install_signer(monkeypatch)

    response = client.post(_PATH, headers=_headers())

    assert response.status_code == 409
    assert factories == signatures == []


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("staging_etag", '"observed"'),
        ("storage_key", f"label-references/{_OWNER}/{_REFERENCE}/original.wav"),
        ("final_etag", '"final"'),
    ],
)
def test_observed_staging_or_final_identity_prevents_new_signing(
    monkeypatch, database, field, value
):
    _enable(monkeypatch)
    _insert_reference(database)
    _corrupt_row(database, **{field: value})
    client, _, _ = _client(monkeypatch, database)
    factories, signatures = _install_signer(monkeypatch)

    response = client.post(_PATH, headers=_headers())

    assert response.status_code == 409
    assert factories == signatures == []


@pytest.mark.parametrize("state", ["pending", "dirty", "transaction"])
def test_nonfresh_injected_sessions_are_rejected_without_autoflush(monkeypatch, database, state):
    _enable(monkeypatch)
    _insert_reference(database)
    session = Session(database, autoflush=True)
    if state == "pending":
        session.add(
            LabelReferenceTrack(
                id=str(uuid4()), label_id=_OWNER, title="Pending", status="uploaded"
            )
        )
    elif state == "dirty":
        persisted = session.get(LabelReferenceTrack, _REFERENCE)
        persisted.title = "Dirty in memory"
    else:
        session.execute(text("SELECT 1"))
    flushes = []
    closed = []
    event.listen(session, "before_flush", lambda *_args: flushes.append(True))

    def injected_session():
        try:
            yield session
        finally:
            closed.append(True)

    client, _, _ = _client(monkeypatch, database)
    monkeypatch.setattr(api, "_get_session", injected_session)
    factories, signatures = _install_signer(monkeypatch)

    response = client.post(_PATH, headers=_headers())

    assert response.status_code == 409
    assert flushes == []
    assert closed == [True]
    assert factories == signatures == []
    session.rollback()
    session.close()


def test_success_is_minimal_and_signs_only_database_identity_with_fixed_expiry(
    monkeypatch, database
):
    _enable(monkeypatch)
    _insert_reference(database, filename="Persisted.AIF")
    client, _, closes = _client(monkeypatch, database)
    factories, signatures = _install_signer(monkeypatch)
    hostile = {
        "label_id": _OTHER,
        "filename": "client.mp3",
        "size_bytes": 1,
        "limit_bytes": 1,
        "bucket": "public",
        "storage_key": "attacker/key",
        "expires_in_seconds": 1,
    }

    response = client.post(
        f"{_PATH}?label_id={_OTHER}&reference_id={_OTHER_REFERENCE}",
        json=hostile,
        headers=_headers(),
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"reference_id", "url", "method", "required_headers", "expires_in_seconds"}
    assert body == {
        "reference_id": _REFERENCE,
        "url": "https://signed.example.test/private/object?signature=fake",
        "method": "PUT",
        "required_headers": {"Content-Length": "128", "Content-Type": "audio/aiff"},
        "expires_in_seconds": 900,
    }
    assert factories == [True]
    assert signatures == [
        (
            (_OWNER, _REFERENCE, validate_reference_upload("Persisted.AIF", 128, _LIMIT)),
            {"expires_in_seconds": 900},
        )
    ]
    assert closes == [True]
    with Session(database) as session:
        persisted = session.get(LabelReferenceTrack, _REFERENCE)
        assert persisted.status == "uploaded"
        assert persisted.staging_etag is None and persisted.storage_key is None
        assert persisted.final_etag is None


def test_empty_body_is_accepted_and_url_does_not_claim_object_completion(monkeypatch, database):
    _enable(monkeypatch)
    _insert_reference(database)
    client, _, _ = _client(monkeypatch, database)
    _install_signer(monkeypatch)

    response = client.post(_PATH, headers=_headers())

    assert response.status_code == 200
    assert response.json()["method"] == "PUT"
    assert "status" not in response.json() and "complete" not in response.json()


@pytest.mark.parametrize(
    "error",
    [
        ReferenceR2FactoryError("private factory detail"),
        ReferenceR2ConfigurationError("private configuration detail"),
    ],
)
def test_factory_availability_errors_are_redacted_503(monkeypatch, database, error):
    _enable(monkeypatch)
    _insert_reference(database)
    client, _, closes = _client(monkeypatch, database)
    factories, signatures = _install_signer(monkeypatch, factory_error=error)

    response = client.post(_PATH, headers=_headers())

    assert response.status_code == 503
    assert response.json() == {"detail": "Reference upload signing is temporarily unavailable."}
    assert "private" not in response.text
    assert closes == [True]
    assert signatures == []
    assert factories == [True]


def test_adapter_response_and_known_sdk_signing_errors_are_redacted(monkeypatch, database):
    _enable(monkeypatch)
    _insert_reference(database)
    client, _, _ = _client(monkeypatch, database)
    factories, signatures = _install_signer(
        monkeypatch, error=ReferenceR2ResponseError("private SDK response")
    )

    response = client.post(_PATH, headers=_headers())

    assert response.status_code == 503
    assert "private SDK response" not in response.text
    assert factories == [True]
    assert len(signatures) == 1


def test_known_database_configuration_and_missing_table_are_redacted(monkeypatch, database):
    _enable(monkeypatch)
    _insert_reference(database)
    client, _, _ = _client(monkeypatch, database)

    def missing_config():
        raise RuntimeError("POSTGRES_URL environment variable is required")
        yield

    monkeypatch.setattr(api, "_get_session", missing_config)
    configured = client.post(_PATH, headers=_headers())
    assert configured.status_code == 503
    assert "POSTGRES_URL" not in configured.text

    def missing_vector_adapter():
        raise RuntimeError("pgvector is required for PostgreSQL Vector512 storage")
        yield

    monkeypatch.setattr(api, "_get_session", missing_vector_adapter)
    vector = client.post(_PATH, headers=_headers())
    assert vector.status_code == 503
    assert "pgvector" not in vector.text

    with Session(database) as session:
        session.execute(text("DROP TABLE label_reference_tracks"))
        session.commit()
    monkeypatch.setattr(api, "_get_session", lambda: _new_session(database))
    missing_table = client.post(_PATH, headers=_headers())
    assert missing_table.status_code == 503
    assert "label_reference_tracks" not in missing_table.text


def test_actual_sdk_client_error_is_redacted_without_constructing_a_client(monkeypatch, database):
    sdk_errors = pytest.importorskip("botocore.exceptions")
    _enable(monkeypatch)
    _insert_reference(database)
    client, _, _ = _client(monkeypatch, database)
    factories, signatures = _install_signer(
        monkeypatch,
        error=sdk_errors.ClientError(
            {"Error": {"Code": "AccessDenied", "Message": "private provider detail"}},
            "GeneratePresignedUrl",
        ),
    )

    response = client.post(_PATH, headers=_headers())

    assert response.status_code == 503
    assert "private provider detail" not in response.text
    assert factories == [True]
    assert len(signatures) == 1


def _new_session(engine):
    with Session(engine) as session:
        yield session


def test_unrelated_factory_and_signer_errors_propagate(monkeypatch, database):
    _enable(monkeypatch)
    _insert_reference(database)
    client, _, _ = _client(monkeypatch, database)
    monkeypatch.setattr(
        api,
        "_create_reference_staging_adapter",
        lambda: (_ for _ in ()).throw(RuntimeError("unexpected factory bug")),
        raising=False,
    )
    with pytest.raises(RuntimeError, match="unexpected factory bug"):
        client.post(_PATH, headers=_headers())

    _install_signer(monkeypatch, error=ValueError("unexpected signer bug"))
    with pytest.raises(ValueError, match="unexpected signer bug"):
        client.post(_PATH, headers=_headers())


def test_unrelated_sqlalchemy_failures_propagate(monkeypatch, database):
    _enable(monkeypatch)
    _insert_reference(database)
    client, _, _ = _client(monkeypatch, database)

    def fail_query(_connection, _cursor, statement, _parameters, _context, _many):
        if "label_reference_tracks" in statement:
            raise OperationalError(statement, {}, RuntimeError("unrelated SQL failure"))

    event.listen(database, "before_cursor_execute", fail_query)
    try:
        with pytest.raises(OperationalError, match="unrelated SQL failure"):
            client.post(_PATH, headers=_headers())
    finally:
        event.remove(database, "before_cursor_execute", fail_query)


def test_openapi_keeps_reference_id_as_string_and_declares_no_request_body(monkeypatch, database):
    _enable(monkeypatch)
    client, _, _ = _client(monkeypatch, database)

    operation = client.get("/openapi.json").json()["paths"][f"{_BASE}/{{reference_id}}/presign"][
        "post"
    ]

    assert "requestBody" not in operation
    path_parameter = next(item for item in operation["parameters"] if item["in"] == "path")
    assert path_parameter["schema"]["type"] == "string"
