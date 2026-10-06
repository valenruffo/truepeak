"""Standalone conditional copy from provisional to private final reference storage.

The injected client must be dedicated to this adapter and configured for SigV4.
Its operator private-bucket attestation and SDK hook do not prove bucket privacy
or provider support. Cloudflare R2 evaluates source and destination conditions at
different times; this adapter makes no atomic-snapshot or database-transaction
claim and never treats a precondition failure as proof of either condition.
"""

from __future__ import annotations

from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass
from threading import Lock
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

_COPY_EVENT = "before-call.s3.CopyObject"
_DESTINATION_CONDITION = "cf-copy-destination-if-none-match"


class ReferenceR2PreconditionError(ReferenceR2ResponseError):
    """A conditional copy failed; source change and destination existence are ambiguous."""


class ReferenceR2PromotionProviderError(ReferenceR2ResponseError):
    """A provider copy failed for a reason other than a recognized precondition."""


@dataclass(frozen=True, slots=True)
class FinalReferencePromotion:
    """Minimal internal final-object receipt; it makes no processing-readiness claim."""

    final_key: str
    final_etag: str


class PrivateReferenceR2PromotionAdapter:
    """Copy an observed staging object with source-match and destination-create-only guards.

    The caller must provide the exact first observed staging ETag and dedicate the
    injected SDK client to this adapter. The fixed destination header is installed
    once on that client's CopyObject event, before the first request is sent.
    """

    def __init__(
        self,
        s3_client: object,
        *,
        private_bucket: str,
        legacy_bucket: str,
        private_access_confirmed: bool = False,
    ) -> None:
        if s3_client is None:
            raise ReferenceR2ConfigurationError("an injected dedicated S3 client is required")
        if type(private_access_confirmed) is not bool or not private_access_confirmed:
            raise ReferenceR2ConfigurationError("private bucket access must be confirmed")
        self._private_bucket = self._validate_bucket(private_bucket, "private_bucket")
        self._legacy_bucket = self._validate_bucket(legacy_bucket, "legacy_bucket")
        if self._private_bucket == self._legacy_bucket:
            raise ReferenceR2ConfigurationError("private and legacy buckets must differ")
        self._s3_client = s3_client
        self._hook_lock = Lock()
        self._hook_installed = False

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
        if value != canonical:
            raise ReferenceR2InputError(f"{field} must be a canonical UUID string")
        return canonical

    @staticmethod
    def _validated_upload(value: object) -> ValidatedReferenceUpload:
        if type(value) is not ValidatedReferenceUpload:
            raise ReferenceR2InputError("upload must be a validated reference descriptor")
        try:
            canonical = validate_reference_upload(
                value.filename,
                value.size_bytes,
                max_size_bytes=value.effective_limit_bytes,
            )
        except TypedReferenceValidationError:
            raise ReferenceR2InputError("upload descriptor failed canonical validation") from None
        if value != canonical:
            raise ReferenceR2InputError("upload descriptor does not match canonical metadata")
        return canonical

    @staticmethod
    def _validated_etag(value: object, field: str) -> str:
        if (
            type(value) is not str
            or not value
            or value != value.strip()
            or any(ord(character) < 32 or ord(character) > 126 for character in value)
        ):
            raise ReferenceR2InputError(f"{field} must be a non-empty header-safe opaque ETag")
        return value

    def _ensure_copy_hook(self) -> None:
        with self._hook_lock:
            if self._hook_installed:
                return
            try:
                meta = getattr(self._s3_client, "meta", None)
                config = getattr(meta, "config", None)
                if getattr(config, "signature_version", None) != "s3v4":
                    raise ReferenceR2ConfigurationError("dedicated S3 client must use SigV4")
                events = getattr(meta, "events", None)
                register = getattr(events, "register", None)
                if not callable(register):
                    raise ReferenceR2ConfigurationError(
                        "dedicated S3 client lacks CopyObject event hooks"
                    )
                register(_COPY_EVENT, self._add_destination_condition)
            except ReferenceR2ConfigurationError:
                raise
            except Exception:
                raise ReferenceR2ConfigurationError(
                    "could not install the required CopyObject condition hook"
                ) from None
            self._hook_installed = True

    @staticmethod
    def _add_destination_condition(params: object, **_kwargs: object) -> None:
        if not isinstance(params, MutableMapping):
            raise ReferenceR2ConfigurationError("CopyObject hook received malformed parameters")
        headers = params.get("headers")
        if not isinstance(headers, MutableMapping):
            raise ReferenceR2ConfigurationError("CopyObject hook received malformed headers")
        existing = [
            (key, value)
            for key, value in headers.items()
            if type(key) is str and key.lower() == _DESTINATION_CONDITION
        ]
        if existing and existing != [(_DESTINATION_CONDITION, "*")]:
            raise ReferenceR2ConfigurationError(
                "CopyObject destination condition conflicts with the required guard"
            )
        headers.setdefault(_DESTINATION_CONDITION, "*")

    @staticmethod
    def _is_precondition_failure(error: Exception) -> bool:
        response = getattr(error, "response", None)
        if not isinstance(response, Mapping):
            return False
        metadata = response.get("ResponseMetadata")
        status = metadata.get("HTTPStatusCode") if isinstance(metadata, Mapping) else None
        detail = response.get("Error")
        code = detail.get("Code") if isinstance(detail, Mapping) else None
        return (type(status) is int and status == 412) or code == "PreconditionFailed"

    def promote(
        self,
        owner_id: object,
        reference_id: object,
        upload: object,
        staging_etag: object,
    ) -> FinalReferencePromotion:
        """Conditionally copy the derived staging key to its distinct private final key."""
        owner = self._canonical_uuid(owner_id, "owner_id")
        reference = self._canonical_uuid(reference_id, "reference_id")
        canonical_upload = self._validated_upload(upload)
        source_etag = self._validated_etag(staging_etag, "staging_etag")
        base = f"label-references/{owner}/{reference}"
        staging_key = f"{base}/staging/original{canonical_upload.canonical_extension}"
        final_key = f"{base}/original{canonical_upload.canonical_extension}"
        if staging_key == final_key:
            raise ReferenceR2InputError("staging and final keys must be distinct")

        self._ensure_copy_hook()
        try:
            response = self._s3_client.copy_object(
                Bucket=self._private_bucket,
                Key=final_key,
                CopySource=f"/{self._private_bucket}/{staging_key}",
                CopySourceIfMatch=source_etag,
            )
        except ReferenceR2ConfigurationError:
            raise
        except Exception as error:
            if self._is_precondition_failure(error):
                raise ReferenceR2PreconditionError(
                    "conditional private reference copy precondition failed"
                ) from None
            raise ReferenceR2PromotionProviderError(
                "conditional private reference copy failed"
            ) from None

        if not isinstance(response, Mapping) or "Error" in response:
            raise ReferenceR2ResponseError("SDK returned a malformed copy response")
        metadata = response.get("ResponseMetadata")
        result = response.get("CopyObjectResult")
        if (
            not isinstance(metadata, Mapping)
            or type(metadata.get("HTTPStatusCode")) is not int
            or metadata["HTTPStatusCode"] != 200
            or not isinstance(result, Mapping)
        ):
            raise ReferenceR2ResponseError("SDK returned an incomplete copy result")
        try:
            final_etag = self._validated_etag(result.get("ETag"), "final_etag")
        except ReferenceR2InputError:
            raise ReferenceR2ResponseError("SDK returned an invalid final ETag") from None
        return FinalReferencePromotion(final_key=final_key, final_etag=final_etag)
