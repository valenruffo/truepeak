"""Zero-storage lifecycle orchestrator for audio submissions.

Pipeline: analyze → compare against sonic signature → convert/delete → cleanup.
Every WAV file is guaranteed to be cleaned up — never leaves orphan files.
"""

import math
import os
import json
from pathlib import Path
from typing import Any

from app.audio.analyzer import analyze_audio
from app.audio.converter import convert_to_mp3
from app.audio.exceptions import AudioAnalysisError, ConversionError, FileCleanupError
from app.services.r2 import upload_file_to_r2, upload_bytes_to_r2


def calculate_technical_status(
    metrics: dict[str, Any],
    sonic_signature: dict[str, Any] | None = None,
) -> tuple[str, list[str]]:
    """Calculate the technical validation severity status and alerts.
    
    Returns:
        (status, alertas) - status is "optimo", "warning", or "critico".
    """
    alertas = []
    metric_statuses = []
    
    if sonic_signature is None:
        sonic_signature = {}
        
    # Retrieve thresholds with fallback defaults
    peak_limit_max = sonic_signature.get("peak_limit_max", 0.0)
    peak_limit_critical = sonic_signature.get("peak_limit_critical", 2.0)
    
    crest_factor_min = sonic_signature.get("crest_factor_min", 5.0)
    crest_factor_critical = sonic_signature.get("crest_factor_critical", 3.8)
    
    phase_correlation_min = sonic_signature.get("phase_correlation_min", 0.0)
    phase_correlation_critical = sonic_signature.get("phase_correlation_critical", 0.0)

    # 1. Phase Correlation
    phase = metrics.get("phase_correlation")
    if phase is not None:
        if phase >= phase_correlation_min:
            phase_status = "optimo"
        elif phase_correlation_critical <= phase < phase_correlation_min:
            phase_status = "warning"
            alertas.append(f"Falla de fase: correlación baja ({phase:.2f})")
        else:
            phase_status = "critico"
            alertas.append(f"Falla de fase: correlación negativa ({phase:.2f})")
        metric_statuses.append(phase_status)
        
    # 2. True Peak
    tp = metrics.get("true_peak")
    if tp is not None:
        tp_db = 20 * math.log10(tp) if tp > 0 else -99.0
        if tp_db <= peak_limit_max:
            tp_status = "optimo"
        elif peak_limit_max < tp_db <= peak_limit_critical:
            tp_status = "warning"
            alertas.append(f"True Peak alto: {tp_db:.2f} dB (recomendado: < {peak_limit_max:.1f} dB)")
        else:
            tp_status = "critico"
            alertas.append(f"True Peak crítico: {tp_db:.2f} dB (límite máximo: +{peak_limit_critical:.1f} dB)")
        metric_statuses.append(tp_status)

    # 3. Crest Factor
    cf = metrics.get("crest_factor")
    if cf is not None:
        if cf >= crest_factor_min:
            cf_status = "optimo"
        elif crest_factor_critical <= cf < crest_factor_min:
            cf_status = "warning"
            alertas.append(f"Rango dinámico bajo (Crest Factor): {cf:.2f} dB")
        else:
            cf_status = "critico"
            alertas.append(f"Rango dinámico crítico (Crest Factor): {cf:.2f} dB")
        metric_statuses.append(cf_status)

    # 4. BPM Range
    bpm = metrics.get("bpm")
    if bpm is not None:
        track_bpm = round(bpm)
        bpm_min = sonic_signature.get("bpm_min", 70)
        bpm_max = sonic_signature.get("bpm_max", 180)
        if bpm_min <= track_bpm <= bpm_max:
            bpm_status = "optimo"
        elif (bpm_min - 3) <= track_bpm < bpm_min or bpm_max < track_bpm <= (bpm_max + 3):
            bpm_status = "warning"
            alertas.append(f"Tempo fuera de rango recomendado (BPM): {track_bpm}")
        else:
            bpm_status = "critico"
            alertas.append(f"Tempo fuera de rango (BPM): {track_bpm}")
        metric_statuses.append(bpm_status)

    # 5. LUFS loudness
    lufs = metrics.get("lufs")
    if lufs is not None:
        lufs_target = sonic_signature.get("lufs_target", -14.0)
        lufs_tolerance = sonic_signature.get("lufs_tolerance", 1.0)
        if (lufs_target - lufs_tolerance) <= lufs <= (lufs_target + lufs_tolerance):
            lufs_status = "optimo"
        elif (lufs_target - lufs_tolerance - 1.5) <= lufs < (lufs_target - lufs_tolerance) or (lufs_target + lufs_tolerance) < lufs <= (lufs_target + lufs_tolerance + 1.5):
            lufs_status = "warning"
            alertas.append(f"Sonoridad fuera de tolerancia (LUFS): {lufs:.2f}")
        else:
            lufs_status = "critico"
            alertas.append(f"Sonoridad crítica (LUFS): {lufs:.2f}")
        metric_statuses.append(lufs_status)

    # 6. Duration
    duration_enabled = sonic_signature.get("duration_enabled", False)
    duration_max = sonic_signature.get("duration_max")
    dur = metrics.get("duration")
    if duration_enabled and duration_max is not None and dur is not None:
        if dur <= duration_max:
            dur_status = "optimo"
        elif dur <= (duration_max + 120):
            dur_status = "warning"
            alertas.append(f"Duración excedida: {dur:.1f}s")
        else:
            dur_status = "critico"
            alertas.append(f"Duración crítica: {dur:.1f}s")
        metric_statuses.append(dur_status)

    # 7. Key / Scale mismatch
    musical_key = metrics.get("musical_key")
    target_keys = sonic_signature.get("target_camelot_keys", [])
    if musical_key is not None and target_keys:
        if musical_key in target_keys:
            key_status = "optimo"
        else:
            key_status = "warning"
            alertas.append(f"Tonalidad no coincide con las preferidas (Key): {musical_key}")
        metric_statuses.append(key_status)

    # Calculate worst status
    if "critico" in metric_statuses:
        status = "critico"
    elif "warning" in metric_statuses:
        status = "warning"
    else:
        status = "optimo"

    return status, alertas


