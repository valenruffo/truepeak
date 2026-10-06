"""Mock-only tests for lazy configuration of the private R2 staging adapter."""

from __future__ import annotations

import builtins
import importlib.util
import sys
from types import ModuleType, SimpleNamespace

import pytest

import app.services.reference_r2_factory as factory
from app.services.reference_r2 import PrivateReferenceStagingAdapter
from app.services.reference_r2_factory import ReferenceR2FactoryError

PRIVATE_KEY = "LABEL_REFERENCE_R2_BUCKET_NAME"
ATTESTATION_KEY = "LABEL_REFERENCE_R2_PRIVATE_ACCESS_CONFIRMED"
LEGACY_KEY = "CLOUDFLARE_R2_BUCKET_NAME"
ENDPOINT_KEY = "CLOUDFLARE_R2_ENDPOINT"
ACCESS_KEY = "CLOUDFLARE_R2_ACCESS_KEY_ID"
SECRET_KEY = "CLOUDFLARE_R2_SECRET_ACCESS_KEY"
REQUIRED_KEYS = (PRIVATE_KEY, ATTESTATION_KEY, LEGACY_KEY, ENDPOINT_KEY, ACCESS_KEY, SECRET_KEY)
FAKE_SETTINGS = {
    PRIVATE_KEY: "private-reference-bucket",
    ATTESTATION_KEY: " TrUe ",
    LEGACY_KEY: "legacy-public-bucket",
    ENDPOINT_KEY: "https://fake-r2.example.test/account/path",
    ACCESS_KEY: "FAKE_ACCESS_KEY",
    SECRET_KEY: "FAKE_SECRET_KEY",
}


class TrackedSettings(dict[str, str]):
    def __init__(self, values: dict[str, str]):
        super().__init__(values)
        self.reads: list[str] = []

    def get(self, key: str, default: object = None) -> str | object:
        self.reads.append(key)
        return super().get(key, default)


def make_settings(**overrides: str) -> TrackedSettings:
    return TrackedSettings({**FAKE_SETTINGS, **overrides})


def test_import_is_lazy_and_does_not_resolve_environment(monkeypatch):
    real_import = builtins.__import__

    class UnreadEnvironment:
        def get(self, *args, **kwargs):
            raise AssertionError("environment read during factory module import")

    class FakeOs:
        environ = UnreadEnvironment()

    def guarded_import(name, *args, **kwargs):
        if name == "os":
            return FakeOs
        if name.split(".", 1)[0] in {"boto3", "botocore"}:
            raise AssertionError("SDK imported during factory module import")
        if name == "app.services.reference_r2_promotion":
            raise AssertionError("promotion adapter imported during factory module import")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded_import)
    spec = importlib.util.spec_from_file_location(
        "reference_r2_factory_import_probe", factory.__file__
    )
    assert spec is not None and spec.loader is not None
    probe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(probe)


def test_explicit_configuration_and_builder_seam_pass_only_documented_settings():
    settings = make_settings()
    clients: list[dict[str, str]] = []
    fake_client = object()

    def builder(**kwargs):
        clients.append(kwargs)
        return fake_client

    adapter = factory.create_private_reference_staging_adapter(
        environ=settings, client_builder=builder
    )

    assert isinstance(adapter, PrivateReferenceStagingAdapter)
    assert adapter._s3_client is fake_client
    assert settings.reads == list(REQUIRED_KEYS)
    assert clients == [
        {
            "endpoint_url": FAKE_SETTINGS[ENDPOINT_KEY],
            "aws_access_key_id": FAKE_SETTINGS[ACCESS_KEY],
            "aws_secret_access_key": FAKE_SETTINGS[SECRET_KEY],
        }
    ]


