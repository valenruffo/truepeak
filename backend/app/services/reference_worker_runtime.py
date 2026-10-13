"""Production runtime defaults for finalize-triggered reference processing.

Assembly is lazy and process-wide cached: the OpenL3 provider and the private
R2 original reader are built from explicit environment configuration on first
background use, so TensorFlow loads once per process and is reused.
"""

from __future__ import annotations

import logging
import os
import threading

from app.ar_matching.reference_processing_claims import (
    ReferenceProcessingClaimError,
    claim_reference_processing,
)
from app.ar_matching.reference_processing_worker import process_claimed_reference
from app.audio.embedding.openl3_provider import OpenL3EmbeddingProvider
from app.services.reference_r2_factory import create_private_reference_original_reader

logger = logging.getLogger(__name__)

PIPELINE_VERSION = "LABEL_DNA_OPENL3_V1"
_DEFAULT_MAX_DECODED_FRAMES = 8_640_000
_DEFAULT_MAX_DECODED_CHANNELS = 2

_PROVIDER: OpenL3EmbeddingProvider | None = None
_READER: object | None = None
_RUNTIME_LOCK = threading.Lock()


def _positive_int_setting(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    if not (raw.strip().isascii() and raw.strip().isdigit()):
        raise ValueError(f"{name} must be a positive integer")
    return int(raw)


def runtime_provider() -> OpenL3EmbeddingProvider:
    """Return the cached bounded OpenL3 provider, building it on first use."""
    global _PROVIDER
    if _PROVIDER is None:
        with _RUNTIME_LOCK:
            if _PROVIDER is None:
                _PROVIDER = OpenL3EmbeddingProvider(
                    max_decoded_frames=_positive_int_setting(
                        "LABEL_REFERENCE_MAX_DECODED_FRAMES", _DEFAULT_MAX_DECODED_FRAMES
                    ),
                    max_channels=_positive_int_setting(
                        "LABEL_REFERENCE_MAX_DECODED_CHANNELS", _DEFAULT_MAX_DECODED_CHANNELS
                    ),
                )
    return _PROVIDER


def runtime_original_reader() -> object:
    """Return the cached attested private-R2 reader, building it on first use."""
    global _READER
    if _READER is None:
        with _RUNTIME_LOCK:
            if _READER is None:
                _READER = create_private_reference_original_reader(environ=os.environ)
    return _READER


def process_finalized_reference(label_id: str, reference_id: str, session_factory) -> None:
    """Claim and process one finalized reference; never raise into finalize."""
    try:
        provider = runtime_provider()
        original_reader = runtime_original_reader()
    except Exception:
        logger.exception(
            "reference processing runtime unavailable for %s/%s", label_id, reference_id
        )
        return
    try:
        receipt = claim_reference_processing(
            label_id, reference_id, session_factory=session_factory
        )
    except ReferenceProcessingClaimError:
        logger.info("reference processing claim skipped for %s/%s", label_id, reference_id)
        return
    try:
        process_claimed_reference(
            receipt,
            provider=provider,
            original_reader=original_reader,
            session_factory=session_factory,
            pipeline_version=PIPELINE_VERSION,
        )
    except Exception:
        logger.exception("reference processing failed for %s/%s", label_id, reference_id)
