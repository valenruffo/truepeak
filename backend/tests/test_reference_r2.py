"""Mock-only contract tests for the private, provisional reference staging adapter."""

from __future__ import annotations

from dataclasses import FrozenInstanceError, replace

import pytest

from app.ar_matching.reference_validation import (
    TypedReferenceValidationError,
    validate_reference_upload,
)
from app.services.reference_r2 import (
    PrivateReferenceStagingAdapter,
    ReferenceR2ConfigurationError,
    ReferenceR2InputError,
    ReferenceR2ResponseError,
    StagingObjectVerification,
    StagingPresignedPut,
)

LABEL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
REFERENCE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
PRIVATE_BUCKET = "private-reference-bucket"
LEGACY_BUCKET = "legacy-public-bucket"
ETAG = '"retained-quotes"'


class FakeBody:
    def __init__(self, result: object = b"RIFF1234WAVE", error: Exception | None = None):
        self.result = result
        self.error = error
        self.read_calls: list[int] = []
        self.close_calls = 0

    def read(self, amount: int) -> object:
        self.read_calls.append(amount)
        if self.error:
            raise self.error
        return self.result

    def close(self) -> None:
        self.close_calls += 1


class FakeS3:
    def __init__(self, *, url: object = "https://signed.example/put"):
        self.url = url
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.head: object = {
            "ContentLength": 32,
            "ContentType": "audio/wav",
            "ETag": ETAG,
        }
        self.body = FakeBody()
        self.get_response: object = {"Body": self.body}
        self.presign_error: Exception | None = None
        self.head_error: Exception | None = None
        self.get_error: Exception | None = None

    def generate_presigned_url(
        self,
        ClientMethod: str,  # noqa: N803 - mirror boto3 keyword names
        *,
        Params: dict[str, object],  # noqa: N803 - mirror boto3 keyword names
        ExpiresIn: int,  # noqa: N803 - mirror boto3 keyword names
        HttpMethod: str,  # noqa: N803 - mirror boto3 keyword names
    ) -> object:
        self.calls.append(
            (
                "presign",
                {
                    "ClientMethod": ClientMethod,
                    "Params": Params,
                    "ExpiresIn": ExpiresIn,
                    "HttpMethod": HttpMethod,
                },
            )
        )
        if self.presign_error:
            raise self.presign_error
        return self.url

    def head_object(
        self,
        *,
        Bucket: str,  # noqa: N803 - mirror boto3 keyword names
        Key: str,  # noqa: N803 - mirror boto3 keyword names
    ) -> object:
        self.calls.append(("head", {"Bucket": Bucket, "Key": Key}))
        if self.head_error:
            raise self.head_error
        return self.head

    def get_object(
        self,
        *,
        Bucket: str,  # noqa: N803 - mirror boto3 keyword names
        Key: str,  # noqa: N803 - mirror boto3 keyword names
        Range: str,  # noqa: N803 - mirror boto3 keyword names
        IfMatch: str,  # noqa: N803 - mirror boto3 keyword names
    ) -> object:
        self.calls.append(
            (
                "get",
                {"Bucket": Bucket, "Key": Key, "Range": Range, "IfMatch": IfMatch},
            )
        )
        if self.get_error:
            raise self.get_error
        return self.get_response


def make_adapter(client: FakeS3 | None = None) -> tuple[FakeS3, PrivateReferenceStagingAdapter]:
    sdk = client or FakeS3()
    adapter = PrivateReferenceStagingAdapter(
        sdk,
        private_bucket=PRIVATE_BUCKET,
        legacy_bucket=LEGACY_BUCKET,
        private_access_confirmed=True,
    )
    return sdk, adapter


def make_upload(filename: str = "reference.wav", size: int = 32):
    return validate_reference_upload(filename, size, max_size_bytes=64)


def expected_key(filename: str = "reference.wav") -> str:
    if filename.lower().endswith((".aif", ".aiff")):
        extension = ".aiff"
    else:
        extension = f".{filename.rsplit('.', 1)[-1].lower()}"
    return f"label-references/{LABEL_ID}/{REFERENCE_ID}/staging/original{extension}"


