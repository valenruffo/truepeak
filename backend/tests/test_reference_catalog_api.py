"""Standalone read-only API tests with explicit SQLite storage fixtures."""

from __future__ import annotations

import ast
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import ModuleType
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api import reference_catalog as api
from app.ar_matching.storage_models import (
    LabelArDecisionRow,
    LabelReferenceTrack,
    MusicEmbedding,
)
from app.models import Label, Submission

_TABLES = [
    Label.__table__,
    Submission.__table__,
    LabelReferenceTrack.__table__,
    MusicEmbedding.__table__,
]
_VECTOR = [3.0, 4.0, *([0.0] * 510)]


def _engine(tables=_TABLES):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(engine, tables=tables)
    return engine


@pytest.fixture
def engine():
    value = _engine()
    yield value
    SQLModel.metadata.drop_all(value, tables=_TABLES)
    value.dispose()


def _label(session: Session, name: str) -> Label:
    identity = str(uuid4())
    label = Label(
        id=identity,
        name=name,
        slug=f"{name.lower().replace(' ', '-')}-{identity}",
        owner_email=f"{identity}@example.test",
    )
    session.add(label)
    session.flush()
    return label


def _reference(
    session: Session,
    label: Label,
    *,
    title: str = "Reference",
    active: bool = True,
    status: str = "ready",
) -> LabelReferenceTrack:
    reference = LabelReferenceTrack(
        label_id=label.id,
        title=title,
        artist="Test artist",
        storage_key="private/reference/object.wav",
        status=status,
        is_active=active,
        created_at=datetime(2025, 1, 1, tzinfo=UTC),
        updated_at=datetime(2025, 1, 2, tzinfo=UTC),
    )
    session.add(reference)
    session.flush()
    return reference


def _embedding(session: Session, label: Label, reference: LabelReferenceTrack) -> MusicEmbedding:
    embedding = MusicEmbedding(
        label_id=label.id,
        reference_track_id=reference.id,
        embedding=_VECTOR,
        provider="explicit-test-provider",
        model="explicit-test-model",
        version="explicit-v1",
        dimension=512,
        pipeline_version="explicit-pipeline-v1",
        segment_index=-1,
    )
    session.add(embedding)
    session.flush()
    return embedding


def _client(monkeypatch, session: Session | None = None, *, label_id: str = "label-a"):
    app = FastAPI()
    app.include_router(api.router)
    calls: list[tuple[str, str]] = []

    def verify(token: str):
        calls.append(("verify", token))
        return {"label_id": label_id}

    def get_session():
        calls.append(("session", "acquired"))
        if session is None:
            raise AssertionError("session must not be acquired")
        yield session

    monkeypatch.setattr(api, "_verify_token", verify)
    monkeypatch.setattr(api, "_get_session", get_session)
    return TestClient(app), calls


def _enable(monkeypatch):
    monkeypatch.setenv("LABEL_DNA_ENABLED", "true")


def _identity(monkeypatch, *, version="explicit-v1"):
    monkeypatch.setenv("AR_EMBEDDING_PROVIDER", "explicit-test-provider")
    monkeypatch.setenv("AR_EMBEDDING_MODEL", "explicit-test-model")
    monkeypatch.setenv("AR_EMBEDDING_VERSION", version)
    monkeypatch.setenv("AR_EMBEDDING_DIMENSION", "512")
    monkeypatch.setenv("AR_EMBEDDING_PIPELINE_VERSION", "explicit-pipeline-v1")


def test_disabled_routes_return_404_before_authentication_or_session(monkeypatch):
    monkeypatch.delenv("LABEL_DNA_ENABLED", raising=False)
    client, calls = _client(monkeypatch)
    monkeypatch.setattr(api, "_verify_token", lambda _token: pytest.fail("auth was called"))
    monkeypatch.setattr(api, "_get_session", lambda: pytest.fail("DB was acquired"))

    for path in ("reference-catalog", "label-dna"):
        response = client.get(f"/api/labels/me/{path}")
        assert response.status_code == 404
    assert calls == []


@pytest.mark.parametrize("enabled_value", ["false", "0", "yes", ""])
def test_only_explicit_true_or_one_enables_routes(monkeypatch, enabled_value):
    monkeypatch.setenv("LABEL_DNA_ENABLED", enabled_value)
    client, _ = _client(monkeypatch)
    response = client.get("/api/labels/me/reference-catalog", headers={"Authorization": "Bearer x"})
    assert response.status_code == 404


def test_missing_token_does_not_call_verifier_or_acquire_session(monkeypatch):
    _enable(monkeypatch)
    client, calls = _client(monkeypatch)

    response = client.get("/api/labels/me/reference-catalog")

    assert response.status_code == 401
    assert calls == []


