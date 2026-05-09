"""Zero-storage lifecycle orchestrator for audio submissions.

Pipeline: analyze → compare against sonic signature → convert/delete → cleanup.
Every WAV file is guaranteed to be cleaned up — never leaves orphan files.
"""

import os
from pathlib import Path
from typing import Any

from app.audio.analyzer import analyze_audio
from app.audio.converter import convert_to_mp3
from app.audio.exceptions import AudioAnalysisError, ConversionError, FileCleanupError


def _check_sonic_signature(
    metrics: dict[str, Any],
    sonic_signature: dict[str, Any],
) -> tuple[str, str | None]:
    """Compare analysis metrics against label's sonic signature rules.

    Returns:
        (status, rejection_reason) — status is "approved" or "rejected".
    """
    rules = sonic_signature.get("auto_reject_rules", {})

    # Phase correlation check
    if rules.get("reject_inverted_phase", False):
        phase_min = sonic_signature.get("phase_correlation_min", 0.0)
        if metrics["phase_correlation"] <= phase_min:
            return "rejected", "inverted_phase"

    # LUFS loudness check
    if rules.get("reject_excessive_loudness", False):
        lufs_target = sonic_signature.get("lufs_target", -14.0)
        lufs_tolerance = sonic_signature.get("lufs_tolerance", 2.0)
        lufs_max = lufs_target + lufs_tolerance
        if metrics["lufs"] > lufs_max:
            return "rejected", "excessive_loudness"

    # BPM range check
    if rules.get("reject_out_of_tempo", False):
        bpm_min = sonic_signature.get("bpm_min", 70)
        bpm_max = sonic_signature.get("bpm_max", 180)
        if metrics["bpm"] < bpm_min or metrics["bpm"] > bpm_max:
            return "rejected", "out_of_tempo"

    # Clipping check
    if rules.get("reject_clipping", False):
        if metrics.get("true_peak", 0) >= 0.99:
            return "rejected", "digital_clipping"

    # Dynamic range / Crest Factor check
    if rules.get("reject_low_dynamic_range", False):
        # A default threshold of 5.0 dB represents a very squashed brickwall track
        cf_threshold = sonic_signature.get("crest_factor_min", 5.0)
        if metrics.get("crest_factor", 10.0) < cf_threshold:
            return "rejected", "low_dynamic_range"

    # Musical key check (Camelot Wheel)
    if rules.get("reject_wrong_key", False):
        target_keys = sonic_signature.get("target_camelot_keys", [])
        if target_keys:
            detected_key = metrics.get("musical_key")
            if detected_key not in target_keys:
                return "rejected", "wrong_musical_key"

    return "approved", None


def _safe_remove(file_path: str) -> None:
    """Safely remove a file, raising FileCleanupError on failure."""
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except OSError as e:
        raise FileCleanupError(f"Failed to delete {file_path}: {e}") from e


async def process_submission(
    file_path: str,
    submission_id: str,
    label_id: str,
    sonic_signature: dict[str, Any],
) -> dict[str, Any]:
    """Process a single audio submission through the zero-storage lifecycle.

    Steps:
        1. Analyze audio file (BPM, LUFS, phase correlation, musical key).
        2. Compare results against sonic signature rules.
        3. If accepted → convert to MP3 → save to /app/data/mp3s/{submission_id}.mp3 → delete WAV.
        4. If rejected → delete WAV immediately.

    Args:
        file_path: Path to the temporary WAV file.
        submission_id: UUID of the submission record.
        label_id: UUID of the label (for logging).
        sonic_signature: Label's sonic signature configuration.

    Returns:
        {
            "status": "approved" | "rejected",
            "metrics": {"bpm": ..., "lufs": ..., ...},
            "rejection_reason": str | None,
            "mp3_path": str | None,
        }

    Raises:
        AudioAnalysisError: If analysis fails (caller must handle).
    """
    metrics: dict[str, Any] = {}
    status = "rejected"
    rejection_reason: str | None = None
    mp3_path: str | None = None

    try:
        # Step 1: Analyze audio
        metrics = await analyze_audio(file_path)

        # Step 2: Compare against sonic signature
        status, rejection_reason = _check_sonic_signature(metrics, sonic_signature)

        if status == "approved":
            # Step 3: Convert to MP3 and save
            mp3_dir = Path("/app/data/mp3s")
            mp3_dir.mkdir(parents=True, exist_ok=True)
            mp3_path = str(mp3_dir / f"{submission_id}.mp3")

            try:
                convert_to_mp3(file_path, mp3_path, bitrate="320k")
            except ConversionError as e:
                # Conversion failed — treat as rejected
                status = "rejected"
                rejection_reason = f"conversion_failed: {e}"
                mp3_path = None

    finally:
        # Step 4: ALWAYS clean up WAV file — no exceptions
        _safe_remove(file_path)

    return {
        "status": status,
        "metrics": metrics,
        "rejection_reason": rejection_reason,
        "mp3_path": mp3_path,
    }
