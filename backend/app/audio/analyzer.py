"""Audio feature extraction using librosa, pyloudnorm, and scipy."""

import asyncio
import gc
from typing import Any

import librosa
import numpy as np
import pyloudnorm as pyln

from app.audio.exceptions import AudioAnalysisError


def _detect_musical_key(chroma: np.ndarray) -> str:
    """Detect the musical key from chroma features using the Krumhansl-Schmuckler algorithm."""
    major_profile = np.array([
        6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
    ])
    minor_profile = np.array([
        6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
    ])

    note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

    chroma_mean = np.mean(chroma, axis=1)
    chroma_norm = chroma_mean / np.max(chroma_mean) if np.max(chroma_mean) > 0 else chroma_mean

    best_correlation = -1
    best_key = "C"
    best_mode = "major"

    for i in range(12):
        major_rotated = np.roll(major_profile, i)
        minor_rotated = np.roll(minor_profile, i)

        major_corr = np.corrcoef(chroma_norm, major_rotated)[0, 1]
        minor_corr = np.corrcoef(chroma_norm, minor_rotated)[0, 1]

        if major_corr > best_correlation:
            best_correlation = major_corr
            best_key = note_names[i]
            best_mode = "major"

        if minor_corr > best_correlation:
            best_correlation = minor_corr
            best_key = note_names[i]
            best_mode = "minor"

    suffix = "" if best_mode == "major" else "m"
    return f"{best_key}{suffix}"


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

        return {
            "bpm": round(bpm, 2),
            "lufs": round(lufs, 2),
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
