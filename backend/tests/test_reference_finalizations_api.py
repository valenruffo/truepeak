from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.api import reference_catalog as api
from app.ar_matching.reference_finalizations import (
    ReferenceFinalizationConflictError,
    ReferenceFinalizationNotFoundError,
    ReferenceFinalizationSessionError,
    ReferenceFinalizationValidationError,
)
from app.services import reference_r2_factory
from app.services.reference_r2 import (
    ReferenceR2ConfigurationError,
    ReferenceR2InputError,
)
from app.services.reference_r2_factory import ReferenceR2FactoryError
from app.services.reference_r2_promotion import (
    ReferenceR2PreconditionError,
    ReferenceR2PromotionProviderError,
)

_OWNER = "11111111-1111-4111-8111-111111111111"
_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_REFERENCE = "22222222-2222-4222-8222-222222222222"
_PATH = f"/api/labels/me/reference-uploads/{_REFERENCE}/finalize"


def _client(monkeypatch, *, enable=True, tokens=None):
    if enable:
        monkeypatch.setenv("LABEL_DNA_ENABLED", "true")
        monkeypatch.setenv("LABEL_DNA_UPLOADS_ENABLED", "true")
    calls = []
    owners = tokens or {"owner": _OWNER, "other": _OTHER, "cookie": _OWNER}

    def verify(token):
        calls.append(token)
        try:
            return {"label_id": owners[token]}
        except KeyError:
            raise ValueError("private token details") from None

    monkeypatch.setattr(api, "_verify_token", verify)
    monkeypatch.setattr(api, "_get_session", lambda: pytest.fail("unexpected DB session"))
    monkeypatch.setattr(
        api,
        "_create_reference_promotion_adapter",
        lambda: pytest.fail("unexpected provider construction"),
        raising=False,
    )
    app = FastAPI()
    app.include_router(api.router)
    return TestClient(app), calls


def _receipt(*, status="uploaded", reused=False):
    return SimpleNamespace(
        label_id=_OTHER,
        reference_id=_OTHER,
        status=status,
        reused=reused,
        final_key="private/final/key",
        final_etag="private-etag-secret",
        storage_url="https://private.example.test/object",
        credentials="private-credentials",
    )


def _install_service(monkeypatch, *, result=None, error=None):
    calls = []

    def promote(owner, reference, **kwargs):
        calls.append((owner, reference, kwargs))
        if error is not None:
            raise error
        return result if result is not None else _receipt()

    monkeypatch.setattr(api, "promote_reference_to_final", promote, raising=False)
    return calls


@pytest.mark.parametrize(("dna", "uploads"), [(None, None), ("true", "false"), ("false", "true")])
def test_both_default_off_flags_hide_route_before_auth_or_work(monkeypatch, dna, uploads):
    for name, value in (("LABEL_DNA_ENABLED", dna), ("LABEL_DNA_UPLOADS_ENABLED", uploads)):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    client, calls = _client(monkeypatch, enable=False)
    monkeypatch.setattr(api, "_get_session", lambda: pytest.fail("DB access before gate"))
    monkeypatch.setattr(
        api, "promote_reference_to_final", lambda *_a, **_k: pytest.fail("called"), raising=False
    )

    response = client.post(_PATH.replace(_REFERENCE, "bad-id"), content="{")

    assert response.status_code == 404
    assert calls == []


@pytest.mark.parametrize(
    ("headers", "cookies", "selected", "owner"),
    [
        (
            {"Authorization": "Bearer owner", "X-Label-Token": "other"},
            {"token": "other"},
            "owner",
            _OWNER,
        ),
        ({"X-Label-Token": "other"}, {"token": "cookie"}, "other", _OTHER),
        ({}, {"token": "cookie"}, "cookie", _OWNER),
    ],
)
def test_supported_authentication_precedence(monkeypatch, headers, cookies, selected, owner):
    client, verified = _client(monkeypatch)
    calls = _install_service(monkeypatch)

    response = client.post(_PATH, headers=headers, cookies=cookies)

    assert response.status_code == 201
    assert verified == [selected]
    assert calls[0][:2] == (owner, _REFERENCE)


