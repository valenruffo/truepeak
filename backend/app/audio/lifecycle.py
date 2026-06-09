"""Zero-storage lifecycle orchestrator for audio submissions.

Pipeline: analyze → compare against sonic signature → convert/delete → cleanup.
Every WAV file is guaranteed to be cleaned up — never leaves orphan files.
"""

import asyncio
import math
import os
import json
from pathlib import Path
from typing import Any

from typing import Any, Callable, Awaitable

from app.audio.analyzer import analyze_audio
from app.audio.converter import convert_to_mp3
from app.audio.exceptions import AudioAnalysisError, ConversionError, FileCleanupError
from app.services.r2 import (
    delete_file_from_r2,
    download_file_with_progress,
    upload_bytes_to_r2,
    upload_file_to_r2,
)


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
        
    # Retrieve recommended thresholds (user-set via single slider)
    # Critical thresholds are auto-calculated from fixed margins
    peak_limit_max = sonic_signature.get("peak_limit_max", 0.0)
    peak_limit_critical = peak_limit_max + 1.5  # Fixed margin: +1.5 dB above recommended
    
    crest_factor_min = sonic_signature.get("crest_factor_min", 5.0)
    crest_factor_critical = max(crest_factor_min - 1.5, 2.0)  # Fixed margin: -1.5 dB below recommended, floor at 2.0
    
    phase_correlation_min = sonic_signature.get("phase_correlation_min", 0.3)
    phase_correlation_critical = max(phase_correlation_min - 0.3, -0.2)  # Fixed margin: -0.3 below recommended, floor at -0.2

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
        elif crest_factor_critical < cf < crest_factor_min:
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
    submission_id: str,
    label_id: str,
    sonic_signature: dict[str, Any],
    on_progress: Callable[[str, int], Awaitable[None]] | None = None,
    *,
    r2_key: str | None = None,
    file_path: str | None = None,
) -> dict[str, Any]:
    """Process a single audio submission through the zero-storage lifecycle.

    Two entry modes are supported:
        - r2_key:  the file is already on R2 (3-phase flow). The lifecycle
                   downloads it to /tmp and proceeds.
        - file_path: the file is already on local disk (legacy fallback from
                   /api/upload). The lifecycle uses it directly.

    Pipeline (Phase 2 of upload-progress-improvement):
        1. Acquire the file (download from R2 OR use the local file).
        2. Analyze audio (BPM, LUFS, phase correlation, musical key).
        3. Compare results against sonic signature rules and severity logic.
        4. Convert WAV to MP3 preview asynchronously with sub-progress.
        5. Upload MP3 preview and waveform JSON in PARALLEL to R2.
           (The original WAV is already on R2 — uploaded directly by the
           frontend via the presigned URL — so we skip re-uploading it.)
        6. Clean up all local files (WAV, MP3) from the server immediately.

    If on_progress is provided, it's called with (stage_label, percent) at each step.
    The progress events span 0%..95% in roughly:
        0..50%  — frontend-side direct R2 upload (out of band)
        50..60% — downloading original from R2 (or skipped in legacy mode)
        60..80% — analyzing + converting to MP3
        80..95% — parallel upload of MP3 + JSON
    """
    if (r2_key is None) == (file_path is None):
        raise ValueError(
            "process_submission requires exactly one of r2_key or file_path"
        )

    async def _progress(stage: str, pct: int):
        if on_progress:
            await on_progress(stage, pct)

    metrics: dict[str, Any] = {}
    mp3_temp_path: str | None = None
    r2_mp3_url: str | None = None
    r2_original_path: str | None = None
    r2_mp3_key: str | None = None
    r2_peaks_key: str | None = None
    status: str = "inbox"
    rejection_reason: str | None = None
    downloaded_file_path: str | None = None

    try:
        # Step 1: Acquire the file.
        if r2_key is not None:
            # Download from R2 to /tmp with progress events.
            ext = Path(r2_key).suffix.lower() or ".wav"
            downloaded_file_path = f"/tmp/{submission_id}{ext}"
            await _progress("Descargando original...", 50)
            download_loop = asyncio.get_event_loop()

            def _bridge(transferred: int, total: int) -> None:
                # Map the download's 0..100% onto the overall 50..60% slice.
                if total <= 0:
                    return
                sub = int((transferred / total) * 100)
                sub = max(0, min(100, sub))
                overall = 50 + int(sub * 0.10)  # 50..60
                # Marshal onto the main event loop.
                try:
                    future = asyncio.run_coroutine_threadsafe(
                        _progress("Descargando original...", overall),
                        download_loop,
                    )
                    # Don't block the boto3 worker thread; if the loop is gone,
                    # the future is silently discarded.
                    future.result(timeout=0.1)
                except Exception:  # noqa: BLE001
                    pass

            await download_file_with_progress(r2_key, downloaded_file_path, on_progress=_bridge)
            await _progress("Descargando original...", 60)
            file_path = downloaded_file_path
        else:
            # Legacy: the file is already on local disk; jump to 60%.
            await _progress("Procesando audio...", 60)

        # Step 2: Analyze audio. The analyzer emits its own intermediate
        # progress in the 15..40 range; remap that onto the 60..72 slice
        # of the overall bar so the UI never goes backwards.
        async def _analysis_progress(stage: str, sub_pct: int) -> None:
            sub_pct = max(0, min(40, sub_pct))
            overall = 60 + int((sub_pct / 40) * 12)  # 60..72
            await _progress(stage, overall)

        metrics = await analyze_audio(file_path, on_progress=_analysis_progress)

        # Step 3: Compare against sonic signature and compute technical status
        await _progress("Evaluando firma sónica...", 72)
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
            # Bypass R2 storage and conversion, clean up local WAV file and return.
            # Only clean up what we own (the downloaded file); the legacy
            # file_path is owned by the caller.
            if downloaded_file_path and os.path.exists(downloaded_file_path):
                _safe_remove(downloaded_file_path)
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

        # Step 4: Convert to MP3 locally in /tmp (async, with sub-progress).
        await _progress("Convirtiendo a MP3...", 73)
        mp3_temp_path = f"/tmp/{submission_id}.mp3"

        # We wrap _convert_to_mp3 in a coroutine that knows how to remap
        # the 0..99 sub-progress onto 73..80 overall.
        duration_sec = metrics.get("duration") or None

        async def _remapped_progress(stage: str, sub_pct: int) -> None:
            sub_pct = max(0, min(99, sub_pct))
            overall = 73 + int(sub_pct * 0.07)  # 73..79
            await _progress(stage, overall)

        try:
            await convert_to_mp3(
                file_path,
                mp3_temp_path,
                bitrate="320k",
                duration_seconds=duration_sec,
                on_progress=_remapped_progress,
            )
        except ConversionError as e:
            # Conversion failed — treat as rejected and raise
            status = "auto_rejected"
            rejection_reason = f"conversion_failed: {e}"
            raise AudioAnalysisError(f"Audio conversion failed: {e}") from e

        # Step 5: Upload results to R2. In the new flow, the original WAV
        # is already on R2 (uploaded via the presigned URL) so we only need
        # to push the MP3 preview and the waveform JSON. In the legacy
        # fallback the file arrived via multipart, so we must also upload
        # the original to keep HQ retention working.
        r2_mp3_key = f"tracks/{submission_id}/preview.mp3"
        r2_peaks_key = f"tracks/{submission_id}/waveform.json"
        ext = Path(file_path).suffix.lower() or ".wav"
        r2_original_key = f"tracks/{submission_id}/original{ext}"
        # Content-type for the original
        if ext == ".wav":
            orig_content_type = "audio/wav"
        elif ext == ".flac":
            orig_content_type = "audio/flac"
        elif ext in (".aiff", ".aif"):
            orig_content_type = "audio/aiff"
        else:
            orig_content_type = "application/octet-stream"

        peaks = metrics.get("peaks", [])
        duration = metrics.get("duration", 0.0)
        peaks_data = json.dumps({"peaks": peaks, "duration": duration}).encode("utf-8")

        await _progress("Subiendo assets a R2...", 80)

        async def _upload_mp3() -> None:
            await upload_file_to_r2(mp3_temp_path, r2_mp3_key, "audio/mpeg")

        async def _upload_json() -> None:
            await upload_bytes_to_r2(peaks_data, r2_peaks_key, "application/json")

        async def _upload_original() -> None:
            await upload_file_to_r2(file_path, r2_original_key, orig_content_type)

        # Build the list of parallel uploads. The original is only
        # uploaded in legacy mode (the new 3-phase flow already has it).
        upload_tasks = [_upload_mp3(), _upload_json()]
        if r2_key is None:
            upload_tasks.append(_upload_original())

        # Run uploads in parallel. If any fail, asyncio.gather propagates
        # the first exception and we clean up below.
        await asyncio.gather(*upload_tasks)

        await _progress("Subiendo assets a R2...", 90)

        # Set R2 paths for DB persistence
        public_url_base = os.getenv("CLOUDFLARE_R2_PUBLIC_URL", "").rstrip("/")
        r2_mp3_url = f"{public_url_base}/{r2_mp3_key}"
        r2_original_path = r2_original_key

    except Exception:
        # Rollback partial uploads so we don't leave orphan objects.
        # Only delete the keys we created ourselves — in the new flow the
        # original WAV is the user's file and must NOT be deleted.
        if r2_mp3_key is not None:
            try:
                await delete_file_from_r2(r2_mp3_key)
            except Exception:  # noqa: BLE001
                pass
        if r2_peaks_key is not None:
            try:
                await delete_file_from_r2(r2_peaks_key)
            except Exception:  # noqa: BLE001
                pass
        # In legacy mode, the original was uploaded by US, so we can
        # safely clean it up on failure. In the new flow, the user owns
        # the object and we leave it alone.
        if r2_key is None and r2_original_path is not None:
            try:
                await delete_file_from_r2(r2_original_path)
            except Exception:  # noqa: BLE001
                pass
        raise
    finally:
        # Step 6: ALWAYS clean up local files
        # Only remove the file we created (downloaded from R2). In legacy
        # mode the caller owns file_path and is responsible for cleanup.
        if downloaded_file_path and os.path.exists(downloaded_file_path):
            _safe_remove(downloaded_file_path)
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