def test_default_builder_uses_explicit_credentials_sigv4_and_region_auto(monkeypatch):
    calls: list[tuple[tuple[object, ...], dict[str, object]]] = []
    fake_client = object()

    class FakeConfig:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    boto3 = ModuleType("boto3")
    boto3.client = lambda *args, **kwargs: calls.append((args, kwargs)) or fake_client
    botocore = ModuleType("botocore")
    botocore.__path__ = []
    botocore_config = ModuleType("botocore.config")
    botocore_config.Config = FakeConfig
    botocore_exceptions = ModuleType("botocore.exceptions")
    botocore_exceptions.BotoCoreError = type("FakeBotoCoreError", (Exception,), {})
    monkeypatch.setitem(sys.modules, "boto3", boto3)
    monkeypatch.setitem(sys.modules, "botocore", botocore)
    monkeypatch.setitem(sys.modules, "botocore.config", botocore_config)
    monkeypatch.setitem(sys.modules, "botocore.exceptions", botocore_exceptions)

    adapter = factory.create_private_reference_staging_adapter(environ=make_settings())

    assert adapter._s3_client is fake_client
    assert len(calls) == 1
    args, kwargs = calls[0]
    assert args == ("s3",)
    assert set(kwargs) == {
        "endpoint_url",
        "aws_access_key_id",
        "aws_secret_access_key",
        "config",
        "region_name",
    }
    assert kwargs["endpoint_url"] == FAKE_SETTINGS[ENDPOINT_KEY]
    assert kwargs["aws_access_key_id"] == FAKE_SETTINGS[ACCESS_KEY]
    assert kwargs["aws_secret_access_key"] == FAKE_SETTINGS[SECRET_KEY]
    assert kwargs["region_name"] == "auto"
    assert isinstance(kwargs["config"], FakeConfig)
    assert kwargs["config"].kwargs == {"signature_version": "s3v4"}


def test_injected_client_skips_builder_and_sdk_import(monkeypatch):
    def deny_sdk_import(name, *args, **kwargs):
        if name.split(".", 1)[0] in {"boto3", "botocore"}:
            raise AssertionError("SDK imported for an injected client")
        return real_import(name, *args, **kwargs)

    real_import = builtins.__import__
    monkeypatch.setattr(builtins, "__import__", deny_sdk_import)
    client = object()
    adapter = factory.create_private_reference_staging_adapter(
        environ=make_settings(), client=client
    )
    assert adapter._s3_client is client


@pytest.mark.parametrize("key", REQUIRED_KEYS)
def test_each_missing_setting_fails_before_client_builder(key):
    settings = make_settings()
    del settings[key]
    builder_calls: list[object] = []

    with pytest.raises(ReferenceR2FactoryError):
        factory.create_private_reference_staging_adapter(
            environ=settings, client_builder=lambda **kwargs: builder_calls.append(kwargs)
        )
    assert builder_calls == []


@pytest.mark.parametrize("key", REQUIRED_KEYS)
def test_each_blank_setting_fails_before_client_builder(key):
    settings = make_settings(**{key: "  "})
    builder_calls: list[object] = []

    with pytest.raises(ReferenceR2FactoryError):
        factory.create_private_reference_staging_adapter(
            environ=settings, client_builder=lambda **kwargs: builder_calls.append(kwargs)
        )
    assert builder_calls == []


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fake-r2.example.test",
        "https:///missing-host",
        "https://user:pass@fake-r2.example.test",
        "https://fake-r2.example.test/path?query=value",
        "https://fake-r2.example.test/path#fragment",
        "https://fake-r2.example.test/path?",
        "https://fake-r2.example.test/path#",
        "https://fake-r2.example.test:bad-port",
    ],
)
def test_invalid_endpoint_fails_before_client_builder(endpoint):
    builder_calls: list[object] = []
    with pytest.raises(ReferenceR2FactoryError):
        factory.create_private_reference_staging_adapter(
            environ=make_settings(**{ENDPOINT_KEY: endpoint}),
            client_builder=lambda **kwargs: builder_calls.append(kwargs),
        )
    assert builder_calls == []