def test_presign_uses_private_derived_key_and_exact_signed_put_contract():
    sdk, adapter = make_adapter()

    result = adapter.presign_put(LABEL_ID, REFERENCE_ID, make_upload(), expires_in_seconds=900)

    assert isinstance(result, StagingPresignedPut)
    assert result.url == "https://signed.example/put"
    assert result.key == expected_key()
    assert result.required_headers == (
        ("Content-Length", "32"),
        ("Content-Type", "audio/wav"),
    )
    assert (
        result.status == "STAGING"
        and result.provisional is True
        and result.ready is False
        and result.final is False
    )
    assert sdk.calls == [
        (
            "presign",
            {
                "ClientMethod": "put_object",
                "Params": {
                    "Bucket": PRIVATE_BUCKET,
                    "Key": expected_key(),
                    "ContentLength": 32,
                    "ContentType": "audio/wav",
                },
                "ExpiresIn": 900,
                "HttpMethod": "PUT",
            },
        )
    ]
    assert "Conditions" not in sdk.calls[0][1]["Params"]
    assert "Fields" not in sdk.calls[0][1]["Params"]
    with pytest.raises(FrozenInstanceError):
        result.key = "other-key"
    with pytest.raises(TypeError):
        result.required_headers[0] = ("Content-Length", "1")


def test_expiry_900_is_inclusive_and_invalid_expiry_never_calls_sdk():
    sdk, adapter = make_adapter()
    adapter.presign_put(LABEL_ID, REFERENCE_ID, make_upload(), expires_in_seconds=900)
    sdk.calls.clear()

    for expiry in (0, -1, 901, True, False, 1.0, "900", None):
        with pytest.raises(ReferenceR2InputError):
            adapter.presign_put(LABEL_ID, REFERENCE_ID, make_upload(), expires_in_seconds=expiry)
    assert sdk.calls == []


@pytest.mark.parametrize("value", [None, "", " ", 42, b"url"])
def test_invalid_sdk_url_is_a_typed_response_error(value):
    sdk, adapter = make_adapter(FakeS3(url=value))

    with pytest.raises(ReferenceR2ResponseError):
        adapter.presign_put(LABEL_ID, REFERENCE_ID, make_upload())
    assert [name for name, _ in sdk.calls] == ["presign"]


@pytest.mark.parametrize(
    ("private_bucket", "legacy_bucket", "confirmed"),
    [
        ("", LEGACY_BUCKET, True),
        (" ", LEGACY_BUCKET, True),
        (" private", LEGACY_BUCKET, True),
        ("private\n", LEGACY_BUCKET, True),
        (1, LEGACY_BUCKET, True),
        (PRIVATE_BUCKET, "", True),
        (PRIVATE_BUCKET, "legacy\t", True),
        (PRIVATE_BUCKET, PRIVATE_BUCKET, True),
        (PRIVATE_BUCKET, LEGACY_BUCKET, False),
        (PRIVATE_BUCKET, LEGACY_BUCKET, None),
        (PRIVATE_BUCKET, LEGACY_BUCKET, 1),
        (PRIVATE_BUCKET, LEGACY_BUCKET, "true"),
    ],
)
def test_configuration_fails_closed_before_any_sdk_call(private_bucket, legacy_bucket, confirmed):
    sdk = FakeS3()
    with pytest.raises(ReferenceR2ConfigurationError):
        PrivateReferenceStagingAdapter(
            sdk,
            private_bucket=private_bucket,
            legacy_bucket=legacy_bucket,
            private_access_confirmed=confirmed,
        )
    assert sdk.calls == []


def test_missing_client_is_a_typed_configuration_error():
    with pytest.raises(ReferenceR2ConfigurationError):
        PrivateReferenceStagingAdapter(
            None,
            private_bucket=PRIVATE_BUCKET,
            legacy_bucket=LEGACY_BUCKET,
            private_access_confirmed=True,
        )


@pytest.mark.parametrize(
    "label_id,reference_id",
    [
        (True, REFERENCE_ID),
        (None, REFERENCE_ID),
        (LABEL_ID.upper(), REFERENCE_ID),
        ("{" + LABEL_ID + "}", REFERENCE_ID),
        (LABEL_ID, False),
        (LABEL_ID, None),
        (LABEL_ID, REFERENCE_ID.upper()),
        (LABEL_ID, "not-a-uuid"),
    ],
)
def test_uuid_inputs_must_be_exact_canonical_uuid_strings(label_id, reference_id):
    sdk, adapter = make_adapter()

    with pytest.raises(ReferenceR2InputError):
        adapter.presign_put(label_id, reference_id, make_upload())
    assert sdk.calls == []