def test_invalid_token_does_not_acquire_session_and_higher_precedence_wins(monkeypatch):
    _enable(monkeypatch)
    client, calls = _client(monkeypatch)

    def reject(token):
        calls.append(("verify", token))
        raise ValueError("private verifier detail")

    monkeypatch.setattr(api, "_verify_token", reject)
    response = client.get(
        "/api/labels/me/reference-catalog",
        headers={"Authorization": "Bearer invalid", "X-Label-Token": "valid-x"},
        cookies={"token": "valid-cookie"},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid or expired token."}
    assert calls == [("verify", "invalid")]


@pytest.mark.parametrize(
    "bad_response",
    [
        None,
        [],
        {},
        {"label_id": None},
        {"label_id": 12},
        {"label_id": ""},
        {"label_id": "  \t"},
    ],
)
def test_malformed_verified_identity_is_401_before_session(monkeypatch, bad_response):
    _enable(monkeypatch)
    client, calls = _client(monkeypatch)
    monkeypatch.setattr(
        api,
        "_verify_token",
        lambda token: calls.append(("verify", token)) or bad_response,
    )

    response = client.get("/api/labels/me/reference-catalog", headers={"X-Label-Token": "token"})

    assert response.status_code == 401
    assert calls == [("verify", "token")]


def test_all_three_token_forms_are_supported_in_precedence_order(monkeypatch, engine):
    _enable(monkeypatch)
    with Session(engine) as session:
        label_a = _label(session, "Bearer owner")
        label_b = _label(session, "Header owner")
        label_c = _label(session, "Cookie owner")
        _reference(session, label_a, title="bearer-only")
        _reference(session, label_b, title="header-only")
        _reference(session, label_c, title="cookie-only")
        session.commit()

        client, calls = _client(monkeypatch, session)
        token_owners = {"bearer": label_a.id, "header": label_b.id, "cookie": label_c.id}

        def verify(token):
            calls.append(("verify", token))
            return {"label_id": token_owners[token]}

        monkeypatch.setattr(api, "_verify_token", verify)
        requests = [
            (
                {"Authorization": "Bearer bearer", "X-Label-Token": "header"},
                {"token": "cookie"},
                "bearer-only",
            ),
            ({"X-Label-Token": "header"}, {"token": "cookie"}, "header-only"),
            ({}, {"token": "cookie"}, "cookie-only"),
        ]
        for headers, cookies, expected in requests:
            response = client.get(
                "/api/labels/me/reference-catalog",
                headers=headers,
                cookies=cookies,
            )
            assert response.status_code == 200
            assert [item["title"] for item in response.json()] == [expected]

        assert calls == [
            ("verify", "bearer"),
            ("session", "acquired"),
            ("verify", "header"),
            ("session", "acquired"),
            ("verify", "cookie"),
            ("session", "acquired"),
        ]


def test_unknown_label_is_404_and_identity_is_not_trimmed_or_overridden(monkeypatch, engine):
    _enable(monkeypatch)
    with Session(engine) as session:
        label = _label(session, "Exact id")
        session.commit()
        client, calls = _client(monkeypatch, session)
        monkeypatch.setattr(api, "_verify_token", lambda _token: {"label_id": f" {label.id} "})

        response = client.get(
            f"/api/labels/me/reference-catalog?label_id={label.id}",
            headers={"Authorization": "Bearer owner"},
        )

        assert response.status_code == 404
        assert response.json() == {"detail": "Label not found."}
        assert calls == [("session", "acquired")]


def test_forged_query_and_get_body_ids_never_change_owner_for_either_route(monkeypatch, engine):
    _enable(monkeypatch)
    _identity(monkeypatch)
    with Session(engine) as session:
        owner = _label(session, "Caller")
        other = _label(session, "Other tenant")
        _reference(session, owner, title="caller-private")
        _reference(session, other, title="other-private")
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=owner.id)

        catalog = client.request(
            "GET",
            "/api/labels/me/reference-catalog",
            params={"label_id": other.id},
            json={"label_id": other.id},
            headers={"Authorization": "Bearer caller"},
        )
        readiness = client.request(
            "GET",
            "/api/labels/me/label-dna",
            params={"label_id": other.id},
            json={"label_id": other.id},
            headers={"Authorization": "Bearer caller"},
        )

        assert catalog.status_code == readiness.status_code == 200
        assert [item["title"] for item in catalog.json()] == ["caller-private"]
        assert "other-private" not in catalog.text
        assert readiness.json() == {
            "state": "BUILDING",
            "active_reference_count": 1,
            "eligible_count": 0,
            "minimum_valid_references": 5,
        }
        assert "other" not in readiness.text


def test_reference_catalog_serializes_only_metadata_and_works_without_model_identity(
    monkeypatch, engine
):
    _enable(monkeypatch)
    monkeypatch.delenv("AR_EMBEDDING_PROVIDER", raising=False)
    monkeypatch.delenv("AR_EMBEDDING_MODEL", raising=False)
    with Session(engine) as session:
        label = _label(session, "Catalog metadata")
        _reference(session, label, title="Public title")
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=label.id)

        response = client.get(
            "/api/labels/me/reference-catalog",
            headers={"Authorization": "Bearer owner"},
        )

        assert response.status_code == 200
        item = response.json()[0]
        assert set(item) == {
            "id",
            "title",
            "artist",
            "status",
            "is_active",
            "duration_seconds",
            "created_at",
            "updated_at",
        }
        assert item["title"] == "Public title"
        for private_name in ("storage_key", "embedding", "vector", "eligible_references"):
            assert private_name not in response.text


