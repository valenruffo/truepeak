"""Audio feature extraction using librosa, pyloudnorm, and scipy."""

from __future__ import annotations

import asyncio
import gc
from collections.abc import Awaitable, Callable
from typing import Any

import librosa
import numpy as np
import pyloudnorm as pyln

from app.audio.exceptions import AudioAnalysisError


def _extract_waveform_peaks(y: np.ndarray, target_points: int = 2000) -> list[float]:
    """Extract waveform peaks from audio signal for WaveSurfer.js.

    Uses RMS (energy) per window instead of raw peak to show actual dynamics:
    quiet sections produce short bars, loud/dense sections produce tall bars.
    A small floor prevents silent windows from disappearing entirely.

    Args:
        y: Audio signal (mono or stereo).
        target_points: Number of peak pairs to return.

    Returns:
        List of peak values in [-1.0, 1.0] range (not globally normalized).
    """
    y_mono = librosa.to_mono(y) if y.ndim == 2 else y

    src_len = len(y_mono)
    if src_len == 0:
        return [0.0] * target_points

    window_size = max(1, src_len // (target_points * 2))

    peaks: list[float] = []
    for i in range(0, src_len, window_size):
        chunk = y_mono[i : i + window_size]
        if len(chunk) == 0:
            break
        # Use RMS for the "body" of the bar — shows energy/density, not just max sample
        rms = float(np.sqrt(np.mean(chunk ** 2)))
        # Use peak for the "tip" — preserves transient detail
        positive_peak = float(np.max(chunk))
        negative_peak = float(np.min(chunk))
        # Blend: 70% RMS (energy) + 30% peak (transients) for natural look
        pos_value = 0.7 * rms + 0.3 * positive_peak
        neg_value = -(0.7 * rms + 0.3 * abs(negative_peak))
        peaks.append(pos_value)
        peaks.append(neg_value)
        if len(peaks) >= target_points * 2:
            break

    # Small floor so silent sections don't vanish, but no global normalization.
    # Scale up so the waveform uses the vertical space well (RMS values are
    # naturally smaller than peaks — typically 0.1-0.3 vs 0.9-1.0).
    floor = 0.02
    scale = 3.0  # amplify RMS-dominant values to fill the display height
    peaks = [
        min(max(p * scale, floor), 1.0) if p >= 0 else max(min(p * scale, -floor), -1.0)
        for p in peaks
    ]

    return peaks


def _detect_musical_key(chroma: np.ndarray) -> str:
    """Detect the musical key and map to Camelot Wheel format (1A-12B)."""
    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    # Camelot mappings: index 0=C, 1=C#, 2=D, 3=D#, 4=E, 5=F, 6=F#, 7=G, 8=G#, 9=A, 10=A#, 11=B
    camelot_major = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"]
    camelot_minor = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"]

    chroma_mean = np.mean(chroma, axis=1)
    chroma_norm = chroma_mean / np.max(chroma_mean) if np.max(chroma_mean) > 0 else chroma_mean

    best_correlation = -1
    best_key_index = 0
    best_mode = "major"

    for i in range(12):
        major_rotated = np.roll(major_profile, i)
        minor_rotated = np.roll(minor_profile, i)

        major_corr = np.corrcoef(chroma_norm, major_rotated)[0, 1]
        minor_corr = np.corrcoef(chroma_norm, minor_rotated)[0, 1]

        if major_corr > best_correlation:
            best_correlation = major_corr
            best_key_index = i
            best_mode = "major"

        if minor_corr > best_correlation:
            best_correlation = minor_corr
            best_key_index = i
            best_mode = "minor"

    return camelot_major[best_key_index] if best_mode == "major" else camelot_minor[best_key_index]


def _compute_phase_correlation(y: np.ndarray) -> float:
    """Compute stereo phase correlation (-1 to 1) from audio signal."""
    if y.ndim == 1:
        return 1.0

    if y.ndim != 2 or y.shape[0] < 2:
        return 0.0

    left = y[0].astype(np.float64)
    right = y[1].astype(np.float64)

    left_norm = left - np.mean(left)
    right_norm = right - np.mean(right)

    denominator = np.sqrt(np.sum(left_norm**2) * np.sum(right_norm**2))
    if denominator == 0:
        return 0.0

    correlation = np.sum(left_norm * right_norm) / denominator
    return float(np.clip(correlation, -1.0, 1.0))


def _load_audio(file_path: str) -> tuple:
    """Load audio file — heaviest step (disk decode + resample)."""
    return librosa.load(file_path, sr=None, mono=False)


def _detect_bpm(y_mono, sr):
    """Detect BPM via beat tracking."""
    tempo, _ = librosa.beat.beat_track(y=y_mono, sr=sr)
    return float(tempo) if np.isscalar(tempo) else float(tempo[0])


def _measure_lufs(y, sr):
    """Measure integrated LUFS loudness."""
    audio = y.reshape(-1, 1) if y.ndim == 1 else y.T
    meter = pyln.Meter(sr)
    return meter.integrated_loudness(audio)


def _detect_key(y_mono, sr):
    """Detect musical key via chroma features."""
    chroma = librosa.feature.chroma_stft(y=y_mono, sr=sr)
    return _detect_musical_key(chroma)


async def analyze_audio(
    file_path: str,
    on_progress: Callable[[str, int], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    """Analyze audio file and extract features with intermediate progress."""

    async def _progress(stage: str, pct: int):
        if on_progress:
            await on_progress(stage, pct)

    # Step 1: Load audio (heaviest — disk I/O + decode)
    await _progress("Cargando audio...", 15)
    y, sr = await asyncio.to_thread(_load_audio, file_path)

    # Waveform peaks (fast — already have y in memory)
    y_mono = librosa.to_mono(y) if y.ndim == 2 else y
    peaks = _extract_waveform_peaks(y)
    await _progress("Extrayendo waveform...", 22)

    # Step 2: BPM (moderate — beat tracking)
    bpm = await asyncio.to_thread(_detect_bpm, y_mono, sr)
    await _progress("Detectando BPM...", 28)

    # Step 3: LUFS (fast — loudness meter)
    lufs = await asyncio.to_thread(_measure_lufs, y, sr)
    await _progress("Midiendo sonoridad...", 33)

    # Step 4: Phase correlation (fast — numpy ops)
    phase = _compute_phase_correlation(y)
    await _progress("Analizando fase...", 37)

    # Step 5: Musical key (moderate — STFT chroma)
    musical_key = await asyncio.to_thread(_detect_key, y_mono, sr)
    await _progress("Detectando tonalidad...", 40)

    # Step 6: Duration, peak, crest (fast)
    duration = float(len(y_mono) / sr) if sr and len(y_mono) > 0 else 0.0
    true_peak = float(np.max(np.abs(y)))
    rms = float(np.sqrt(np.mean(y**2)))
    crest_factor = float(20 * np.log10(true_peak / (rms + 1e-10))) if rms > 0 else 0.0

    try:
        return {
            "bpm": float(round(bpm, 2)),
            "lufs": float(round(lufs, 2)),
            "true_peak": float(round(true_peak, 4)),
            "crest_factor": float(round(crest_factor, 2)),
            "phase_correlation": float(round(phase, 4)),
            "musical_key": musical_key,
            "duration": float(round(duration, 1)),
            "peaks": peaks,
        }
    finally:
        del y
        del sr
        gc.collect()
