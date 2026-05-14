"""Audio feature extraction using librosa, pyloudnorm, and scipy."""

import asyncio
import gc
from typing import Any

import librosa
import numpy as np
import pyloudnorm as pyln

from app.audio.exceptions import AudioAnalysisError


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


def _analyze_audio_sync(file_path: str) -> dict[str, Any]:
    """Synchronous audio analysis — must be called via asyncio.to_thread."""
    y: np.ndarray | None = None
    sr: int | None = None

    try:
        y, sr = librosa.load(file_path, sr=None, mono=False)

        # Convert to mono for beat tracking and chroma (librosa 0.11+ requires mono)
        y_mono = librosa.to_mono(y) if y.ndim == 2 else y

        # --- BPM detection ---
        tempo, _ = librosa.beat.beat_track(y=y_mono, sr=sr)
        bpm = float(tempo) if np.isscalar(tempo) else float(tempo[0])

        # --- Integrated LUFS ---
        if y.ndim == 1:
            audio_for_loudness = y.reshape(-1, 1)
        else:
            audio_for_loudness = y.T

        meter = pyln.Meter(sr)
        lufs = meter.integrated_loudness(audio_for_loudness)

        # --- Phase correlation ---
        phase_correlation = _compute_phase_correlation(y)

        # --- Musical key detection ---
        chroma = librosa.feature.chroma_stft(y=y_mono, sr=sr)
        musical_key = _detect_musical_key(chroma)

        # --- Duration ---
        duration = float(len(y_mono) / sr) if sr and len(y_mono) > 0 else 0.0

        # --- Peak and Crest Factor ---
        # Calculate max absolute peak (Sample Peak)
        true_peak = float(np.max(np.abs(y)))

        # Calculate Crest Factor in dB: 20 * log10(peak / (rms + epsilon))
        rms = float(np.sqrt(np.mean(y**2)))
        crest_factor = float(20 * np.log10(true_peak / (rms + 1e-10))) if rms > 0 else 0.0

        return {
            "bpm": round(bpm, 2),
            "lufs": round(lufs, 2),
            "true_peak": round(true_peak, 4),
            "crest_factor": round(crest_factor, 2),
            "phase_correlation": round(phase_correlation, 4),
            "musical_key": musical_key,
            "duration": round(duration, 1),
        }

    except librosa.LibrosaError as e:
        raise AudioAnalysisError(f"Librosa analysis failed: {e}") from e
    except Exception as e:
        raise AudioAnalysisError(f"Audio analysis failed: {e}") from e
    finally:
        del y
        del sr
        gc.collect()


async def analyze_audio(file_path: str) -> dict[str, Any]:
    """Analyze audio file and extract features."""
    return await asyncio.to_thread(_analyze_audio_sync, file_path)