def test_readiness_reports_no_dna_and_four_or_five_valid_references(monkeypatch, engine):
    _enable(monkeypatch)
    _identity(monkeypatch)
    with Session(engine) as session:
        empty = _label(session, "No DNA")
        four = _label(session, "Four references")
        five = _label(session, "Five references")
        for index in range(4):
            reference = _reference(session, four, title=f"Four {index}")
            _embedding(session, four, reference)
        for index in range(5):
            reference = _reference(session, five, title=f"Five {index}")
            _embedding(session, five, reference)
        session.commit()
        client, _ = _client(monkeypatch, session)

        def read_for(label_id):
            monkeypatch.setattr(api, "_verify_token", lambda _token: {"label_id": label_id})
            return client.get(
                "/api/labels/me/label-dna",
                headers={"Authorization": "Bearer owner"},
            )

        no_dna = read_for(empty.id)
        building = read_for(four.id)
        ready = read_for(five.id)

        assert no_dna.json() == {
            "state": "NO_DNA",
            "active_reference_count": 0,
            "eligible_count": 0,
            "minimum_valid_references": 5,
        }
        assert building.json() == {
            "state": "BUILDING",
            "active_reference_count": 4,
            "eligible_count": 4,
            "minimum_valid_references": 5,
        }
        assert ready.json() == {
            "state": "READY",
            "active_reference_count": 5,
            "eligible_count": 5,
            "minimum_valid_references": 5,
        }
        for response in (no_dna, building, ready):
            assert set(response.json()) == {
                "state",
                "active_reference_count",
                "eligible_count",
                "minimum_valid_references",
            }
            assert "embedding" not in response.text and "vector" not in response.text


def test_readiness_identity_is_explicit_versioned_and_never_guessed(monkeypatch, engine):
    _enable(monkeypatch)
    _identity(monkeypatch, version="different-explicit-v2")
    with Session(engine) as session:
        label = _label(session, "Versioned")
        reference = _reference(session, label)
        _embedding(session, label, reference)
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=label.id)

        response = client.get("/api/labels/me/label-dna", headers={"Authorization": "Bearer owner"})

        assert response.status_code == 200
        assert response.json()["state"] == "BUILDING"
        assert response.json()["eligible_count"] == 0
        assert "openl3" not in response.text.lower()
        assert "different-explicit-v2" not in response.text


@pytest.mark.parametrize(
    ("variable", "value"),
    [
        ("AR_EMBEDDING_PROVIDER", None),
        ("AR_EMBEDDING_MODEL", "  "),
        ("AR_EMBEDDING_VERSION", None),
        ("AR_EMBEDDING_DIMENSION", "511"),
        ("AR_EMBEDDING_DIMENSION", "not-a-number"),
        ("AR_EMBEDDING_PIPELINE_VERSION", None),
    ],
)
def test_invalid_readiness_identity_is_generic_503_before_session(monkeypatch, variable, value):
    _enable(monkeypatch)
    _identity(monkeypatch)
    if value is None:
        monkeypatch.delenv(variable, raising=False)
    else:
        monkeypatch.setenv(variable, value)
    client, calls = _client(monkeypatch)

    response = client.get("/api/labels/me/label-dna", headers={"Authorization": "Bearer owner"})

    assert response.status_code == 503
    assert response.json() == {"detail": "Label DNA is temporarily unavailable."}
    assert calls == [("verify", "owner")]


def test_lazy_wrappers_delegate_to_stub_modules_without_real_auth_or_database(monkeypatch):
    auth_module = ModuleType("app.services.auth")
    auth_module.verify_token = lambda token: {"label_id": f"stub:{token}"}
    database_module = ModuleType("app.database")
    sentinel = object()

    def sessions():
        yield sentinel

    database_module.get_session = sessions
    monkeypatch.setitem(sys.modules, "app.services.auth", auth_module)
    monkeypatch.setitem(sys.modules, "app.database", database_module)

    assert api._verify_token("test-token") == {"label_id": "stub:test-token"}
    assert next(api._get_session()) is sentinel


def test_runtime_database_configuration_error_is_redacted_but_unrelated_runtime_error_propagates(
    monkeypatch,
):
    _enable(monkeypatch)
    client, _ = _client(monkeypatch)
    monkeypatch.setattr(api, "_verify_token", lambda _token: {"label_id": "owner"})

    def missing_database_config():
        raise RuntimeError("POSTGRES_URL environment variable is required")
        yield

    monkeypatch.setattr(api, "_get_session", missing_database_config)
    response = client.get(
        "/api/labels/me/reference-catalog",
        headers={"Authorization": "Bearer owner"},
    )
    assert response.status_code == 503
    assert "POSTGRES_URL" not in response.text

    def unrelated_failure():
        raise RuntimeError("unrelated programming defect")
        yield

    monkeypatch.setattr(api, "_get_session", unrelated_failure)
    with pytest.raises(RuntimeError, match="unrelated programming defect"):
        client.get("/api/labels/me/reference-catalog", headers={"Authorization": "Bearer owner"})


