"""Standalone, bounded reads of retained private reference originals.

This adapter performs no owner lookup or lifecycle transition. Its caller must
first authorize the active owner/reference and load the persisted canonical
upload descriptor and final ETag. Bucket attestation is an operator assertion,
not proof of privacy; the injected, caller-owned client must already be
configured for SigV4. This module creates no client and is not production-wired.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol
from uuid import UUID

from app.ar_matching.reference_validation import (
    TypedReferenceValidationError,
    ValidatedReferenceUpload,
    validate_reference_upload,
)
from app.services.reference_r2 import (
    ReferenceR2ConfigurationError,
    ReferenceR2InputError,
    ReferenceR2ResponseError,
)

_ABSOLUTE_LIMIT_BYTES = 200 * 1024 * 1024
_READ_CHUNK_BYTES = 64 * 1024


class FinalOriginalS3Client(Protocol):
    """The one SDK operation this adapter can invoke."""

    def get_object(
        self,
        *,
        Bucket: str,  # noqa: N803 - boto3 keyword names are case-sensitive
        Key: str,  # noqa: N803 - boto3 keyword names are case-sensitive
        IfMatch: str,  # noqa: N803 - boto3 keyword names are case-sensitive
    ) -> object: ...


class PrivateReferenceOriginalReader:
    """Fetch raw bytes from one derived final key using an exact ETag condition.

    The confirmation flag does not establish bucket privacy, client isolation,
    object ownership, or processing readiness. The caller owns the injected
    client and must perform authorization and persisted-final-identity checks.
    """

    def __init__(
        self,
        s3_client: FinalOriginalS3Client,
        *,
        private_bucket: str,
        legacy_bucket: str,
        private_access_confirmed: bool = False,
    ) -> None:
        if s3_client is None or not callable(getattr(s3_client, "get_object", None)):
            raise ReferenceR2ConfigurationError("an injected S3 get_object client is required")
        if type(private_access_confirmed) is not bool or not private_access_confirmed:
            raise ReferenceR2ConfigurationError("private bucket access must be confirmed")
        self._private_bucket = self._validate_bucket(private_bucket, "private_bucket")
        self._legacy_bucket = self._validate_bucket(legacy_bucket, "legacy_bucket")
        if self._private_bucket == self._legacy_bucket:
            raise ReferenceR2ConfigurationError("private and legacy buckets must differ")
        self._s3_client = s3_client

    @staticmethod
    def _validate_bucket(value: object, field: str) -> str:
        allowed = "abcdefghijklmnopqrstuvwxyz0123456789-"
        if (
            type(value) is not str
            or not 3 <= len(value) <= 63
            or value[0] not in allowed[:-1]
            or value[-1] not in allowed[:-1]
            or any(character not in allowed for character in value)
        ):
            raise ReferenceR2ConfigurationError(f"{field} must be a valid private bucket name")
        return value

    @staticmethod
    def _canonical_uuid(value: object, field: str) -> str:
        if type(value) is not str:
            raise ReferenceR2InputError(f"{field} must be a canonical UUID string")
        try:
            canonical = str(UUID(value))
        except ValueError:
            raise ReferenceR2InputError(f"{field} must be a canonical UUID string") from None
        if canonical != value:
            raise ReferenceR2InputError(f"{field} must be a canonical UUID string")
        return canonical

    @staticmethod
    def _validated_upload(upload: object) -> ValidatedReferenceUpload:
        if type(upload) is not ValidatedReferenceUpload:
            raise ReferenceR2InputError("upload must be a validated reference descriptor")
        if (
            type(upload.filename) is not str
            or type(upload.canonical_extension) is not str
            or type(upload.canonical_mime) is not str
            or type(upload.size_bytes) is not int
            or type(upload.effective_limit_bytes) is not int
        ):
            raise ReferenceR2InputError("upload descriptor fields have invalid types")
        try:
            canonical = validate_reference_upload(
                upload.filename,
                upload.size_bytes,
                max_size_bytes=upload.effective_limit_bytes,
            )
        except TypedReferenceValidationError:
            raise ReferenceR2InputError("upload descriptor failed canonical revalidation") from None
        if (
            upload.filename != canonical.filename
            or upload.canonical_extension != canonical.canonical_extension
            or upload.canonical_mime != canonical.canonical_mime
            or upload.size_bytes != canonical.size_bytes
            or upload.effective_limit_bytes != canonical.effective_limit_bytes
        ):
            raise ReferenceR2InputError(
                "upload descriptor fields do not match canonical validation"
            )
        return canonical

    @staticmethod
    def _validate_etag(value: object, field: str) -> str:
        if (
            type(value) is not str
            or not value
            or value != value.strip()
            or any(ord(character) < 32 or ord(character) > 126 for character in value)
        ):
            raise ReferenceR2InputError(f"{field} must be a trimmed printable ASCII ETag")
        return value

    @staticmethod
    def _validate_response_metadata(
        response: Mapping[object, object], upload: ValidatedReferenceUpload, final_etag: str
    ) -> None:
        content_length = response.get("ContentLength")
        content_type = response.get("ContentType")
        response_etag = response.get("ETag")
        if (
            type(content_length) is not int
            or content_length != upload.size_bytes
            or content_length > upload.effective_limit_bytes
            or content_length > _ABSOLUTE_LIMIT_BYTES
        ):
            raise ReferenceR2ResponseError(
                "stored original size does not match the validated upload"
            )
        if type(content_type) is not str or content_type != upload.canonical_mime:
            raise ReferenceR2ResponseError("stored original content type is not canonical")
        if (
            type(response_etag) is not str
            or not response_etag
            or response_etag != response_etag.strip()
            or any(ord(character) < 32 or ord(character) > 126 for character in response_etag)
            or response_etag != final_etag
        ):
            raise ReferenceR2ResponseError("stored original ETag does not match the final ETag")
        if "ContentRange" in response:
            raise ReferenceR2ResponseError("SDK returned partial-content metadata for a full read")
        if "ResponseMetadata" in response:
            metadata = response.get("ResponseMetadata")
            if not isinstance(metadata, Mapping):
                raise ReferenceR2ResponseError("SDK returned malformed HTTP response metadata")
            if "HTTPStatusCode" in metadata:
                status = metadata.get("HTTPStatusCode")
                if type(status) is not int or status != 200:
                    raise ReferenceR2ResponseError("SDK did not confirm a full successful response")

    @staticmethod
    def _read_full_body(body: object, expected_size: int) -> bytes:
        read = getattr(body, "read", None)
        if not callable(read):
            raise ReferenceR2ResponseError("SDK original body cannot be read")
        chunks: list[bytes] = []
        accepted = 0
        while accepted < expected_size:
            amount = min(_READ_CHUNK_BYTES, expected_size - accepted)
            chunk = read(amount)
            if type(chunk) is not bytes or len(chunk) > amount:
                raise ReferenceR2ResponseError("SDK original body returned an invalid chunk")
            if not chunk:
                raise ReferenceR2ResponseError("SDK original body ended before the declared size")
            chunks.append(chunk)
            accepted += len(chunk)
        overflow = read(1)
        if type(overflow) is not bytes or len(overflow) > 1:
            raise ReferenceR2ResponseError("SDK original body returned an invalid overflow probe")
        if overflow:
            raise ReferenceR2ResponseError("SDK original body exceeds the declared size")
        return b"".join(chunks)

    def read_original(
        self, owner_id: object, reference_id: object, upload: object, final_etag: object
    ) -> bytes:
        """Return the exact bounded raw body for one persisted final-object identity."""
        owner = self._canonical_uuid(owner_id, "owner_id")
        reference = self._canonical_uuid(reference_id, "reference_id")
        canonical_upload = self._validated_upload(upload)
        etag = self._validate_etag(final_etag, "final_etag")
        key = f"label-references/{owner}/{reference}/original{canonical_upload.canonical_extension}"
        try:
            response = self._s3_client.get_object(
                Bucket=self._private_bucket,
                Key=key,
                IfMatch=etag,
            )
        except Exception:
            raise ReferenceR2ResponseError("private reference original GET failed") from None
        if not isinstance(response, Mapping):
            raise ReferenceR2ResponseError("SDK original response is malformed")
        try:
            body = response.get("Body")
            close = getattr(body, "close", None) if body is not None else None
        except Exception:
            raise ReferenceR2ResponseError("SDK original response body is malformed") from None
        if body is None or not callable(close):
            raise ReferenceR2ResponseError("SDK original response body cannot be closed")
        try:
            self._validate_response_metadata(response, canonical_upload, etag)
            return self._read_full_body(body, canonical_upload.size_bytes)
        except ReferenceR2ResponseError:
            raise
        except Exception:
            raise ReferenceR2ResponseError("private reference original body read failed") from None
        finally:
            try:
                close()
            except Exception:
                raise ReferenceR2ResponseError(
                    "SDK original response body could not be closed"
                ) from None