@pytest.mark.parametrize(
    "forged",
    [
        lambda upload: replace(upload, filename="../reference.wav"),
        lambda upload: replace(upload, canonical_extension=".flac"),
        lambda upload: replace(upload, canonical_mime="audio/FLAC"),
        lambda upload: replace(upload, size_bytes=True),
        lambda upload: replace(upload, effective_limit_bytes=True),
        lambda upload: replace(upload, size_bytes=33, effective_limit_bytes=32),
        lambda upload: replace(upload, effective_limit_bytes=201 * 1024 * 1024),
        lambda upload: replace(upload, filename="reference.wav "),
    ],
)
def test_revalidates_every_canonical_descriptor_field_before_sdk(forged):
    sdk, adapter = make_adapter()

    with pytest.raises(ReferenceR2InputError):
        adapter.presign_put(LABEL_ID, REFERENCE_ID, forged(make_upload()))
    assert sdk.calls == []


def test_non_descriptor_and_header_validator_errors_are_typed_adapter_inputs():
    sdk, adapter = make_adapter()
    with pytest.raises(ReferenceR2InputError):
        adapter.presign_put(LABEL_ID, REFERENCE_ID, object())
    assert sdk.calls == []

    with pytest.raises(TypedReferenceValidationError):
        validate_reference_upload("reference.wav", True)


def test_staging_key_uses_canonical_extension_not_raw_filename():
    sdk, adapter = make_adapter()

    result = adapter.presign_put(LABEL_ID, REFERENCE_ID, make_upload("SAMPLE.AIF", 32))

    assert result.key == expected_key("SAMPLE.AIF")
    assert "SAMPLE" not in result.key
    assert [name for name, _ in sdk.calls] == ["presign"]


@pytest.mark.parametrize(
    ("head", "expected_error"),
    [
        (
            {"ContentLength": True, "ContentType": "audio/wav", "ETag": ETAG},
            ReferenceR2ResponseError,
        ),
        (
            {"ContentLength": 32.0, "ContentType": "audio/wav", "ETag": ETAG},
            ReferenceR2ResponseError,
        ),
        ({"ContentLength": 31, "ContentType": "audio/wav", "ETag": ETAG}, ReferenceR2ResponseError),
        ({"ContentLength": 32, "ContentType": "audio/WAV", "ETag": ETAG}, ReferenceR2ResponseError),
        ({"ContentLength": 32, "ContentType": "", "ETag": ETAG}, ReferenceR2ResponseError),
        ({"ContentLength": 32, "ContentType": "audio/wav", "ETag": ""}, ReferenceR2ResponseError),
        ({"ContentLength": 32, "ContentType": "audio/wav"}, ReferenceR2ResponseError),
        (None, ReferenceR2ResponseError),
    ],
)
def test_head_rejects_bad_metadata_before_range_get(head, expected_error):
    sdk, adapter = make_adapter()
    sdk.head = head

    with pytest.raises(expected_error):
        adapter.verify_uploaded_reference(LABEL_ID, REFERENCE_ID, make_upload())
    assert [name for name, _ in sdk.calls] == ["head"]


@pytest.mark.parametrize(
    ("filename", "prefix", "size", "content_type"),
    [
        ("ref.wav", b"RIFF1234WAVE", 12, "audio/wav"),
        ("ref.aiff", b"FORM1234AIFF", 12, "audio/aiff"),
        ("ref.aif", b"FORM1234AIFC", 12, "audio/aiff"),
        ("ref.flac", b"fLaC\x00\x00\x00\x22", 8, "audio/flac"),
    ],
)
def test_verifies_bounded_prefix_for_all_supported_audio_formats(
    filename, prefix, size, content_type
):
    sdk, adapter = make_adapter()
    upload = make_upload(filename, size)
    sdk.head = {"ContentLength": size, "ContentType": content_type, "ETag": ETAG}
    sdk.body = FakeBody(prefix)
    sdk.get_response = {"Body": sdk.body}

    result = adapter.verify_uploaded_reference(LABEL_ID, REFERENCE_ID, upload)

    key = expected_key(filename)
    assert isinstance(result, StagingObjectVerification)
    assert result.key == key
    assert result.content_length == size
    assert result.content_type == content_type
    assert result.etag == ETAG
    assert (
        result.status == "STAGING"
        and result.provisional is True
        and result.ready is False
        and result.final is False
    )
    assert sdk.calls == [
        ("head", {"Bucket": PRIVATE_BUCKET, "Key": key}),
        (
            "get",
            {"Bucket": PRIVATE_BUCKET, "Key": key, "Range": "bytes=0-11", "IfMatch": ETAG},
        ),
    ]
    assert sdk.body.read_calls == [12]
    assert sdk.body.close_calls == 1
    with pytest.raises(FrozenInstanceError):
        result.etag = "changed"