@pytest.mark.parametrize("attestation", ["", "false", "yes", "2", " true-ish ", "0"])
def test_attestation_requires_explicit_true_or_one(attestation):
    builder_calls: list[object] = []
    with pytest.raises(ReferenceR2FactoryError):
        factory.create_private_reference_staging_adapter(
            environ=make_settings(**{ATTESTATION_KEY: attestation}),
            client_builder=lambda **kwargs: builder_calls.append(kwargs),
        )
    assert builder_calls == []


@pytest.mark.parametrize("attestation", ["true", " TRUE ", "1", " 1 "])
def test_attestation_accepts_only_trimmed_case_insensitive_true_or_one(attestation):
    client = object()
    adapter = factory.create_private_reference_staging_adapter(
        environ=make_settings(**{ATTESTATION_KEY: attestation}), client=client
    )
    assert adapter._s3_client is client


def test_bucket_collision_fails_before_sdk_import_or_client_builder():
    settings = make_settings(**{PRIVATE_KEY: FAKE_SETTINGS[LEGACY_KEY]})
    builder_calls: list[object] = []
    with pytest.raises(ReferenceR2FactoryError):
        factory.create_private_reference_staging_adapter(
            environ=settings, client_builder=lambda **kwargs: builder_calls.append(kwargs)
        )
    assert builder_calls == []


def test_invalid_configuration_does_not_import_optional_sdk(monkeypatch):
    real_import = builtins.__import__

    def deny_sdk_import(name, *args, **kwargs):
        if name.split(".", 1)[0] in {"boto3", "botocore"}:
            raise AssertionError("SDK imported before configuration validation")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", deny_sdk_import)
    with pytest.raises(ReferenceR2FactoryError):
        factory.create_private_reference_staging_adapter(
            environ=make_settings(**{PRIVATE_KEY: FAKE_SETTINGS[LEGACY_KEY]})
        )


@pytest.mark.parametrize(
    "overrides",
    [
        {PRIVATE_KEY: " private-bucket"},
        {LEGACY_KEY: "legacy-bucket\n"},
        {PRIVATE_KEY: "bucket\x7f"},
    ],
)
def test_adapter_bucket_name_guard_is_applied_before_client_creation(overrides):
    builder_calls: list[object] = []
    with pytest.raises(ReferenceR2FactoryError):
        factory.create_private_reference_staging_adapter(
            environ=make_settings(**overrides),
            client_builder=lambda **kwargs: builder_calls.append(kwargs),
        )
    assert builder_calls == []


def test_configuration_errors_do_not_echo_endpoint_or_credential_values():
    endpoint = "https://private-sensitive.example.test?token=FAKE_URL_SECRET"
    access_key = "FAKE_ACCESS_KEY_DO_NOT_ECHO"
    secret_key = "FAKE_SECRET_KEY_DO_NOT_ECHO"
    with pytest.raises(ReferenceR2FactoryError) as raised:
        factory.create_private_reference_staging_adapter(
            environ=make_settings(
                **{
                    ENDPOINT_KEY: endpoint,
                    ACCESS_KEY: access_key,
                    SECRET_KEY: secret_key,
                    ATTESTATION_KEY: "no",
                }
            ),
            client_builder=lambda **kwargs: pytest.fail("builder must not run"),
        )
    rendered = f"{raised.value!r} {raised.value}"
    assert endpoint not in rendered
    assert access_key not in rendered
    assert secret_key not in rendered


def _promotion_client(
    *, signature_version: object = "s3v4", has_meta: bool = True, has_register: bool = True
):
    registrations: list[tuple[object, ...]] = []
    events = SimpleNamespace(
        register=(lambda *args: registrations.append(args)) if has_register else None
    )
    config = SimpleNamespace(signature_version=signature_version)
    meta = SimpleNamespace(config=config, events=events)
    return SimpleNamespace(meta=meta) if has_meta else SimpleNamespace(), registrations


