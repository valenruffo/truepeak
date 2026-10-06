"""Conditional private reference copy tests; all provider behavior is mocked."""

from __future__ import annotations

from dataclasses import replace
from functools import lru_cache
from pathlib import Path
from types import SimpleNamespace

import pytest
from botocore import BOTOCORE_ROOT
from botocore.auth import S3SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials
from botocore.loaders import Loader
from botocore.model import ServiceModel
from botocore.serialize import create_serializer

from app.ar_matching.reference_validation import validate_reference_upload
from app.services.reference_r2 import ReferenceR2ConfigurationError, ReferenceR2InputError
from app.services.reference_r2_promotion import (
    FinalReferencePromotion,
    PrivateReferenceR2PromotionAdapter,
    ReferenceR2PreconditionError,
    ReferenceR2PromotionProviderError,
    ReferenceR2ResponseError,
)

LABEL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
REFERENCE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
REFERENCE_PREFIX = f"label-references/{LABEL_ID}/{REFERENCE_ID}"
STAGING_KEY = f"{REFERENCE_PREFIX}/staging/original.wav"
FINAL_KEY = f"{REFERENCE_PREFIX}/original.wav"
PRIVATE_BUCKET = "private-reference-bucket"
LEGACY_BUCKET = "legacy-public-bucket"
SOURCE_ETAG = '"Opaque-MiXeD-source-tag"'
FINAL_ETAG = '"opaque-final-tag"'
EVENT = "before-call.s3.CopyObject"
DEST_HEADER = "cf-copy-destination-if-none-match"
UPPER_DEST_HEADER = DEST_HEADER.upper()
SOURCE_CONDITION = "x-amz-copy-source-if-match"


class FakeEvents:
    def __init__(self) -> None:
        self.handlers: dict[str, list[object]] = {}
        self.register_calls: list[tuple[str, object]] = []
        self.register_error: Exception | None = None

    def register(self, event_name: str, handler: object) -> None:
        if self.register_error:
            raise self.register_error
        self.register_calls.append((event_name, handler))
        self.handlers.setdefault(event_name, []).append(handler)

    def emit(self, event_name: str, params: object) -> None:
        for handler in self.handlers.get(event_name, []):
            handler(params, model=object(), context={})


class FakeCopyClient:
    def __init__(self) -> None:
        self.meta = SimpleNamespace(events=FakeEvents())
        self.meta.config = SimpleNamespace(signature_version="s3v4")
        self.calls: list[dict[str, object]] = []
        self.response: object = {
            "ResponseMetadata": {"HTTPStatusCode": 200},
            "CopyObjectResult": {"ETag": FINAL_ETAG},
        }
        self.error: Exception | None = None
        self.before_call_params: object = {"headers": {}}
        self.last_headers: object = None

    def copy_object(self, **params: object) -> object:
        self.meta.events.emit(EVENT, self.before_call_params)
        self.last_headers = self.before_call_params.get("headers")
        self.calls.append(params)
        if self.error:
            raise self.error
        return self.response


def make_upload(filename: str = "reference.wav", size: int = 32):
    return validate_reference_upload(filename, size, max_size_bytes=64)


def make_adapter(client: FakeCopyClient | None = None):
    sdk = client or FakeCopyClient()
    adapter = PrivateReferenceR2PromotionAdapter(
        sdk,
        private_bucket=PRIVATE_BUCKET,
        legacy_bucket=LEGACY_BUCKET,
        private_access_confirmed=True,
    )
    return sdk, adapter


def promote(adapter, *, etag: str = SOURCE_ETAG, upload=None):
    return adapter.promote(LABEL_ID, REFERENCE_ID, upload or make_upload(), etag)


def assert_no_sdk_calls(sdk):
    assert sdk.meta.events.register_calls == []
    assert sdk.calls == []


def test_promotion_is_lazy_and_uses_only_private_derived_keys_and_conditions():
    sdk, adapter = make_adapter()
    assert_no_sdk_calls(sdk)

    result = promote(adapter, etag=SOURCE_ETAG)

    assert result == FinalReferencePromotion(FINAL_KEY, FINAL_ETAG)
    assert sdk.calls == [
        {
            "Bucket": PRIVATE_BUCKET,
            "Key": FINAL_KEY,
            "CopySource": f"/{PRIVATE_BUCKET}/{STAGING_KEY}",
            "CopySourceIfMatch": SOURCE_ETAG,
        }
    ]
    assert sdk.meta.events.register_calls[0][0] == EVENT
    assert sdk.last_headers == {DEST_HEADER: "*"}
    assert result.final_key != STAGING_KEY
    assert not hasattr(result, "ready")
    with pytest.raises((AttributeError, TypeError)):
        result.final_key = "changed"


