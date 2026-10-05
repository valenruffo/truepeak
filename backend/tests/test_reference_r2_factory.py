"""Mock-only tests for lazy configuration of the private R2 staging adapter."""

from __future__ import annotations

import builtins
import importlib.util
import sys
from types import ModuleType

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