def test_promotion_factory_requires_explicit_settings_and_fresh_hook_capable_clients():
    clients = [_promotion_client(), _promotion_client()]
    builder_calls: list[dict[str, str]] = []

    def builder(**kwargs):
        builder_calls.append(kwargs)
        return clients[len(builder_calls) - 1][0]

    adapters = [
        factory.create_private_reference_promotion_adapter(
            environ=make_settings(), client_builder=builder
        )
        for _ in range(2)
    ]

    assert [type(adapter).__name__ for adapter in adapters] == [
        "PrivateReferenceR2PromotionAdapter",
        "PrivateReferenceR2PromotionAdapter",
    ]
    assert adapters[0]._s3_client is not adapters[1]._s3_client
    assert all(adapter._private_bucket == FAKE_SETTINGS[PRIVATE_KEY] for adapter in adapters)
    assert all(adapter._legacy_bucket == FAKE_SETTINGS[LEGACY_KEY] for adapter in adapters)
    assert (
        builder_calls
        == [
            {
                "endpoint_url": FAKE_SETTINGS[ENDPOINT_KEY],
                "aws_access_key_id": FAKE_SETTINGS[ACCESS_KEY],
                "aws_secret_access_key": FAKE_SETTINGS[SECRET_KEY],
            }
        ]
        * 2
    )
    for adapter, (_, registrations) in zip(adapters, clients, strict=True):
        adapter._ensure_copy_hook()
        adapter._ensure_copy_hook()
        assert len(registrations) == 1


@pytest.mark.parametrize(
    "override",
    [
        {PRIVATE_KEY: FAKE_SETTINGS[LEGACY_KEY]},
        {PRIVATE_KEY: "bad/name"},
    ],
)
def test_promotion_factory_rejects_bad_configuration_before_builder_or_sdk_import(
    monkeypatch, override
):
    builder_calls: list[object] = []
    real_import = builtins.__import__

    def deny_sdk_import(name, *args, **kwargs):
        if name.split(".", 1)[0] in {"boto3", "botocore"}:
            raise AssertionError("SDK imported before promotion configuration validation")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", deny_sdk_import)
    with pytest.raises(ReferenceR2FactoryError):
        factory.create_private_reference_promotion_adapter(
            environ=make_settings(**override),
            client_builder=lambda **kwargs: builder_calls.append(kwargs),
        )
    assert builder_calls == []


@pytest.mark.parametrize("problem", ["signature", "meta", "config", "register"])
def test_promotion_factory_rejects_clients_without_sigv4_and_copy_hooks(problem):
    signature = "FAKE_SECRET_SIGNATURE" if problem == "signature" else "s3v4"
    client, _ = _promotion_client(
        signature_version=signature,
        has_meta=problem != "meta",
        has_register=problem != "register",
    )
    if problem == "config":
        del client.meta.config
    with pytest.raises(ReferenceR2FactoryError) as raised:
        factory.create_private_reference_promotion_adapter(
            environ=make_settings(), client_builder=lambda **kwargs: client
        )
    assert "FAKE_SECRET_SIGNATURE" not in str(raised.value)


def test_promotion_factory_does_not_hide_custom_builder_programming_errors():
    failure = RuntimeError("custom builder programming error")

    def builder(**kwargs):
        raise failure

    with pytest.raises(RuntimeError) as raised:
        factory.create_private_reference_promotion_adapter(
            environ=make_settings(), client_builder=builder
        )
    assert raised.value is failure