def test_hook_registers_once_and_stays_scoped_to_copy_object():
    sdk, adapter = make_adapter()
    promote(adapter)
    promote(adapter, etag='"another-exact-etag"')

    assert [event for event, _ in sdk.meta.events.register_calls] == [EVENT]
    assert len(sdk.calls) == 2
    assert all(call["CopySourceIfMatch"] for call in sdk.calls)
    assert sdk.last_headers == {DEST_HEADER: "*"}


@pytest.mark.parametrize(
    "label_id,reference_id",
    [
        (None, REFERENCE_ID),
        (LABEL_ID.upper(), REFERENCE_ID),
        ("{" + LABEL_ID + "}", REFERENCE_ID),
        (LABEL_ID, "not-a-uuid"),
        (LABEL_ID, REFERENCE_ID.upper()),
        (True, REFERENCE_ID),
    ],
)
def test_noncanonical_identity_fails_before_hook_or_copy(label_id, reference_id):
    sdk, adapter = make_adapter()
    with pytest.raises(ReferenceR2InputError):
        adapter.promote(label_id, reference_id, make_upload(), SOURCE_ETAG)
    assert_no_sdk_calls(sdk)


@pytest.mark.parametrize(
    "etag",
    [None, "", " ", " padded ", "bad\r\nheader", "bad\x00tag", "bad\x7ftag", "snowman-☃"],
)
def test_invalid_or_header_unsafe_etag_fails_before_sdk(etag):
    sdk, adapter = make_adapter()
    with pytest.raises(ReferenceR2InputError):
        promote(adapter, etag=etag)
    assert_no_sdk_calls(sdk)


def test_valid_opaque_etag_is_passed_byte_for_byte_without_interpretation():
    sdk, adapter = make_adapter()
    opaque = '"not-an-md5-or-version"'

    promote(adapter, etag=opaque)

    assert sdk.calls[0]["CopySourceIfMatch"] == opaque


@pytest.mark.parametrize(
    "forged",
    [
        lambda upload: replace(upload, filename="../x.wav"),
        lambda upload: replace(upload, canonical_extension=".flac"),
        lambda upload: replace(upload, canonical_mime="audio/FLAC"),
        lambda upload: replace(upload, size_bytes=True),
        lambda upload: replace(upload, size_bytes=65),
        lambda upload: replace(upload, effective_limit_bytes=201 * 1024 * 1024),
    ],
)
def test_forged_upload_descriptor_fails_before_sdk(forged):
    sdk, adapter = make_adapter()
    with pytest.raises(ReferenceR2InputError):
        promote(adapter, upload=forged(make_upload()))
    assert_no_sdk_calls(sdk)


@pytest.mark.parametrize(
    "private_bucket,legacy_bucket,confirmed",
    [
        ("", LEGACY_BUCKET, True),
        (" bad/name", LEGACY_BUCKET, True),
        (PRIVATE_BUCKET, PRIVATE_BUCKET, True),
        (PRIVATE_BUCKET, LEGACY_BUCKET, False),
        (PRIVATE_BUCKET, LEGACY_BUCKET, 1),
    ],
)
def test_invalid_bucket_boundary_or_missing_attestation_fails_closed(
    private_bucket, legacy_bucket, confirmed
):
    sdk = FakeCopyClient()
    with pytest.raises(ReferenceR2ConfigurationError):
        PrivateReferenceR2PromotionAdapter(
            sdk,
            private_bucket=private_bucket,
            legacy_bucket=legacy_bucket,
            private_access_confirmed=confirmed,
        )
    assert_no_sdk_calls(sdk)


def test_missing_hook_capability_or_registration_failure_never_copies():
    sdk = FakeCopyClient()
    sdk.meta.events.register = None
    _, adapter = make_adapter(sdk)
    with pytest.raises(ReferenceR2ConfigurationError):
        promote(adapter)
    assert_no_sdk_calls(sdk)

    sdk = FakeCopyClient()
    sdk.meta.config.signature_version = None
    _, adapter = make_adapter(sdk)
    with pytest.raises(ReferenceR2ConfigurationError):
        promote(adapter)
    assert_no_sdk_calls(sdk)

    sdk = FakeCopyClient()
    sdk.meta.events.register_error = RuntimeError("secret SDK details")
    _, adapter = make_adapter(sdk)
    with pytest.raises(ReferenceR2ConfigurationError) as raised:
        promote(adapter)
    assert "secret SDK details" not in str(raised.value)
    assert sdk.calls == []


def test_hook_rejects_malformed_or_conflicting_headers_before_copy():
    for headers in (None, [], {DEST_HEADER: "wrong"}, {UPPER_DEST_HEADER: "*"}):
        sdk = FakeCopyClient()
        sdk.before_call_params = {"headers": headers}
        _, adapter = make_adapter(sdk)
        with pytest.raises(ReferenceR2ConfigurationError):
            promote(adapter)
        assert sdk.calls == []


