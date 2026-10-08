"""Run one already-authorized reference-processing claim without owning its claim lifecycle."""

from __future__ import annotations

from app.ar_matching.reference_processing_claims import (
    ReferenceProcessingClaimReceipt,
    ReferenceProcessingClaimValidationError,
    SessionFactory,
)
from app.ar_matching.reference_processing_completions import fail_reference_processing
from app.ar_matching.reference_processing_publications import publish_reference_processing_success
from app.audio.embedding.provider import MusicEmbeddingProvider
from app.services.reference_r2_originals import PrivateReferenceOriginalReader


def process_claimed_reference(
    receipt: ReferenceProcessingClaimReceipt,
    *,
    provider: MusicEmbeddingProvider,
    original_reader: PrivateReferenceOriginalReader,
    session_factory: SessionFactory,
    pipeline_version: str,
) -> None:
    """Process one trusted claim; the caller owns authorization, bounds, and claim lifecycle."""
    if type(receipt) is not ReferenceProcessingClaimReceipt:
        raise ReferenceProcessingClaimValidationError("claim receipt is invalid")

    try:
        audio = original_reader.read_original(
            receipt.label_id, receipt.reference_id, receipt.upload, receipt.final_etag
        )
        embedding = provider.generate_track_embedding(audio)
    except Exception as processing_error:
        try:
            fail_reference_processing(receipt, session_factory=session_factory)
        except Exception as completion_error:
            raise processing_error from completion_error
        raise

    publish_reference_processing_success(
        receipt, embedding, pipeline_version, session_factory=session_factory
    )