@pytest.mark.parametrize(
    "prefix",
    [b"RIFF", b"NOPE1234WAVE", b"RIFF1234AVI "],
)
def test_invalid_or_short_header_is_rejected_and_body_is_closed(prefix):
    sdk, adapter = make_adapter()
    sdk.body = FakeBody(prefix)
    sdk.get_response = {"Body": sdk.body}

    with pytest.raises(TypedReferenceValidationError):
        adapter.verify_uploaded_reference(LABEL_ID, REFERENCE_ID, make_upload())
    assert sdk.body.read_calls == [12]
    assert sdk.body.close_calls == 1


@pytest.mark.parametrize(
    "body_value", [b"x" * 13, bytearray(b"RIFF1234WAVE"), "RIFF1234WAVE", None]
)
def test_rejects_oversized_or_non_bytes_range_read_and_closes_body(body_value):
    sdk, adapter = make_adapter()
    sdk.body = FakeBody(body_value)
    sdk.get_response = {"Body": sdk.body}

    with pytest.raises(ReferenceR2ResponseError):
        adapter.verify_uploaded_reference(LABEL_ID, REFERENCE_ID, make_upload())
    assert sdk.body.read_calls == [12]
    assert sdk.body.close_calls == 1


def test_missing_body_is_a_typed_error_after_head_and_get():
    sdk, adapter = make_adapter()
    sdk.get_response = {}

    with pytest.raises(ReferenceR2ResponseError):
        adapter.verify_uploaded_reference(LABEL_ID, REFERENCE_ID, make_upload())
    assert [name for name, _ in sdk.calls] == ["head", "get"]


def test_body_without_close_method_is_supported_and_header_is_still_checked():
    class BodyWithoutClose:
        def read(self, amount: int) -> bytes:
            assert amount == 12
            return b"RIFF1234WAVE"

    sdk, adapter = make_adapter()
    sdk.get_response = {"Body": BodyWithoutClose()}

    result = adapter.verify_uploaded_reference(LABEL_ID, REFERENCE_ID, make_upload())

    assert result.status == "STAGING"


def test_sdk_and_body_read_exceptions_propagate_unchanged():
    sdk, adapter = make_adapter()
    sdk.presign_error = RuntimeError("presign sdk failure")
    with pytest.raises(RuntimeError, match="presign sdk failure"):
        adapter.presign_put(LABEL_ID, REFERENCE_ID, make_upload())

    sdk, adapter = make_adapter()
    sdk.head_error = RuntimeError("head sdk failure")
    with pytest.raises(RuntimeError, match="head sdk failure"):
        adapter.verify_uploaded_reference(LABEL_ID, REFERENCE_ID, make_upload())
    assert [name for name, _ in sdk.calls] == ["head"]

    sdk, adapter = make_adapter()
    sdk.get_error = RuntimeError("get sdk failure")
    with pytest.raises(RuntimeError, match="get sdk failure"):
        adapter.verify_uploaded_reference(LABEL_ID, REFERENCE_ID, make_upload())
    assert [name for name, _ in sdk.calls] == ["head", "get"]

    sdk, adapter = make_adapter()
    read_error = RuntimeError("body read failure")
    sdk.body = FakeBody(error=read_error)
    sdk.get_response = {"Body": sdk.body}
    with pytest.raises(RuntimeError) as raised:
        adapter.verify_uploaded_reference(LABEL_ID, REFERENCE_ID, make_upload())
    assert raised.value is read_error
    assert sdk.body.close_calls == 1


def test_metadata_response_types_must_be_exact_strings_and_positive_exact_int():
    sdk, adapter = make_adapter()
    sdk.head = {"ContentLength": 0, "ContentType": "audio/wav", "ETag": ETAG}
    with pytest.raises(ReferenceR2ResponseError):
        adapter.verify_uploaded_reference(LABEL_ID, REFERENCE_ID, make_upload())
    sdk.head = {"ContentLength": 32, "ContentType": b"audio/wav", "ETag": ETAG}
    with pytest.raises(ReferenceR2ResponseError):
        adapter.verify_uploaded_reference(LABEL_ID, REFERENCE_ID, make_upload())
    sdk.head = {"ContentLength": 32, "ContentType": "audio/wav", "ETag": 123}
    with pytest.raises(ReferenceR2ResponseError):
        adapter.verify_uploaded_reference(LABEL_ID, REFERENCE_ID, make_upload())


def test_staging_adapter_documents_mutability_and_does_not_claim_finalization():
    _, adapter = make_adapter()
    assert "replay" in type(adapter).__doc__.lower()
    assert "privacy" in type(adapter).__doc__.lower()
    assert "not ready" in type(adapter).__doc__.lower()