def test_promotion_default_builder_uses_fresh_sessions_explicit_sigv4_and_redacts_sdk_errors(
    monkeypatch,
):
    sessions: list[object] = []
    client_calls: list[tuple[object, tuple[object, ...], dict[str, object]]] = []

    class FakeConfig:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class FakeBotoCoreError(Exception):
        pass

    class FakeSession:
        fail = False

        def __init__(self):
            sessions.append(self)

        def client(self, *args, **kwargs):
            client_calls.append((self, args, kwargs))
            if self.fail:
                raise FakeBotoCoreError("FAKE_SECRET SDK detail")
            return _promotion_client()[0]

    boto3 = ModuleType("boto3")
    boto3.session = SimpleNamespace(Session=FakeSession)
    botocore = ModuleType("botocore")
    botocore.__path__ = []
    botocore_config = ModuleType("botocore.config")
    botocore_config.Config = FakeConfig
    botocore_exceptions = ModuleType("botocore.exceptions")
    botocore_exceptions.BotoCoreError = FakeBotoCoreError
    monkeypatch.setitem(sys.modules, "boto3", boto3)
    monkeypatch.setitem(sys.modules, "botocore", botocore)
    monkeypatch.setitem(sys.modules, "botocore.config", botocore_config)
    monkeypatch.setitem(sys.modules, "botocore.exceptions", botocore_exceptions)

    adapters = [
        factory.create_private_reference_promotion_adapter(environ=make_settings())
        for _ in range(2)
    ]
    assert len(sessions) == 2 and sessions[0] is not sessions[1]
    assert adapters[0]._s3_client is not adapters[1]._s3_client
    assert [session for session, _, _ in client_calls[:2]] == sessions
    assert all(args == ("s3",) for _, args, _ in client_calls[:2])
    for _, _, kwargs in client_calls[:2]:
        assert kwargs == {
            "endpoint_url": FAKE_SETTINGS[ENDPOINT_KEY],
            "aws_access_key_id": FAKE_SETTINGS[ACCESS_KEY],
            "aws_secret_access_key": FAKE_SETTINGS[SECRET_KEY],
            "config": kwargs["config"],
            "region_name": "auto",
        }
        assert isinstance(kwargs["config"], FakeConfig)
        assert kwargs["config"].kwargs == {"signature_version": "s3v4"}

    FakeSession.fail = True
    with pytest.raises(ReferenceR2FactoryError) as raised:
        factory.create_private_reference_promotion_adapter(environ=make_settings())
    assert "FAKE_SECRET" not in str(raised.value)
    assert raised.value.__cause__ is None


def test_promotion_default_builder_redacts_missing_sdk_import(monkeypatch):
    real_import = builtins.__import__

    def missing_sdk(name, *args, **kwargs):
        if name == "boto3":
            raise ImportError("FAKE_SECRET SDK import detail")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", missing_sdk)
    with pytest.raises(ReferenceR2FactoryError) as raised:
        factory.create_private_reference_promotion_adapter(environ=make_settings())
    assert "FAKE_SECRET" not in str(raised.value)
    assert raised.value.__cause__ is None


def _original_reader_client(signature_version="s3v4", with_get_object=True):
    calls: list[dict[str, object]] = []
    client = SimpleNamespace(
        meta=SimpleNamespace(config=SimpleNamespace(signature_version=signature_version))
    )
    if with_get_object:
        client.get_object = lambda **kwargs: calls.append(kwargs)
    return client, calls


def test_original_reader_factory_uses_explicit_settings_without_object_reads():
    settings = make_settings()
    client, object_calls = _original_reader_client()
    builder_calls: list[dict[str, str]] = []
    reader = factory.create_private_reference_original_reader(
        environ=settings,
        client_builder=lambda **kwargs: builder_calls.append(kwargs) or client,
    )
    assert type(reader).__name__ == "PrivateReferenceOriginalReader"
    assert settings.reads == list(REQUIRED_KEYS)
    assert builder_calls == [
        {
            "endpoint_url": FAKE_SETTINGS[ENDPOINT_KEY],
            "aws_access_key_id": FAKE_SETTINGS[ACCESS_KEY],
            "aws_secret_access_key": FAKE_SETTINGS[SECRET_KEY],
        }
    ]
    assert object_calls == []