def test_missing_private_tables_and_corrupt_aggregates_are_redacted(monkeypatch):
    _enable(monkeypatch)
    _identity(monkeypatch)
    cases = [
        ("reference-catalog", [Label.__table__, Submission.__table__]),
        ("label-dna", [Label.__table__, Submission.__table__, LabelReferenceTrack.__table__]),
    ]
    for endpoint, existing_tables in cases:
        engine = _engine(existing_tables)
        try:
            with Session(engine) as session:
                label = _label(session, f"Missing {endpoint}")
                if endpoint == "label-dna":
                    _reference(session, label)
                session.commit()
                client, _ = _client(monkeypatch, session, label_id=label.id)
                response = client.get(
                    f"/api/labels/me/{endpoint}",
                    headers={"Authorization": "Bearer owner"},
                )
                assert response.status_code == 503
                assert response.json() == {
                    "detail": "Reference catalog is temporarily unavailable."
                }
                assert "label_reference_tracks" not in response.text
                assert "music_embeddings" not in response.text
        finally:
            SQLModel.metadata.drop_all(engine, tables=existing_tables)
            engine.dispose()

    engine = _engine()
    try:
        with Session(engine) as session:
            label = _label(session, "Corrupt aggregate")
            reference = _reference(session, label)
            embedding = _embedding(session, label, reference)
            session.execute(
                text("UPDATE music_embeddings SET embedding = :value WHERE id = :identity"),
                {"value": json.dumps([float("nan"), *([0.0] * 511)]), "identity": embedding.id},
            )
            session.commit()
            session.expire_all()
            client, _ = _client(monkeypatch, session, label_id=label.id)
            response = client.get(
                "/api/labels/me/label-dna",
                headers={"Authorization": "Bearer owner"},
            )
            assert response.status_code == 503
            assert response.json() == {"detail": "Reference catalog is temporarily unavailable."}
            assert "vector" not in response.text.lower()
            assert "nan" not in response.text.lower()
    finally:
        SQLModel.metadata.drop_all(engine, tables=_TABLES)
        engine.dispose()


def test_owner_and_catalog_reads_do_not_autoflush_caller_state(monkeypatch, engine):
    _enable(monkeypatch)
    with Session(engine, autoflush=True) as session:
        label = _label(session, "No autoflush")
        persisted = _reference(session, label, title="Persisted title")
        session.commit()
        session.expire_all()
        identity = label.id
        persisted_id = persisted.id
        persisted = session.get(LabelReferenceTrack, persisted_id)
        persisted.title = "Dirty in memory"
        pending = LabelReferenceTrack(label_id=identity, title="Pending reference")
        session.add(pending)
        pending_id = pending.id
        flushes = []

        def record_flush(*_args):
            flushes.append(True)

        event.listen(session, "before_flush", record_flush)
        try:
            client, _ = _client(monkeypatch, session, label_id=identity)
            response = client.get(
                "/api/labels/me/reference-catalog",
                headers={"Authorization": "Bearer owner"},
            )
        finally:
            event.remove(session, "before_flush", record_flush)

        assert response.status_code == 200
        assert [item["title"] for item in response.json()] == ["Persisted title"]
        assert flushes == []
        assert pending in session.new and persisted in session.dirty
        assert pending.title == "Pending reference" and persisted.title == "Dirty in memory"
        persisted_title = (
            session.connection()
            .exec_driver_sql(
                "SELECT title FROM label_reference_tracks WHERE id = ?", (persisted_id,)
            )
            .scalar_one()
        )
        pending_count = (
            session.connection()
            .exec_driver_sql(
                "SELECT COUNT(*) FROM label_reference_tracks WHERE id = ?", (pending_id,)
            )
            .scalar_one()
        )
        assert persisted_title == "Persisted title" and pending_count == 0


def test_unrelated_runtime_failures_from_read_helpers_are_not_hidden(monkeypatch, engine):
    _enable(monkeypatch)
    with Session(engine) as session:
        label = _label(session, "Propagate")
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=label.id)
        monkeypatch.setattr(
            api,
            "list_reference_catalog",
            lambda *_args: (_ for _ in ()).throw(RuntimeError("read bug")),
        )

        with pytest.raises(RuntimeError, match="read bug"):
            client.get(
                "/api/labels/me/reference-catalog",
                headers={"Authorization": "Bearer owner"},
            )


