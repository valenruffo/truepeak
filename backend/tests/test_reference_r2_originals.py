"""Contract tests for bounded reads of retained private reference originals."""

from __future__ import annotations

from dataclasses import replace

import pytest

from app.ar_matching.reference_validation import validate_reference_upload
from app.services.reference_r2 import (
    ReferenceR2ConfigurationError,
    ReferenceR2InputError,
    ReferenceR2ResponseError,
)
from app.services.reference_r2_originals import PrivateReferenceOriginalReader

OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
REFERENCE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
PRIVATE_BUCKET = "private-reference-bucket"
LEGACY_BUCKET = "legacy-public-bucket"
FINAL_ETAG = '"opaque-retained-etag"'


class FakeBody:
    def __init__(
        self,
        data: object = b"raw original bytes",
        *,
        max_chunk: int = 3,
        error: Exception | None = None,
        close_error: Exception | None = None,
        ignore_amount: bool = False,
        no_read: bool = False,
        no_close: bool = False,
    ):
        self.data = data
        self.max_chunk = max_chunk
        self.error = error
        self.close_error = close_error
        self.ignore_amount = ignore_amount
        self.read_calls: list[int] = []
        self.offset = 0
        self.close_calls = 0
        if no_read:
            self.read = None
        if no_close:
            self.close = None

    def read(self, amount: int) -> object:
        self.read_calls.append(amount)
        if self.error:
            raise self.error
        if type(self.data) is not bytes:
            return self.data
        end = (
            len(self.data)
            if self.ignore_amount
            else min(len(self.data), self.offset + min(amount, self.max_chunk))
        )
        result = self.data[self.offset : end]
        self.offset = end
        return result

    def close(self) -> None:
        self.close_calls += 1
        if self.close_error:
            raise self.close_error