@pytest.mark.parametrize(
    "override",
    [{PRIVATE_KEY: "invalid/name"}, {ENDPOINT_KEY: "http://fake-r2.example.test"}],
)
def test_original_reader_invalid_configuration_precedes_reader_sdk_imports_and_builder(
    monkeypatch, override
):
    real_import = builtins.__import__
    builder_calls: list[object] = []

    def guarded_import(name, *args, **kwargs):
        if name in {"app.services.reference_r2_originals", "boto3"}:
            raise AssertionError("invalid configuration imported reader or SDK")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded_import)
    with pytest.raises(ReferenceR2FactoryError):
        factory.create_private_reference_original_reader(
            environ=make_settings(**override),
            client_builder=lambda **kwargs: builder_calls.append(kwargs),
        )
    assert builder_calls == []


@pytest.mark.parametrize("problem", ["signature", "missing_meta", "missing_get", "none"])
def test_original_reader_factory_rejects_bad_clients_without_exposing_details(problem):
    if problem == "signature":
        client, object_calls = _original_reader_client("FAKE_SECRET")
    elif problem == "missing_meta":
        client, object_calls = SimpleNamespace(get_object=lambda **kwargs: None), []
    elif problem == "missing_get":
        client, object_calls = _original_reader_client(with_get_object=False)
    else:
        client, object_calls = None, []
    with pytest.raises(ReferenceR2FactoryError) as raised:
        factory.create_private_reference_original_reader(
            environ=make_settings(), client_builder=lambda **kwargs: client
        )
    assert "FAKE_SECRET" not in str(raised.value)
    assert object_calls == []


def test_original_reader_default_builder_uses_fresh_sigv4_sessions_and_clients(monkeypatch):
    sessions: list[object] = []
    calls: list[tuple[object, tuple[object, ...], dict[str, object]]] = []
    clients: list[object] = []

    class FakeConfig:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class FakeBotoCoreError(Exception):
        pass

    class FakeSession:
        fail = False

        def __init__(self):
            sessions.append(self)

        def client(self, *args, **kwargs):
            calls.append((self, args, kwargs))
            if self.fail:
                raise FakeBotoCoreError("FAKE_SECRET SDK detail")
            client, object_calls = _original_reader_client()
            clients.append(client)
            assert object_calls == []
            return client

    boto3 = ModuleType("boto3")
    boto3.session = SimpleNamespace(Session=FakeSession)
    botocore = ModuleType("botocore")
    botocore.__path__ = []
    config = ModuleType("botocore.config")
    config.Config = FakeConfig
    errors = ModuleType("botocore.exceptions")
    errors.BotoCoreError = FakeBotoCoreError
    monkeypatch.setitem(sys.modules, "boto3", boto3)
    monkeypatch.setitem(sys.modules, "botocore", botocore)
    monkeypatch.setitem(sys.modules, "botocore.config", config)
    monkeypatch.setitem(sys.modules, "botocore.exceptions", errors)

    readers = [
        factory.create_private_reference_original_reader(environ=make_settings()) for _ in range(2)
    ]
    assert sessions[0] is not sessions[1] and clients[0] is not clients[1]
    assert readers[0] is not readers[1]
    for session, args, kwargs in calls:
        assert session in sessions and args == ("s3",)
        assert kwargs["endpoint_url"] == FAKE_SETTINGS[ENDPOINT_KEY]
        assert kwargs["aws_access_key_id"] == FAKE_SETTINGS[ACCESS_KEY]
        assert kwargs["aws_secret_access_key"] == FAKE_SETTINGS[SECRET_KEY]
        assert kwargs["region_name"] == "auto"
        assert kwargs["config"].kwargs == {"signature_version": "s3v4"}

    FakeSession.fail = True
    with pytest.raises(ReferenceR2FactoryError) as raised:
        factory.create_private_reference_original_reader(environ=make_settings())
    assert "FAKE_SECRET" not in str(raised.value) and raised.value.__cause__ is None

    real_import = builtins.__import__

    def missing_sdk(name, *args, **kwargs):
        if name == "boto3":
            raise ImportError("FAKE_SECRET import detail")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", missing_sdk)
    with pytest.raises(ReferenceR2FactoryError) as raised:
        factory.create_private_reference_original_reader(environ=make_settings())
    assert "FAKE_SECRET" not in str(raised.value) and raised.value.__cause__ is None