def _precondition_error(status: int, code: str) -> RuntimeError:
    error = RuntimeError("secret request id and credential detail")
    error.response = {
        "Error": {"Code": code, "Message": "private object details"},
        "ResponseMetadata": {"HTTPStatusCode": status},
    }
    return error


@pytest.mark.parametrize(
    "status,code",
    [(412, "OtherCode"), (409, "PreconditionFailed")],
)
def test_source_or_destination_precondition_is_generic_and_redacted(status, code):
    sdk, adapter = make_adapter()
    sdk.error = _precondition_error(status, code)

    with pytest.raises(ReferenceR2PreconditionError) as raised:
        promote(adapter)

    assert "secret" not in str(raised.value)
    assert "source" not in str(raised.value).lower()
    assert "destination" not in str(raised.value).lower()
    assert raised.value.__cause__ is None
    assert len(sdk.calls) == 1


def test_unrelated_provider_failure_is_redacted_and_never_returns_success():
    sdk, adapter = make_adapter()
    sdk.error = RuntimeError("secret token and raw response")

    with pytest.raises(ReferenceR2PromotionProviderError) as raised:
        promote(adapter)

    assert "secret token" not in str(raised.value)
    assert raised.value.__cause__ is None
    assert len(sdk.calls) == 1


@pytest.mark.parametrize(
    "response",
    [
        None,
        {},
        {"ResponseMetadata": {"HTTPStatusCode": 200}, "Error": {"Code": "Error"}},
        {"ResponseMetadata": {"HTTPStatusCode": 200}},
        {"ResponseMetadata": {"HTTPStatusCode": 201}, "CopyObjectResult": {"ETag": FINAL_ETAG}},
        {"ResponseMetadata": {"HTTPStatusCode": True}, "CopyObjectResult": {"ETag": FINAL_ETAG}},
        {"ResponseMetadata": {"HTTPStatusCode": 200}, "CopyObjectResult": {}},
        {"ResponseMetadata": {"HTTPStatusCode": 200}, "CopyObjectResult": {"ETag": "bad\r\nvalue"}},
    ],
)
def test_malformed_or_embedded_error_copy_responses_never_succeed(response):
    sdk, adapter = make_adapter()
    sdk.response = response

    with pytest.raises(ReferenceR2ResponseError):
        promote(adapter)

    assert len(sdk.calls) == 1


@lru_cache(maxsize=1)
def _copy_object_model():
    loader = Loader(
        extra_search_paths=[str(Path(BOTOCORE_ROOT) / "data")],
        include_default_search_paths=False,
        include_default_extras=False,
    )
    data = loader.load_service_model("s3", "service-2", api_version="2006-03-01")
    model = ServiceModel(data, service_name="s3")
    return model, model.operation_model("CopyObject")


class ModelSigningCopyClient(FakeCopyClient):
    def copy_object(self, **params: object) -> object:
        model, operation = _copy_object_model()
        serialized = create_serializer(model.metadata["protocol"]).serialize_to_request(
            params, operation
        )
        serialized["url"] = "https://synthetic.r2.invalid" + serialized["url_path"]
        self.meta.events.emit(EVENT, serialized)
        self.last_headers = serialized["headers"]
        request = AWSRequest(
            method=serialized["method"],
            url=serialized["url"],
            data=serialized["body"],
            headers=serialized["headers"],
        )
        signer = S3SigV4Auth(Credentials("SYNTHETICACCESS", "synthetic-secret"), "s3", "auto")
        signer.add_auth(request)
        signed_headers = request.headers["Authorization"].partition("SignedHeaders=")[2]
        self.signed_headers = signed_headers.partition(",")[0]
        self.serialized_headers = dict(request.headers)
        self.calls.append(params)
        return self.response


def test_registered_hook_survives_real_botocore_copy_serialization_and_sigv4_signing():
    sdk = ModelSigningCopyClient()
    _, adapter = make_adapter(sdk)

    promote(adapter)

    signed = set(sdk.signed_headers.split(";"))
    assert sdk.serialized_headers[SOURCE_CONDITION] == SOURCE_ETAG
    assert sdk.serialized_headers[DEST_HEADER] == "*"
    assert SOURCE_CONDITION in signed
    assert DEST_HEADER in signed
    assert sdk.serialized_headers["x-amz-copy-source"] == f"/{PRIVATE_BUCKET}/{STAGING_KEY}"
    assert "CopySourceIfMatch" in _copy_object_model()[1].input_shape.members
    assert sdk.calls[0]["CopySourceIfMatch"] == SOURCE_ETAG
