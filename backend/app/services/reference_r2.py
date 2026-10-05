"""Fail-closed, standalone R2 staging primitives for private reference uploads.

This module is deliberately unused by the API and constructs no SDK clients. The
operator confirmation below is an assertion, not proof of actual bucket privacy.
Keep R2 rollout disabled until the configured bucket's access policy, actual R2
round-trip, and browser upload behavior have been independently verified. A
presigned browser PUT may be replayed and overwrite this STAGING object; the
HEAD/conditional range GET check one object state but do not make it immutable,
READY, final, or safe to expose publicly. Promotion, reservation/quota, and
final-state handling belong to later units. Content-Length in the returned
header tuple is the browser request expectation, not proof that browser or R2
will enforce it.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, Protocol
from uuid import UUID

from app.ar_matching.reference_validation import (
    TypedReferenceValidationError,
    ValidatedReferenceUpload,
    validate_reference_header,
    validate_reference_upload,
)

_MAX_PRESIGN_EXPIRY_SECONDS = 900


class ReferenceR2Error(Exception):
    """Base class for safe adapter input, configuration, and response errors."""


class ReferenceR2ConfigurationError(ReferenceR2Error, ValueError):
    """The injected client or explicit staging-bucket boundary is invalid."""


class ReferenceR2InputError(ReferenceR2Error, ValueError):
    """Caller metadata is malformed, noncanonical, or forged."""


class ReferenceR2ResponseError(ReferenceR2Error, ValueError):
    """The SDK returned a malformed URL or object response."""


class ReferenceStagingS3Client(Protocol):
    """The only injected SDK methods used by this standalone adapter."""

    def generate_presigned_url(
        self,
        ClientMethod: str,  # noqa: N803 - boto3 keyword names are case-sensitive
        *,
        Params: dict[str, object],  # noqa: N803 - boto3 keyword names are case-sensitive
        ExpiresIn: int,  # noqa: N803 - boto3 keyword names are case-sensitive
        HttpMethod: str,  # noqa: N803 - boto3 keyword names are case-sensitive
    ) -> object: ...

    def head_object(
        self,
        *,
        Bucket: str,  # noqa: N803 - boto3 keyword names are case-sensitive
        Key: str,  # noqa: N803 - boto3 keyword names are case-sensitive
    ) -> object: ...

    def get_object(
        self,
        *,
        Bucket: str,  # noqa: N803 - boto3 keyword names are case-sensitive
        Key: str,  # noqa: N803 - boto3 keyword names are case-sensitive
        Range: str,  # noqa: N803 - boto3 keyword names are case-sensitive
        IfMatch: str,  # noqa: N803 - boto3 keyword names are case-sensitive
    ) -> object: ...


@dataclass(frozen=True, slots=True)
class StagingPresignedPut:
    """A provisional signed PUT; it does not represent a READY or final object."""

    url: str
    key: str
    required_headers: tuple[tuple[str, str], ...]
    expires_in_seconds: int
    status: Literal["STAGING"] = "STAGING"
    provisional: Literal[True] = True
    ready: Literal[False] = False
    final: Literal[False] = False


@dataclass(frozen=True, slots=True)
class StagingObjectVerification:
    """Bounded metadata and header result for one observed staging object state."""

    key: str
    content_length: int
    content_type: str
    etag: str
    status: Literal["STAGING"] = "STAGING"
    provisional: Literal[True] = True
    ready: Literal[False] = False
    final: Literal[False] = False


class PrivateReferenceStagingAdapter:
    """Sign replayable STAGING PUTs and verify bounded bytes in a private bucket.

    Staging objects are not ready or final. ``private_access_confirmed`` is a
    required operator assertion that this adapter's bucket differs from the
    legacy bucket. This assertion is not proof of actual privacy; it does not
    test ACLs, policies, anonymous access, public serving, or actual R2 behavior.
    """

    def __init__(
        self,
        s3_client: ReferenceStagingS3Client,
        *,
        private_bucket: str,
        legacy_bucket: str,
        private_access_confirmed: bool = False,
    ) -> None:
        if s3_client is None:
            raise ReferenceR2ConfigurationError("an injected S3 client is required")
        if type(private_access_confirmed) is not bool or private_access_confirmed is not True:
            raise ReferenceR2ConfigurationError(
                "private bucket access must be explicitly confirmed"
            )
        self._private_bucket = self._validate_bucket(private_bucket, "private_bucket")
        self._legacy_bucket = self._validate_bucket(legacy_bucket, "legacy_bucket")
        if self._private_bucket == self._legacy_bucket:
            raise ReferenceR2ConfigurationError("private and legacy buckets must be different")
        self._s3_client = s3_client

    @staticmethod
    def _validate_bucket(value: object, field: str) -> str:
        if (
            type(value) is not str
            or not value
            or value != value.strip()
            or any(ord(character) < 32 or ord(character) == 127 for character in value)
        ):
            raise ReferenceR2ConfigurationError(f"{field} must be a non-empty plain string")
        return value

    @staticmethod
    def _canonical_uuid(value: object, field: str) -> str:
        if type(value) is not str:
            raise ReferenceR2InputError(f"{field} must be a canonical UUID string")
        try:
            canonical = str(UUID(value))
        except ValueError as error:
            raise ReferenceR2InputError(f"{field} must be a canonical UUID string") from error
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
        except TypedReferenceValidationError as error:
            raise ReferenceR2InputError(
                "upload descriptor failed canonical revalidation"
            ) from error
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
    def _key(label_id: str, reference_id: str, upload: ValidatedReferenceUpload) -> str:
        return (
            f"label-references/{label_id}/{reference_id}/staging/"
            f"original{upload.canonical_extension}"
        )

    def _identity_and_upload(
        self, label_id: object, reference_id: object, upload: object
    ) -> tuple[str, str, ValidatedReferenceUpload]:
        canonical_label = self._canonical_uuid(label_id, "label_id")
        canonical_reference = self._canonical_uuid(reference_id, "reference_id")
        return canonical_label, canonical_reference, self._validated_upload(upload)

    def presign_put(
        self,
        label_id: object,
        reference_id: object,
        upload: object,
        *,
        expires_in_seconds: int = _MAX_PRESIGN_EXPIRY_SECONDS,
    ) -> StagingPresignedPut:
        """Create a short-lived exact-header PUT for the internally derived key."""
        if (
            type(expires_in_seconds) is not int
            or expires_in_seconds <= 0
            or expires_in_seconds > _MAX_PRESIGN_EXPIRY_SECONDS
        ):
            raise ReferenceR2InputError("expiry must be a positive integer no greater than 900")
        label, reference, canonical_upload = self._identity_and_upload(
            label_id, reference_id, upload
        )
        key = self._key(label, reference, canonical_upload)
        url = self._s3_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self._private_bucket,
                "Key": key,
                "ContentLength": canonical_upload.size_bytes,
                "ContentType": canonical_upload.canonical_mime,
            },
            ExpiresIn=expires_in_seconds,
            HttpMethod="PUT",
        )
        if type(url) is not str or not url.strip():
            raise ReferenceR2ResponseError("SDK did not return a non-empty presigned URL")
        return StagingPresignedPut(
            url=url,
            key=key,
            required_headers=(
                ("Content-Length", str(canonical_upload.size_bytes)),
                ("Content-Type", canonical_upload.canonical_mime),
            ),
            expires_in_seconds=expires_in_seconds,
        )

    def verify_uploaded_reference(
        self, label_id: object, reference_id: object, upload: object
    ) -> StagingObjectVerification:
        """Check HEAD metadata and one ETag-matched 12-byte range, without promotion."""
        label, reference, canonical_upload = self._identity_and_upload(
            label_id, reference_id, upload
        )
        key = self._key(label, reference, canonical_upload)
        head = self._s3_client.head_object(Bucket=self._private_bucket, Key=key)
        if not isinstance(head, Mapping):
            raise ReferenceR2ResponseError("SDK HEAD response is missing object metadata")

        content_length = head.get("ContentLength")
        content_type = head.get("ContentType")
        etag = head.get("ETag")
        if (
            type(content_length) is not int
            or content_length <= 0
            or content_length != canonical_upload.size_bytes
        ):
            raise ReferenceR2ResponseError("stored object size does not match the validated upload")
        if (
            type(content_type) is not str
            or not content_type
            or content_type != canonical_upload.canonical_mime
        ):
            raise ReferenceR2ResponseError("stored object content type is not canonical")
        if type(etag) is not str or not etag:
            raise ReferenceR2ResponseError("SDK HEAD response is missing a valid ETag")

        response = self._s3_client.get_object(
            Bucket=self._private_bucket,
            Key=key,
            Range="bytes=0-11",
            IfMatch=etag,
        )
        if not isinstance(response, Mapping):
            raise ReferenceR2ResponseError("SDK range response is malformed")
        body = response.get("Body")
        if body is None:
            raise ReferenceR2ResponseError("SDK range response is missing its body")

        try:
            read = getattr(body, "read", None)
            if not callable(read):
                raise ReferenceR2ResponseError("SDK range response body cannot be read")
            prefix = read(12)
            if type(prefix) is not bytes or len(prefix) > 12:
                raise ReferenceR2ResponseError("SDK range read must return at most 12 bytes")
            validate_reference_header(canonical_upload.filename, prefix)
        finally:
            close = getattr(body, "close", None)
            if callable(close):
                close()

        return StagingObjectVerification(
            key=key,
            content_length=content_length,
            content_type=content_type,
            etag=etag,
        )