def test_invalid_selected_bearer_does_not_fall_through(monkeypatch):
    client, verified = _client(monkeypatch)
    monkeypatch.setattr(
        api,
        "promote_reference_to_final",
        lambda *_a, **_k: pytest.fail("service ran"),
        raising=False,
    )

    response = client.post(
        _PATH,
        headers={"Authorization": "Bearer invalid", "X-Label-Token": "owner"},
        cookies={"token": "owner"},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid or expired token."}
    assert verified == ["invalid"]


@pytest.mark.parametrize(
    ("token", "path", "status"), [("uppercase", _REFERENCE, 401), ("owner", "not-a-uuid", 422)]
)
def test_owner_and_path_uuid_validation_precede_service(monkeypatch, token, path, status):
    client, verified = _client(monkeypatch, tokens={"owner": _OWNER, "uppercase": _OTHER.upper()})
    monkeypatch.setattr(
        api,
        "promote_reference_to_final",
        lambda *_a, **_k: pytest.fail("service ran"),
        raising=False,
    )

    response = client.post(
        f"/api/labels/me/reference-uploads/{path}/finalize",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == status
    assert verified == [token]


@pytest.mark.parametrize(
    ("status", "reused", "http_status"),
    [
        ("uploaded", False, 201),
        ("uploaded", True, 200),
        ("processing", True, 200),
        ("ready", True, 200),
        ("failed", True, 200),
    ],
)
def test_recorded_receipt_status_and_reuse_are_minimal_and_trust_path_owner(
    monkeypatch, status, reused, http_status
):
    client, _ = _client(monkeypatch)
    calls = _install_service(monkeypatch, result=_receipt(status=status, reused=reused))
    body = {
        "label_id": _OTHER,
        "reference_id": _OTHER,
        "status": "ready",
        "reused": True,
        "final_key": "body-controlled-secret",
        "storage_url": "https://attacker.example.test",
    }

    response = client.post(_PATH, headers={"Authorization": "Bearer owner"}, json=body)

    assert response.status_code == http_status
    assert response.json() == {"reference_id": _REFERENCE, "status": status, "reused": reused}
    assert set(response.json()) == {"reference_id", "status", "reused"}
    assert calls[0][:2] == (_OWNER, _REFERENCE)


def test_service_receives_lazy_factory_and_api_does_not_construct_it(monkeypatch):
    promotion_factory = api._create_reference_promotion_adapter
    client, _ = _client(monkeypatch)
    monkeypatch.setattr(api, "_create_reference_promotion_adapter", promotion_factory)
    factory_calls = []
    factories = []
    session_factories = []
    monkeypatch.setattr(
        reference_r2_factory,
        "create_private_reference_promotion_adapter",
        lambda: factory_calls.append(True) or object(),
    )

    def retry(owner, reference, *, session_factory, adapter_factory):
        session_factories.append(session_factory)
        factories.append(adapter_factory)
        return _receipt(reused=True)

    monkeypatch.setattr(api, "promote_reference_to_final", retry, raising=False)
    response = client.post(_PATH, headers={"Authorization": "Bearer owner"})

    assert response.status_code == 200
    assert session_factories == [api._observation_session]
    assert len(factories) == 1 and callable(factories[0])
    assert factory_calls == []
    factories[0]()
    assert factory_calls == [True]


def test_session_bridge_closes_each_generator_context(monkeypatch):
    client, _ = _client(monkeypatch)
    events = []
    opened = []

    def sessions():
        events.append("open")
        try:
            session = object()
            opened.append(session)
            yield session
        finally:
            events.append("close")

    def service(_owner, _reference, *, session_factory, adapter_factory):
        with session_factory() as first:
            assert first is opened[0]
        with session_factory() as second:
            assert second is opened[1]
        assert callable(adapter_factory)
        return _receipt()

    monkeypatch.setattr(api, "_get_session", sessions)
    monkeypatch.setattr(api, "promote_reference_to_final", service, raising=False)

    response = client.post(_PATH, headers={"Authorization": "Bearer owner"})

    assert response.status_code == 201
    assert events == ["open", "close", "open", "close"]
    assert opened[0] is not opened[1]


def test_session_bridge_closes_generator_when_service_fails(monkeypatch):
    client, _ = _client(monkeypatch)
    events = []

    def sessions():
        try:
            yield object()
        finally:
            events.append("closed")

    def service(_owner, _reference, *, session_factory, **_kwargs):
        with session_factory():
            pass
        raise ReferenceFinalizationConflictError("private database detail")

    monkeypatch.setattr(api, "_get_session", sessions)
    monkeypatch.setattr(api, "promote_reference_to_final", service, raising=False)

    response = client.post(_PATH, headers={"Authorization": "Bearer owner"})

    assert response.status_code == 409
    assert events == ["closed"]
    assert "private database detail" not in response.text


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (ReferenceFinalizationNotFoundError("private"), 404),
        (ReferenceFinalizationConflictError("private"), 409),
        (ReferenceFinalizationSessionError("private"), 409),
        (ReferenceFinalizationValidationError("private"), 503),
    ],
)
def test_domain_errors_are_mapped_to_safe_http_statuses(monkeypatch, error, status):
    client, _ = _client(monkeypatch)
    _install_service(monkeypatch, error=error)

    response = client.post(_PATH, headers={"Authorization": "Bearer owner"})

    assert response.status_code == status
    assert "private" not in response.text


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (ReferenceR2PreconditionError("provider secret"), 409),
        (ReferenceR2FactoryError("provider secret"), 503),
        (ReferenceR2ConfigurationError("provider secret"), 503),
        (ReferenceR2InputError("provider secret"), 503),
        (ReferenceR2PromotionProviderError("provider secret"), 503),
    ],
)
def test_known_provider_errors_are_safe_and_preconditions_conflict(monkeypatch, error, status):
    client, _ = _client(monkeypatch)
    _install_service(monkeypatch, error=error)

    response = client.post(_PATH, headers={"Authorization": "Bearer owner"})

    assert response.status_code == status
    assert "provider secret" not in response.text


