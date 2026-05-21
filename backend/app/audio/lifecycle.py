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

    # Phase correlation check (strict rejection)
    if rules.get("phase", False) or rules.get("reject_inverted_phase", False):
        phase_min = sonic_signature.get("phase_correlation_min", 0.0)
        if metrics["phase_correlation"] <= phase_min:
            return "rejected", "inverted_phase"

    # LUFS loudness check (Volume control exclusively from slider, unconditional)
    lufs_target = sonic_signature.get("lufs_target", -14.0)
    lufs_tolerance = sonic_signature.get("lufs_tolerance", 2.0)
    lufs_max = lufs_target + lufs_tolerance
    if metrics["lufs"] > lufs_max:
        return "rejected", "excessive_loudness"

    # BPM range check
    if rules.get("tempo", False) or rules.get("reject_out_of_tempo", False):
        bpm_min = sonic_signature.get("bpm_min", 70)
        bpm_max = sonic_signature.get("bpm_max", 180)
        track_bpm = round(metrics["bpm"])
        if track_bpm < bpm_min or track_bpm > bpm_max:
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
        3. Convert WAV to MP3 preview locally.
        4. Upload WAV original, MP3 preview, and waveform peaks JSON in combo to R2.
        5. Clean up all local files (WAV, MP3) from the server immediately.

    Args:
        file_path: Path to the temporary original audio file.
        submission_id: UUID of the submission record.
        label_id: UUID of the label (for logging).
        sonic_signature: Label's sonic signature configuration.

    Returns:
        {
            "status": "approved" | "rejected",
            "metrics": {"bpm": ..., "lufs": ..., ...},
            "rejection_reason": str | None,
            "mp3_path": str | None,
            "original_path": str | None,
            "peaks": list[float] | None,
        }

    Raises:
        AudioAnalysisError: If analysis fails (caller must handle).
    """
    import json
    import os
    from pathlib import Path
    from app.services.r2 import upload_file_to_r2, upload_bytes_to_r2

    metrics: dict[str, Any] = {}
    status = "rejected"
    rejection_reason: str | None = None
    mp3_temp_path: str | None = None
    r2_mp3_url: str | None = None
    r2_original_path: str | None = None

    try:
        # Step 1: Analyze audio
        metrics = await analyze_audio(file_path)

        # Step 2: Compare against sonic signature
        status, rejection_reason = _check_sonic_signature(metrics, sonic_signature)

        # Step 3: Convert to MP3 locally in /tmp
        ext = Path(file_path).suffix.lower()
        mp3_temp_path = f"/tmp/{submission_id}.mp3"
        
        try:
            convert_to_mp3(file_path, mp3_temp_path, bitrate="320k")
        except ConversionError as e:
            # Conversion failed — treat as rejected and raise
            status = "rejected"
            rejection_reason = f"conversion_failed: {e}"
            raise AudioAnalysisError(f"Audio conversion failed: {e}") from e

        # Step 4: Upload combo (original, preview.mp3, waveform.json) to R2
        r2_original_key = f"tracks/{submission_id}/original{ext}"
        r2_mp3_key = f"tracks/{submission_id}/preview.mp3"
        r2_peaks_key = f"tracks/{submission_id}/waveform.json"

        # Determine original content type
        orig_content_type = "audio/wav"
        if ext == ".flac":
            orig_content_type = "audio/flac"
        elif ext in (".aiff", ".aif"):
            orig_content_type = "audio/aiff"

        # Upload files in parallel/sequence to R2
        await upload_file_to_r2(file_path, r2_original_key, orig_content_type)
        await upload_file_to_r2(mp3_temp_path, r2_mp3_key, "audio/mpeg")

        # Upload peaks waveform JSON
        peaks = metrics.get("peaks", [])
        duration = metrics.get("duration", 0.0)
        peaks_data = json.dumps({"peaks": peaks, "duration": duration}).encode("utf-8")
        await upload_bytes_to_r2(peaks_data, r2_peaks_key, "application/json")

        # Set R2 paths for DB persistence
        public_url_base = os.getenv("CLOUDFLARE_R2_PUBLIC_URL", "").rstrip("/")
        r2_mp3_url = f"{public_url_base}/{r2_mp3_key}"
        r2_original_path = r2_original_key

    finally:
        # Step 5: ALWAYS clean up local files from Oracle server immediately
        _safe_remove(file_path)
        if mp3_temp_path:
            _safe_remove(mp3_temp_path)

    return {
        "status": status,
        "metrics": metrics,
        "rejection_reason": rejection_reason,
        "mp3_path": r2_mp3_url,
        "original_path": r2_original_path,
        "peaks": metrics.get("peaks"),
    }