class FakeS3:
    def __init__(self):
        self.calls: list[dict[str, object]] = []
        self.body = FakeBody()
        self.response: object = {}
        self.error: Exception | None = None

    def get_object(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.response


def make_reader(client: FakeS3 | None = None):
    sdk = client or FakeS3()
    reader = PrivateReferenceOriginalReader(
        sdk,
        private_bucket=PRIVATE_BUCKET,
        legacy_bucket=LEGACY_BUCKET,
        private_access_confirmed=True,
    )
    return sdk, reader


def make_upload(filename: str = "reference.wav", size: int = 18, limit: int = 64):
    return validate_reference_upload(filename, size, max_size_bytes=limit)


def set_response(sdk: FakeS3, *, data: object = b"raw original bytes", **metadata: object):
    sdk.body = FakeBody(data)
    sdk.response = {"Body": sdk.body, **metadata}


@pytest.mark.parametrize(
    ("private", "legacy", "confirmed"),
    [
        ("private-reference-bucket", "private-reference-bucket", True),
        ("Bad_Bucket", LEGACY_BUCKET, True),
        ("private-reference-bucket", "legacy-public-bucket", False),
        ("private-reference-bucket", "legacy-public-bucket", 1),
        ("private-reference-bucket", "legacy-public-bucket", None),
    ],
)
def test_configuration_faults_are_rejected_before_any_request(private, legacy, confirmed):
    sdk = FakeS3()
    with pytest.raises(ReferenceR2ConfigurationError):
        PrivateReferenceOriginalReader(
            sdk,
            private_bucket=private,
            legacy_bucket=legacy,
            private_access_confirmed=confirmed,
        )
    assert sdk.calls == []


def test_missing_injected_client_is_a_configuration_error():
    with pytest.raises(ReferenceR2ConfigurationError):
        PrivateReferenceOriginalReader(
            None,
            private_bucket=PRIVATE_BUCKET,
            legacy_bucket=LEGACY_BUCKET,
            private_access_confirmed=True,
        )


@pytest.mark.parametrize(
    ("filename", "mime", "extension"),
    [
        ("reference.wav", "audio/wav", ".wav"),
        ("reference.aif", "audio/aiff", ".aiff"),
        ("reference.flac", "audio/flac", ".flac"),
    ],
)
def test_returns_raw_immutable_bytes_from_one_exact_final_get(filename, mime, extension):
    sdk, reader = make_reader()
    payload = b"raw-original-not-decoded"
    upload = make_upload(filename, len(payload))
    set_response(
        sdk,
        data=payload,
        ContentLength=len(payload),
        ContentType=mime,
        ETag=FINAL_ETAG,
        ResponseMetadata={"HTTPStatusCode": 200},
    )

    result = reader.read_original(OWNER_ID, REFERENCE_ID, upload, FINAL_ETAG)

    assert type(result) is bytes and result == payload
    assert sdk.calls == [
        {
            "Bucket": PRIVATE_BUCKET,
            "Key": f"label-references/{OWNER_ID}/{REFERENCE_ID}/original{extension}",
            "IfMatch": FINAL_ETAG,
        }
    ]
    assert "Range" not in sdk.calls[0]
    assert all(amount > 0 for amount in sdk.body.read_calls)
    assert max(sdk.body.read_calls) <= len(payload)
    assert sdk.body.read_calls[-1] == 1
    assert sdk.body.close_calls == 1
    with pytest.raises(TypeError):
        result[0] = 0


@pytest.mark.parametrize(
    ("owner", "reference", "etag"),
    [
        ("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", REFERENCE_ID, FINAL_ETAG),
        (OWNER_ID, "not-a-uuid", FINAL_ETAG),
        (OWNER_ID, REFERENCE_ID, "  " + FINAL_ETAG),
        (OWNER_ID, REFERENCE_ID, FINAL_ETAG + "\n"),
        (OWNER_ID, REFERENCE_ID, "é" + FINAL_ETAG),
    ],
)
def test_noncanonical_identity_or_unsafe_etag_fails_before_get(owner, reference, etag):
    sdk, reader = make_reader()
    with pytest.raises(ReferenceR2InputError):
        reader.read_original(owner, reference, make_upload(), etag)
    assert sdk.calls == []


@pytest.mark.parametrize(
    "upload",
    [
        replace(make_upload(), canonical_extension=".flac"),
        replace(make_upload(), canonical_mime="audio/flac"),
        replace(make_upload(), effective_limit_bytes=0),
        replace(make_upload(), size_bytes=0),
        replace(make_upload(), filename="../reference.wav"),
    ],
)
def test_forged_or_changed_upload_descriptor_fails_before_get(upload):
    sdk, reader = make_reader()
    with pytest.raises(ReferenceR2InputError):
        reader.read_original(OWNER_ID, REFERENCE_ID, upload, FINAL_ETAG)
    assert sdk.calls == []


@pytest.mark.parametrize(
    "metadata",
    [
        {"ContentLength": True, "ContentType": "audio/wav", "ETag": FINAL_ETAG},
        {"ContentLength": 17, "ContentType": "audio/wav", "ETag": FINAL_ETAG},
        {"ContentLength": 18, "ContentType": "audio/flac", "ETag": FINAL_ETAG},
        {"ContentLength": 18, "ContentType": "audio/wav", "ETag": '"other"'},
        {"ContentLength": 18, "ContentType": "audio/wav", "ETag": "bad\netag"},
        {
            "ContentLength": 18,
            "ContentType": "audio/wav",
            "ETag": FINAL_ETAG,
            "ResponseMetadata": {"HTTPStatusCode": 206},
        },
        {
            "ContentLength": 18,
            "ContentType": "audio/wav",
            "ETag": FINAL_ETAG,
            "ContentRange": "bytes 0-17/18",
        },
    ],
)
def test_invalid_full_object_metadata_closes_body(metadata):
    sdk, reader = make_reader()
    set_response(sdk, **metadata)

    with pytest.raises(ReferenceR2ResponseError):
        reader.read_original(OWNER_ID, REFERENCE_ID, make_upload(), FINAL_ETAG)
    assert sdk.body.close_calls == 1


@pytest.mark.parametrize(
    ("body_options", "response_body"),
    [
        ({"data": b"short"}, True),
        ({"data": bytearray(b"raw original bytes")}, True),
        ({"data": "raw original bytes"}, True),
        ({"data": None}, True),
        ({"data": b"too long for requested amount", "ignore_amount": True}, True),
        ({"error": RuntimeError("secret body failure")}, True),
        ({"no_read": True}, True),
        ({"no_close": True}, False),
        ({"close_error": RuntimeError("secret close failure")}, True),
    ],
)
def test_body_faults_fail_closed_and_never_return_partial_bytes(body_options, response_body):
    sdk, reader = make_reader()
    sdk.body = FakeBody(**body_options)
    sdk.response = {
        "Body": sdk.body,
        "ContentLength": 18,
        "ContentType": "audio/wav",
        "ETag": FINAL_ETAG,
    }

    with pytest.raises(ReferenceR2ResponseError) as raised:
        reader.read_original(OWNER_ID, REFERENCE_ID, make_upload(), FINAL_ETAG)

    assert "secret" not in str(raised.value)
    assert len(sdk.calls) == 1
    assert sdk.body.close_calls == int(response_body)
    if not body_options.get("no_read") and response_body:
        assert sdk.body.read_calls
    assert all(amount <= 18 for amount in sdk.body.read_calls)


def test_missing_response_body_and_provider_precondition_are_typed_and_single_attempt():
    sdk, reader = make_reader()
    sdk.response = {"ContentLength": 18}
    with pytest.raises(ReferenceR2ResponseError):
        reader.read_original(OWNER_ID, REFERENCE_ID, make_upload(), FINAL_ETAG)
    assert sdk.calls == [
        {
            "Bucket": PRIVATE_BUCKET,
            "Key": f"label-references/{OWNER_ID}/{REFERENCE_ID}/original.wav",
            "IfMatch": FINAL_ETAG,
        }
    ]

    class ProviderFailureError(Exception):
        response = {
            "Error": {"Code": "PreconditionFailed", "Message": "secret provider detail"},
            "ResponseMetadata": {"HTTPStatusCode": 412},
        }

    sdk.calls.clear()
    sdk.error = ProviderFailureError("secret exception text")
    with pytest.raises(ReferenceR2ResponseError) as raised:
        reader.read_original(OWNER_ID, REFERENCE_ID, make_upload(), FINAL_ETAG)
    assert "secret" not in str(raised.value)
    assert len(sdk.calls) == 1