def test_pending_owner_is_not_flushed_to_make_it_appear_to_exist(monkeypatch, engine):
    _enable(monkeypatch)
    with Session(engine, autoflush=True) as session:
        label = Label(
            id="pending-owner",
            name="Pending",
            slug="pending-owner",
            owner_email="pending@example.test",
        )
        session.add(label)
        flushes = []
        event.listen(session, "before_flush", lambda *_args: flushes.append(True))
        client, _ = _client(monkeypatch, session, label_id=label.id)

        response = client.get(
            "/api/labels/me/reference-catalog",
            headers={"Authorization": "Bearer owner"},
        )

        assert response.status_code == 404
        assert flushes == []
        assert label in session.new


def test_main_registers_reference_router_before_broad_labels_router_without_startup_assertion():
    tree = ast.parse(Path("app/main.py").read_text(encoding="utf-8"))
    imports = {}
    includes = {}
    for index, statement in enumerate(tree.body):
        if isinstance(statement, ast.ImportFrom) and statement.module in {
            "app.api.reference_catalog",
            "app.api.labels",
        }:
            imports[statement.module] = index
        if isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Call):
            call = statement.value
            if (
                isinstance(call.func, ast.Attribute)
                and call.func.attr == "include_router"
                and call.args
            ):
                argument = call.args[0]
                if isinstance(argument, ast.Name):
                    includes[argument.id] = index

    assert imports["app.api.reference_catalog"] < imports["app.api.labels"]
    assert includes["reference_catalog_router"] < includes["labels_router"]


_DECISION_TABLES = [Label.__table__, Submission.__table__, LabelArDecisionRow.__table__]


@pytest.fixture
def decisions_engine():
    value = _engine(_DECISION_TABLES)
    yield value
    SQLModel.metadata.drop_all(value, tables=_DECISION_TABLES)
    value.dispose()


def _submission(session: Session, label: Label) -> Submission:
    submission = Submission(
        id=str(uuid4()),
        label_id=label.id,
        producer_name="Producer",
        producer_email="producer@example.test",
        track_name="Demo track",
    )
    session.add(submission)
    session.flush()
    return submission


def _decision_row(
    session: Session,
    label: Label,
    submission: Submission,
    *,
    row_id: str | None = None,
    decision: str = "shortlist",
    decided_by: str = "reviewer-1",
    decided_at: datetime | None = None,
    note: str | None = None,
) -> LabelArDecisionRow:
    row = LabelArDecisionRow(
        id=row_id or str(uuid4()),
        label_id=label.id,
        submission_id=submission.id,
        decision=decision,
        decided_by=decided_by,
        decided_at=decided_at or datetime.now(UTC),
        note=note,
    )
    session.add(row)
    session.flush()
    return row


_AUTH = {"Authorization": "Bearer owner"}


def test_disabled_ar_decision_routes_return_404_before_authentication_or_session(monkeypatch):
    monkeypatch.delenv("LABEL_DNA_ENABLED", raising=False)
    client, calls = _client(monkeypatch)
    monkeypatch.setattr(api, "_verify_token", lambda _token: pytest.fail("auth was called"))
    monkeypatch.setattr(api, "_get_session", lambda: pytest.fail("DB was acquired"))

    assert client.get("/api/labels/me/ar-decisions").status_code == 404
    assert client.post("/api/labels/me/ar-decisions", json={}).status_code == 404
    assert calls == []


@pytest.mark.parametrize("enabled_value", ["false", "0", "yes", "", None])
def test_ar_decision_routes_stay_disabled_without_explicit_true_or_one(monkeypatch, enabled_value):
    if enabled_value is None:
        monkeypatch.delenv("LABEL_DNA_ENABLED", raising=False)
    else:
        monkeypatch.setenv("LABEL_DNA_ENABLED", enabled_value)
    client, _ = _client(monkeypatch)

    assert client.get("/api/labels/me/ar-decisions", headers=_AUTH).status_code == 404
    assert client.post("/api/labels/me/ar-decisions", json={}, headers=_AUTH).status_code == 404


@pytest.mark.parametrize("enabled_value", ["true", "1"])
def test_ar_decision_routes_enable_only_on_exact_true_or_one(monkeypatch, enabled_value):
    monkeypatch.setenv("LABEL_DNA_ENABLED", enabled_value)
    client, calls = _client(monkeypatch)

    assert client.get("/api/labels/me/ar-decisions", headers=_AUTH).status_code == 401
    assert client.post("/api/labels/me/ar-decisions", json={}, headers=_AUTH).status_code == 401
    assert calls == [("verify", "owner"), ("verify", "owner")]


def test_ar_decision_missing_token_is_401_before_verifier_or_session(monkeypatch):
    _enable(monkeypatch)
    client, calls = _client(monkeypatch)

    assert client.get("/api/labels/me/ar-decisions").status_code == 401
    assert (
        client.post(
            "/api/labels/me/ar-decisions",
            json={"submission_id": str(uuid4()), "decision": "shortlist"},
        ).status_code
        == 401
    )
    assert calls == []