def _check_sonic_signature(
    metrics: dict[str, Any],
    sonic_signature: dict[str, Any],
) -> tuple[str, str | None]:
    """Compare analysis metrics against label's sonic signature rules.

    Returns:
        (status, rejection_reason) — status is "approved" or "rejected".
    """
    rules = sonic_signature.get("auto_reject_rules", {})

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
        2. Compare results against sonic signature rules and severity logic.
        3. Convert WAV to MP3 preview locally (bypassed if auto_rejected).
        4. Upload WAV original, MP3 preview, and waveform peaks JSON to R2 (bypassed if auto_rejected).
        5. Clean up all local files (WAV, MP3) from the server immediately.
    """
    metrics: dict[str, Any] = {}
    mp3_temp_path: str | None = None
    r2_mp3_url: str | None = None
    r2_original_path: str | None = None

    try:
        # Step 1: Analyze audio
        metrics = await analyze_audio(file_path)

        # Step 2: Compare against sonic signature and compute technical status
        status_tecnico, alertas = calculate_technical_status(metrics, sonic_signature)
        auto_reject_enabled = sonic_signature.get("auto_reject_enabled", True)

        is_critical = (status_tecnico == "critico")
        has_structural_alerts = any(
            keyword in alert.lower() 
            for alert in alertas 
            for keyword in ["peak", "crest", "fase", "phase", "rango dinámico"]
        )

        if is_critical and has_structural_alerts and auto_reject_enabled:
            status = "auto_rejected"
            rejection_reason = "critical_audio_validation"
        else:
            status = "critico" if is_critical else "inbox"
            rejection_reason = None

        # Check if auto rejected to bypass uploads and mp3 conversion
        if status == "auto_rejected":
            # Bypass R2 storage and conversion, clean up local WAV file and return
            _safe_remove(file_path)
            return {
                "status": status,
                "status_tecnico": status_tecnico,
                "alertas": alertas,
                "metrics": metrics,
                "rejection_reason": rejection_reason,
                "mp3_path": None,
                "original_path": None,
                "peaks": metrics.get("peaks"),
            }

        # Step 3: Convert to MP3 locally in /tmp
        ext = Path(file_path).suffix.lower()
        mp3_temp_path = f"/tmp/{submission_id}.mp3"
        
        try:
            convert_to_mp3(file_path, mp3_temp_path, bitrate="320k")
        except ConversionError as e:
            # Conversion failed — treat as rejected and raise
            status = "auto_rejected"
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
        # Step 5: ALWAYS clean up local files
        if os.path.exists(file_path):
            _safe_remove(file_path)
        if mp3_temp_path and os.path.exists(mp3_temp_path):
            _safe_remove(mp3_temp_path)

    return {
        "status": status,
        "status_tecnico": status_tecnico,
        "alertas": alertas,
        "metrics": metrics,
        "rejection_reason": rejection_reason,
        "mp3_path": r2_mp3_url,
        "original_path": r2_original_path,
        "peaks": metrics.get("peaks"),
    }