@pytest.mark.parametrize(
    "error",
    [
        OperationalError("SELECT", {}, RuntimeError("database secret")),
        RuntimeError("POSTGRES_URL environment variable is required"),
    ],
)
def test_known_database_availability_errors_are_redacted_503(monkeypatch, error):
    client, _ = _client(monkeypatch)
    _install_service(monkeypatch, error=error)

    response = client.post(_PATH, headers={"Authorization": "Bearer owner"})

    assert response.status_code == 503
    assert "secret" not in response.text


def test_unclassified_service_exception_propagates(monkeypatch):
    client, _ = _client(monkeypatch)
    _install_service(monkeypatch, error=ValueError("unexpected service failure"))

    with pytest.raises(ValueError, match="unexpected service failure"):
        client.post(_PATH, headers={"Authorization": "Bearer owner"})


def test_openapi_exposes_only_the_minimal_finalization_dto(monkeypatch):
    client, _ = _client(monkeypatch)
    schema = client.app.openapi()
    operation = schema["paths"]["/api/labels/me/reference-uploads/{reference_id}/finalize"]["post"]
    response_schema = operation["responses"]["201"]["content"]["application/json"]["schema"]
    dto = schema["components"]["schemas"][response_schema["$ref"].rsplit("/", 1)[1]]

    assert set(dto["properties"]) == {"reference_id", "status", "reused"}
    assert set(dto["properties"]["status"]["enum"]) == {"uploaded", "processing", "ready", "failed"}
    assert "200" in operation["responses"]