def test_ar_decision_invalid_token_is_401_and_bearer_precedence_wins(monkeypatch):
    _enable(monkeypatch)
    client, calls = _client(monkeypatch)

    def reject(token):
        calls.append(("verify", token))
        raise ValueError("private verifier detail")

    monkeypatch.setattr(api, "_verify_token", reject)

    get_response = client.get(
        "/api/labels/me/ar-decisions",
        headers={"Authorization": "Bearer invalid", "X-Label-Token": "valid-x"},
        cookies={"token": "valid-cookie"},
    )
    post_response = client.post(
        "/api/labels/me/ar-decisions",
        json={"submission_id": str(uuid4()), "decision": "shortlist"},
        headers={"Authorization": "Bearer invalid"},
    )

    assert get_response.status_code == post_response.status_code == 401
    assert get_response.json() == {"detail": "Invalid or expired token."}
    assert calls == [("verify", "invalid"), ("verify", "invalid")]


def test_ar_decision_history_accepts_all_three_token_forms_in_precedence_order(
    monkeypatch, decisions_engine
):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        label_a = _label(session, "Bearer decider")
        label_b = _label(session, "Header decider")
        label_c = _label(session, "Cookie decider")
        for owner in (label_a, label_b, label_c):
            _decision_row(session, owner, _submission(session, owner), decided_by=owner.name)
        session.commit()
        client, _ = _client(monkeypatch, session)
        owners = {"bearer": label_a, "header": label_b, "cookie": label_c}

        def verify(token):
            return {"label_id": owners[token].id}

        monkeypatch.setattr(api, "_verify_token", verify)
        bearer_and_header = {"Authorization": "Bearer bearer", "X-Label-Token": "header"}
        requests = [
            (bearer_and_header, {"token": "cookie"}, label_a),
            ({"X-Label-Token": "header"}, {"token": "cookie"}, label_b),
            ({}, {"token": "cookie"}, label_c),
        ]
        for headers, cookies, expected in requests:
            response = client.get("/api/labels/me/ar-decisions", headers=headers, cookies=cookies)
            assert response.status_code == 200
            assert [entry["decided_by"] for entry in response.json()] == [expected.name]


def test_ar_decision_history_empty_label_returns_200_empty_array(monkeypatch, decisions_engine):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        label = _label(session, "No decisions")
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=label.id)

        response = client.get("/api/labels/me/ar-decisions", headers=_AUTH)

        assert response.status_code == 200
        assert response.json() == []


def test_ar_decision_history_orders_by_decided_at_then_id_and_minimizes_dto(
    monkeypatch, decisions_engine
):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        label = _label(session, "Ordered")
        submission = _submission(session, label)
        base = datetime(2025, 3, 1, tzinfo=UTC)
        _decision_row(
            session,
            label,
            submission,
            row_id="ffffffff-0000-0000-0000-000000000000",
            decided_at=base + timedelta(days=1),
            decided_by="later-time",
        )
        _decision_row(
            session,
            label,
            submission,
            row_id="dddddddd-0000-0000-0000-000000000000",
            decided_at=base,
            decided_by="tie-late-id",
        )
        _decision_row(
            session,
            label,
            submission,
            row_id="aaaaaaaa-0000-0000-0000-000000000000",
            decided_at=base,
            decided_by="tie-early-id",
        )
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=label.id)

        response = client.get("/api/labels/me/ar-decisions", headers=_AUTH)

        assert response.status_code == 200
        assert [entry["decided_by"] for entry in response.json()] == [
            "tie-early-id",
            "tie-late-id",
            "later-time",
        ]
        assert set(response.json()[0]) == {
            "decision_id",
            "submission_id",
            "decision",
            "decided_by",
            "decided_at",
            "note",
        }
        datetime.fromisoformat(response.json()[0]["decided_at"])  # ISO-8601


def test_ar_decision_history_filters_by_canonical_submission_query(monkeypatch, decisions_engine):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        label = _label(session, "Filter owner")
        first = _submission(session, label)
        second = _submission(session, label)
        first_row = _decision_row(
            session, label, first, decision="rejected", decided_at=datetime(2025, 3, 1, tzinfo=UTC)
        )
        second_row = _decision_row(
            session, label, second, decided_at=datetime(2025, 3, 2, tzinfo=UTC)
        )
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=label.id)

        wide = client.get("/api/labels/me/ar-decisions", headers=_AUTH)
        filtered = client.get(
            "/api/labels/me/ar-decisions",
            params={"submission_id": second.id},
            headers=_AUTH,
        )

        assert wide.status_code == filtered.status_code == 200
        assert [entry["decision_id"] for entry in wide.json()] == [first_row.id, second_row.id]
        assert [entry["decision_id"] for entry in filtered.json()] == [second_row.id]
        assert {entry["submission_id"] for entry in filtered.json()} == {second.id}


@pytest.mark.parametrize("bad_value", [uuid4().hex, str(uuid4()).upper(), "not-a-uuid"])
def test_ar_decision_history_rejects_non_canonical_submission_query(
    monkeypatch, decisions_engine, bad_value
):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        label = _label(session, "Bad query")
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=label.id)

        response = client.get(
            "/api/labels/me/ar-decisions",
            params={"submission_id": bad_value},
            headers=_AUTH,
        )

        assert response.status_code == 422
        assert response.json() == {"detail": "invalid_submission_id"}


