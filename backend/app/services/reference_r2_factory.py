"""Explicit, lazy configuration for the private reference R2 staging adapter.

Importing this module reads no configuration and imports no SDK. Constructing an
adapter makes no provider requests and does not prove that the bucket is private.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from urllib.parse import urlsplit

from app.services.reference_r2 import (
    PrivateReferenceStagingAdapter,
    ReferenceR2ConfigurationError,
    ReferenceStagingS3Client,
)

_PRIVATE_BUCKET = "LABEL_REFERENCE_R2_BUCKET_NAME"
_PRIVATE_ACCESS_ATTESTATION = "LABEL_REFERENCE_R2_PRIVATE_ACCESS_CONFIRMED"
_LEGACY_BUCKET = "CLOUDFLARE_R2_BUCKET_NAME"
_ENDPOINT = "CLOUDFLARE_R2_ENDPOINT"
_ACCESS_KEY_ID = "CLOUDFLARE_R2_ACCESS_KEY_ID"
_SECRET_ACCESS_KEY = "CLOUDFLARE_R2_SECRET_ACCESS_KEY"


class ReferenceR2FactoryError(ReferenceR2ConfigurationError):
    """Safe configuration or SDK-availability error from the staging factory."""


def _setting(environ: Mapping[str, str], name: str) -> str:
    value = environ.get(name)
    if type(value) is not str or not value.strip():
        raise ReferenceR2FactoryError("R2 staging configuration is missing or invalid")
    return value


def _bucket_name_is_valid(value: str) -> bool:
    return value == value.strip() and not any(
        ord(character) < 32 or ord(character) == 127 for character in value
    )


def _validate_endpoint(endpoint: str) -> None:
    if any(character.isspace() for character in endpoint) or "?" in endpoint or "#" in endpoint:
        raise ReferenceR2FactoryError("R2 staging configuration is missing or invalid")
    try:
        parsed = urlsplit(endpoint)
        _ = parsed.port  # Validate a port without imposing a region/host format.
    except ValueError:
        raise ReferenceR2FactoryError("R2 staging configuration is missing or invalid") from None
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ReferenceR2FactoryError("R2 staging configuration is missing or invalid")


def _build_s3_client(
    *, endpoint_url: str, aws_access_key_id: str, aws_secret_access_key: str
) -> ReferenceStagingS3Client:
    """Import the optional SDK only after all explicit settings have been checked."""
    try:
        import boto3
        from botocore.config import Config
        from botocore.exceptions import BotoCoreError
    except ImportError:
        raise ReferenceR2FactoryError("R2 staging SDK is unavailable") from None

    try:
        return boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
    except BotoCoreError:
        raise ReferenceR2FactoryError("R2 staging client is unavailable") from None


def create_private_reference_staging_adapter(
    *,
    environ: Mapping[str, str] | None = None,
    client: ReferenceStagingS3Client | None = None,
    client_builder: Callable[..., ReferenceStagingS3Client] | None = None,
) -> PrivateReferenceStagingAdapter:
    """Create the existing adapter from explicit settings, without provider I/O.

    ``environ`` and ``client_builder`` are injection seams for tests and callers
    that manage configuration themselves. With neither client nor builder, the
    boto3 client is created lazily using only the explicit credentials below.
    The private-access setting is operator attestation, not privacy verification.
    """
    settings = os.environ if environ is None else environ
    private_bucket = _setting(settings, _PRIVATE_BUCKET)
    confirmed = _setting(settings, _PRIVATE_ACCESS_ATTESTATION).strip().lower()
    legacy_bucket = _setting(settings, _LEGACY_BUCKET)
    endpoint = _setting(settings, _ENDPOINT)
    access_key_id = _setting(settings, _ACCESS_KEY_ID)
    secret_access_key = _setting(settings, _SECRET_ACCESS_KEY)

    if (
        confirmed not in {"true", "1"}
        or not _bucket_name_is_valid(private_bucket)
        or not _bucket_name_is_valid(legacy_bucket)
        or private_bucket == legacy_bucket
    ):
        raise ReferenceR2FactoryError("R2 staging configuration is missing or invalid")
    _validate_endpoint(endpoint)

    if client is not None and client_builder is not None:
        raise ReferenceR2FactoryError("provide either an injected client or a client builder")
    if client is None:
        builder = _build_s3_client if client_builder is None else client_builder
        client = builder(
            endpoint_url=endpoint,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
        )
    if client is None:
        raise ReferenceR2FactoryError("R2 staging client is unavailable")

    return PrivateReferenceStagingAdapter(
        client,
        private_bucket=private_bucket,
        legacy_bucket=legacy_bucket,
        private_access_confirmed=True,
    )
