"""Deterministic, provider-independent windows from already-decoded audio arrays.

Input arrays are mono ``(samples,)`` or channel-first ``(channels, samples)``. For
multichannel input, channels contribute equally to a float64 mono mix; no decoder,
normalization, or resampling is performed. Sample bounds are half-open indices in
the original decoded timeline, and timestamps are those indices divided by the
original source sample rate. Silence trimming therefore never rebases time.

Silence detection is a simple configurable heuristic, not an optimal music/speech
VAD: a mono sample is active only when its absolute amplitude is strictly greater
than ``max(absolute_threshold, relative_threshold * peak)``. A frame is usable
when at least ``frame_active_fraction`` of its samples are active. The last short
frame uses its actual sample count. Usable bounds run from the first active sample
in the first usable frame to one past the last active sample in the last usable
frame; audio with no usable frame raises ``AudioPreprocessingError``.

All sample-count and center-offset rounding uses round-half-up ``floor(x + 0.5)``
for nonnegative values. A fraction maps to a sample center within the inclusive
usable sample-index range. A window starts ``window_length // 2`` samples before
that center, then clamps to the usable half-open bounds. Windows are returned in
chronological order with repeated bounds removed. Each returned ``samples`` array
is float64, detached from caller storage, and backed by immutable bytes; the frozen
record and buffer are read-only, but metadata describes source coordinates/rate,
not a provider-ready or resampled representation.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

_DEFAULT_CENTER_FRACTIONS = (0.15, 0.32, 0.50, 0.68, 0.85)


class AudioPreprocessingError(ValueError):
    """Decoded audio or its preprocessing configuration is invalid or unusable."""


@dataclass(frozen=True, slots=True)
class AudioWindow:
    """An immutable real-audio slice with half-open original-timeline bounds.

    ``samples`` contains an independent float64 mono copy in read-only storage;
    ``start_sample`` and ``end_sample`` refer to the input's original sample rate.
    """

    start_sample: int
    end_sample: int
    start_seconds: float
    end_seconds: float
    sample_rate: int
    samples: np.ndarray


def _finite_real(value: object, *, name: str) -> float:
    if isinstance(value, (bool, np.bool_, str, bytes, complex, np.complexfloating)):
        raise AudioPreprocessingError(f"{name} must be a finite real number")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise AudioPreprocessingError(f"{name} must be a finite real number") from error
    if not np.isfinite(number):
        raise AudioPreprocessingError(f"{name} must be a finite real number")
    return number


def _round_half_up(value: float) -> int:
    """Round a nonnegative finite value deterministically, with ties upward."""
    return int(np.floor(value + 0.5))


def _rounded_sample_count(seconds: float, sample_rate: int, *, name: str) -> int:
    try:
        scaled = seconds * sample_rate
    except OverflowError as error:
        raise AudioPreprocessingError(f"{name} times sample_rate is too large") from error
    if not np.isfinite(scaled):
        raise AudioPreprocessingError(f"{name} times sample_rate is too large")
    return max(1, _round_half_up(scaled))


def _validate_audio_array(samples: np.ndarray) -> np.ndarray:
    if not isinstance(samples, np.ndarray):
        raise AudioPreprocessingError("samples must be a NumPy decoded-audio array")
    if samples.ndim not in (1, 2):
        raise AudioPreprocessingError("samples must have mono or channel-first audio shape")
    if samples.size == 0 or (samples.ndim == 2 and samples.shape[0] == 0):
        raise AudioPreprocessingError("samples must be nonempty")
    if samples.dtype.kind not in "iuf":
        raise AudioPreprocessingError("samples must contain finite real, non-boolean values")

    with np.errstate(over="ignore", invalid="ignore"):
        decoded = np.asarray(samples, dtype=np.float64)
    if not np.isfinite(decoded).all():
        raise AudioPreprocessingError("samples must contain finite real values")

    if decoded.ndim == 1:
        mono = decoded
    else:
        # Divide before summing so a finite multichannel mean does not overflow
        # merely because the unscaled channel sum would exceed float64 range.
        channel_count = decoded.shape[0]
        mono = np.sum(decoded / channel_count, axis=0, dtype=np.float64)
    if mono.size == 0 or not np.isfinite(mono).all():
        raise AudioPreprocessingError("mono audio is empty or unusable")
    return mono


def _validate_center_fractions(center_fractions: object) -> tuple[float, ...]:
    if isinstance(center_fractions, (str, bytes)):
        raise AudioPreprocessingError("center_fractions must be a nonempty iterable in [0, 1]")
    try:
        values = tuple(center_fractions)  # type: ignore[arg-type]
    except (TypeError, ValueError) as error:
        raise AudioPreprocessingError(
            "center_fractions must be a nonempty iterable in [0, 1]"
        ) from error
    if not values:
        raise AudioPreprocessingError("center_fractions must be a nonempty iterable in [0, 1]")

    fractions: list[float] = []
    for value in values:
        fraction = _finite_real(value, name="center_fractions values")
        if not 0.0 <= fraction <= 1.0:
            raise AudioPreprocessingError("center_fractions values must be in [0, 1]")
        fractions.append(fraction)
    return tuple(fractions)


def _find_usable_bounds(
    mono: np.ndarray,
    *,
    sample_rate: int,
    relative_threshold: float,
    absolute_threshold: float,
    frame_duration_seconds: float,
    frame_active_fraction: float,
) -> tuple[int, int]:
    peak = float(np.max(np.abs(mono)))
    threshold = max(absolute_threshold, relative_threshold * peak)
    active = np.abs(mono) > threshold
    frame_samples = min(
        _rounded_sample_count(frame_duration_seconds, sample_rate, name="frame_duration_seconds"),
        mono.size,
    )

    first_active: int | None = None
    last_active: int | None = None
    for frame_start in range(0, mono.size, frame_samples):
        frame_end = min(frame_start + frame_samples, mono.size)
        frame_active = active[frame_start:frame_end]
        if np.count_nonzero(frame_active) / (frame_end - frame_start) < frame_active_fraction:
            continue
        active_offsets = np.flatnonzero(frame_active)
        if first_active is None:
            first_active = frame_start + int(active_offsets[0])
        last_active = frame_start + int(active_offsets[-1])

    if first_active is None or last_active is None:
        raise AudioPreprocessingError("audio is silent or unusable under the configured thresholds")
    return first_active, last_active + 1


def prepare_audio_windows(
    samples: np.ndarray,
    sample_rate: int,
    *,
    context_seconds: float = 10.0,
    center_fractions: tuple[float, ...] = _DEFAULT_CENTER_FRACTIONS,
    relative_threshold: float = 0.01,
    absolute_threshold: float = 1e-4,
    frame_duration_seconds: float = 0.05,
    frame_active_fraction: float = 0.1,
) -> tuple[AudioWindow, ...]:
    """Create distinct representative mono windows without modifying decoded input.

    ``sample_rate`` is a positive integer source rate and is retained unchanged;
    this helper intentionally does not resample or enforce an embedding-provider
    rate. The default 10-second context and five center fractions are configurable.
    Thresholds combine a peak-relative ratio with an absolute amplitude floor, and
    frame activity is the minimum proportion of above-threshold samples.
    """
    if isinstance(sample_rate, (bool, np.bool_)) or not isinstance(sample_rate, (int, np.integer)):
        raise AudioPreprocessingError("sample_rate must be a positive integer")
    source_rate = int(sample_rate)
    if source_rate <= 0:
        raise AudioPreprocessingError("sample_rate must be a positive integer")

    context = _finite_real(context_seconds, name="context_seconds")
    if context <= 0:
        raise AudioPreprocessingError("context_seconds must be positive")
    fractions = _validate_center_fractions(center_fractions)

    relative = _finite_real(relative_threshold, name="relative_threshold")
    if not 0.0 <= relative <= 1.0:
        raise AudioPreprocessingError("relative_threshold must be in [0, 1]")
    absolute = _finite_real(absolute_threshold, name="absolute_threshold")
    if absolute < 0:
        raise AudioPreprocessingError("absolute_threshold must be nonnegative")
    frame_duration = _finite_real(frame_duration_seconds, name="frame_duration_seconds")
    if frame_duration <= 0:
        raise AudioPreprocessingError("frame_duration_seconds must be positive")
    frame_fraction = _finite_real(frame_active_fraction, name="frame_active_fraction")
    if not 0.0 < frame_fraction <= 1.0:
        raise AudioPreprocessingError("frame_active_fraction must be in (0, 1]")

    mono = _validate_audio_array(samples)
    usable_start, usable_end = _find_usable_bounds(
        mono,
        sample_rate=source_rate,
        relative_threshold=relative,
        absolute_threshold=absolute,
        frame_duration_seconds=frame_duration,
        frame_active_fraction=frame_fraction,
    )
    usable_length = usable_end - usable_start
    context_samples = min(
        _rounded_sample_count(context, source_rate, name="context_seconds"), usable_length
    )
    latest_start = usable_end - context_samples

    bounds: set[tuple[int, int]] = set()
    for fraction in fractions:
        center_sample = usable_start + _round_half_up(fraction * (usable_length - 1))
        desired_start = center_sample - context_samples // 2
        start_sample = max(usable_start, min(desired_start, latest_start))
        bounds.add((start_sample, start_sample + context_samples))

    windows: list[AudioWindow] = []
    for start_sample, end_sample in sorted(bounds):
        # Immutable bytes prevent callers from restoring write access with setflags.
        immutable_content = mono[start_sample:end_sample].copy().tobytes(order="C")
        output = np.frombuffer(immutable_content, dtype=np.float64)
        windows.append(
            AudioWindow(
                start_sample=start_sample,
                end_sample=end_sample,
                start_seconds=start_sample / source_rate,
                end_seconds=end_sample / source_rate,
                sample_rate=source_rate,
                samples=output,
            )
        )
    return tuple(windows)