def test_ar_decision_history_unknown_label_is_404(monkeypatch, decisions_engine):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        _label(session, "Real label")
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=str(uuid4()))

        response = client.get("/api/labels/me/ar-decisions", headers=_AUTH)

        assert response.status_code == 404
        assert response.json() == {"detail": "Label not found."}


def test_ar_decision_post_creates_row_with_documented_owner_default(monkeypatch, decisions_engine):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        label = _label(session, "Creator")
        submission = _submission(session, label)
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=label.id)

        response = client.post(
            "/api/labels/me/ar-decisions",
            json={"submission_id": submission.id, "decision": "shortlist", "note": "Strong hook"},
            headers=_AUTH,
        )

        assert response.status_code == 201
        body = response.json()
        assert body["created"] is True
        assert body["decision"] == "shortlist"
        assert body["decided_by"] == "owner"  # documented API default
        assert body["submission_id"] == submission.id
        assert body["note"] == "Strong hook"
        datetime.fromisoformat(body["decided_at"])
        session.expire_all()
        stored = session.exec(select(LabelArDecisionRow)).one()
        assert stored.label_id == label.id
        assert stored.decision == "shortlist"
        assert stored.decided_by == "owner"
        assert stored.note == "Strong hook"


def test_ar_decision_post_suppresses_reaffirmation_then_appends_decision_change(
    monkeypatch, decisions_engine
):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        label = _label(session, "Suppressor")
        submission = _submission(session, label)
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=label.id)

        first = client.post(
            "/api/labels/me/ar-decisions",
            json={"submission_id": submission.id, "decision": "shortlist", "note": "first"},
            headers=_AUTH,
        )
        re_affirmed = client.post(
            "/api/labels/me/ar-decisions",
            json={"submission_id": submission.id, "decision": "shortlist", "decided_by": "owner"},
            headers=_AUTH,
        )
        changed = client.post(
            "/api/labels/me/ar-decisions",
            json={"submission_id": submission.id, "decision": "rejected", "decided_by": "owner"},
            headers=_AUTH,
        )

        assert first.status_code == changed.status_code == 201
        assert re_affirmed.status_code == 200  # finalize 201/200 reuse precedent
        assert re_affirmed.json()["created"] is False
        assert re_affirmed.json()["decision_id"] == first.json()["decision_id"]
        assert changed.json()["created"] is True
        assert changed.json()["decision_id"] != first.json()["decision_id"]
        assert len(session.exec(select(LabelArDecisionRow)).all()) == 2


@pytest.mark.parametrize("bad_decision", ["inbox", "auto_rejected", "Shortlist", ""])
def test_ar_decision_post_rejects_non_decision_vocabulary(
    monkeypatch, decisions_engine, bad_decision
):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        label = _label(session, "Vocabulary")
        submission = _submission(session, label)
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=label.id)

        response = client.post(
            "/api/labels/me/ar-decisions",
            json={"submission_id": submission.id, "decision": bad_decision},
            headers=_AUTH,
        )

        assert response.status_code == 422
        assert response.json() == {"detail": "invalid_decision"}
        assert session.exec(select(LabelArDecisionRow)).all() == []


@pytest.mark.parametrize("bad_id", [uuid4().hex, str(uuid4()).upper()])
def test_ar_decision_post_rejects_bad_submission_ids(monkeypatch, decisions_engine, bad_id):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        label = _label(session, "Bad post id")
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=label.id)

        response = client.post(
            "/api/labels/me/ar-decisions",
            json={"submission_id": bad_id, "decision": "shortlist"},
            headers=_AUTH,
        )

        assert response.status_code == 422
        assert response.json() == {"detail": "invalid_submission_id"}
        assert session.exec(select(LabelArDecisionRow)).all() == []


@pytest.mark.parametrize("blank_decider", ["", "   ", "\t", " padded "])
def test_ar_decision_post_rejects_blank_or_padded_decided_by(
    monkeypatch, decisions_engine, blank_decider
):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        label = _label(session, "Decider")
        submission = _submission(session, label)
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=label.id)

        response = client.post(
            "/api/labels/me/ar-decisions",
            json={
                "submission_id": submission.id,
                "decision": "shortlist",
                "decided_by": blank_decider,
            },
            headers=_AUTH,
        )

        assert response.status_code == 422
        assert response.json() == {"detail": "invalid_decided_by"}
        assert session.exec(select(LabelArDecisionRow)).all() == []


def test_ar_decision_post_unknown_or_foreign_submission_is_404(monkeypatch, decisions_engine):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        owner = _label(session, "Submitter")
        other = _label(session, "Foreign owner")
        foreign = _submission(session, other)
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=owner.id)

        missing = client.post(
            "/api/labels/me/ar-decisions",
            json={"submission_id": str(uuid4()), "decision": "shortlist"},
            headers=_AUTH,
        )
        foreign_attempt = client.post(
            "/api/labels/me/ar-decisions",
            json={"submission_id": foreign.id, "decision": "shortlist"},
            headers=_AUTH,
        )

        # Mirrors the presign owner-scoped existence-SELECT precedent: an
        # unknown id and another label's id are indistinguishable 404s.
        assert missing.status_code == foreign_attempt.status_code == 404
        assert missing.json() == foreign_attempt.json() == {"detail": "Submission not found."}
        assert session.exec(select(LabelArDecisionRow)).all() == []


def test_missing_ar_decision_table_is_redacted_503_for_both_routes(monkeypatch):
    _enable(monkeypatch)
    tables = [Label.__table__, Submission.__table__, LabelReferenceTrack.__table__]
    engine = _engine(tables)
    try:
        with Session(engine) as session:
            label = _label(session, "Missing decisions")
            submission = _submission(session, label)
            session.commit()
            client, _ = _client(monkeypatch, session, label_id=label.id)

            get_response = client.get("/api/labels/me/ar-decisions", headers=_AUTH)
            post_response = client.post(
                "/api/labels/me/ar-decisions",
                json={"submission_id": submission.id, "decision": "shortlist"},
                headers=_AUTH,
            )

            assert get_response.status_code == post_response.status_code == 503
            for response in (get_response, post_response):
                assert response.json() == {
                    "detail": "Reference catalog is temporarily unavailable."
                }
                assert "label_ar_decisions" not in response.text
    finally:
        SQLModel.metadata.drop_all(engine, tables=tables)
        engine.dispose()


def test_ar_decision_unrelated_read_failure_is_not_hidden(monkeypatch, decisions_engine):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        label = _label(session, "Propagate decisions")
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=label.id)
        monkeypatch.setattr(
            api,
            "list_label_decision_history",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("decision read bug")),
        )

        with pytest.raises(RuntimeError, match="decision read bug"):
            client.get("/api/labels/me/ar-decisions", headers=_AUTH)


def test_ar_decision_post_maps_service_value_errors_to_422(monkeypatch, decisions_engine):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        label = _label(session, "Value error")
        submission = _submission(session, label)
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=label.id)
        monkeypatch.setattr(
            api,
            "record_label_ar_decision",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(
                ValueError("decision must be exactly 'shortlist' or 'rejected'")
            ),
        )

        response = client.post(
            "/api/labels/me/ar-decisions",
            json={"submission_id": submission.id, "decision": "shortlist"},
            headers=_AUTH,
        )

        assert response.status_code == 422
        assert session.exec(select(LabelArDecisionRow)).all() == []


def test_ar_decision_post_is_event_only_for_submission_columns(monkeypatch, decisions_engine):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        label = _label(session, "Event only")
        submission = _submission(session, label)
        session.commit()

        def snapshot():
            session.expire_all()
            stored = session.get(Submission, submission.id)
            return {c.name: getattr(stored, c.name) for c in Submission.__table__.columns}

        before = snapshot()
        assert before["status"] == "inbox"  # unseeded default
        client, _ = _client(monkeypatch, session, label_id=label.id)

        first = client.post(
            "/api/labels/me/ar-decisions",
            json={"submission_id": submission.id, "decision": "rejected"},
            headers=_AUTH,
        )
        second = client.post(
            "/api/labels/me/ar-decisions",
            json={
                "submission_id": submission.id,
                "decision": "shortlist",
                "decided_by": "reviewer-2",
            },
            headers=_AUTH,
        )

        assert first.status_code == second.status_code == 201
        assert snapshot() == before  # Submission.status never moves; decisions are events


def test_ar_decision_forged_query_and_body_ids_never_change_owner_scope(
    monkeypatch, decisions_engine
):
    _enable(monkeypatch)
    with Session(decisions_engine) as session:
        owner = _label(session, "Decision caller")
        other = _label(session, "Decision other")
        owner_submission = _submission(session, owner)
        other_submission = _submission(session, other)
        _decision_row(session, owner, owner_submission, decided_by="caller")
        _decision_row(session, other, other_submission, decided_by="other")
        session.commit()
        client, _ = _client(monkeypatch, session, label_id=owner.id)

        listing = client.request(
            "GET",
            "/api/labels/me/ar-decisions",
            params={"label_id": other.id, "submission_id": other_submission.id},
            headers=_AUTH,
        )
        forged_body = client.post(
            "/api/labels/me/ar-decisions",
            json={
                "label_id": other.id,
                "submission_id": owner_submission.id,
                "decision": "shortlist",
            },
            headers=_AUTH,
        )
        malformed = client.post(
            "/api/labels/me/ar-decisions",
            json={"submission_id": owner_submission.id},
            headers=_AUTH,
        )

        assert listing.status_code == 200
        assert listing.json() == []  # another label's submission is outside caller scope
        assert forged_body.status_code == 422  # caller-controlled label_id is forbidden
        assert malformed.status_code == 422  # missing decision is a request-level failure
        assert len(session.exec(select(LabelArDecisionRow)).all()) == 2
