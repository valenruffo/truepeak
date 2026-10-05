from __future__ import annotations

from dataclasses import FrozenInstanceError

import numpy as np
import pytest

from app.audio.embedding.preprocessing import (
    AudioPreprocessingError,
    AudioWindow,
    prepare_audio_windows,
)


def test_long_track_uses_all_five_centers_with_half_up_sample_rounding() -> None:
    source = np.ones(1_000, dtype=np.float64)

    windows = prepare_audio_windows(source, 10, context_seconds=2.0)

    assert [(window.start_sample, window.end_sample) for window in windows] == [
        (140, 160),
        (310, 330),
        (490, 510),
        (669, 689),
        (839, 859),
    ]
    assert [window.start_seconds for window in windows] == pytest.approx(
        [14.0, 31.0, 49.0, 66.9, 83.9]
    )
    assert [window.end_seconds for window in windows] == pytest.approx(
        [16.0, 33.0, 51.0, 68.9, 85.9]
    )
    assert all(window.sample_rate == 10 for window in windows)
    assert all(window.samples.shape == (20,) for window in windows)


def test_center_fractions_are_sorted_and_identical_bounds_are_deduplicated() -> None:
    windows = prepare_audio_windows(
        np.ones(20),
        10,
        context_seconds=0.5,
        center_fractions=(1.0, 0.5, 0.0, 0.5),
    )

    assert [(window.start_sample, window.end_sample) for window in windows] == [
        (0, 5),
        (8, 13),
        (15, 20),
    ]


def test_nonsilent_bounds_keep_original_timeline_and_never_mutate_source() -> None:
    source = np.zeros(1_000, dtype=np.float64)
    source[100:900] = 0.5
    before = source.copy()

    windows = prepare_audio_windows(
        source,
        10,
        context_seconds=2,
        center_fractions=(0.15, 0.5, 0.85),
    )

    assert [(window.start_sample, window.end_sample) for window in windows] == [
        (210, 230),
        (490, 510),
        (769, 789),
    ]
    assert windows[0].start_seconds == 21.0
    assert windows[-1].end_seconds == 78.9
    np.testing.assert_array_equal(source, before)


def test_channel_first_stereo_is_averaged_deterministically_without_aliases() -> None:
    source = np.array([[0.0, 2.0, 4.0, 6.0], [2.0, 4.0, 6.0, 8.0]], dtype=np.float32)
    before = source.copy()

    windows = prepare_audio_windows(
        source,
        2,
        context_seconds=2.0,
        center_fractions=(0.5,),
        frame_duration_seconds=0.5,
    )

    assert len(windows) == 1
    np.testing.assert_array_equal(windows[0].samples, np.array([1.0, 3.0, 5.0, 7.0]))
    np.testing.assert_array_equal(source, before)
    assert not np.shares_memory(source, windows[0].samples)


def test_short_track_returns_one_real_unpadded_window() -> None:
    source = np.arange(5, dtype=np.float64) + 1

    windows = prepare_audio_windows(source, 10, context_seconds=10.0)

    assert len(windows) == 1
    assert (windows[0].start_sample, windows[0].end_sample) == (0, 5)
    np.testing.assert_array_equal(windows[0].samples, source)


def test_track_just_longer_than_context_keeps_distinct_real_windows() -> None:
    source = np.arange(12, dtype=np.float64) + 1

    windows = prepare_audio_windows(
        source,
        1,
        context_seconds=4.0,
        center_fractions=(0.15, 0.5, 0.85),
    )

    assert [(window.start_sample, window.end_sample) for window in windows] == [
        (0, 4),
        (4, 8),
        (7, 11),
    ]
    assert all(window.samples.size == 4 for window in windows)


def test_context_and_timestamps_scale_with_source_sample_rate() -> None:
    low_rate = prepare_audio_windows(np.ones(100), 10, context_seconds=2, center_fractions=(0.5,))[
        0
    ]
    high_rate = prepare_audio_windows(np.ones(200), 20, context_seconds=2, center_fractions=(0.5,))[
        0
    ]

    assert (low_rate.start_sample, low_rate.end_sample) == (40, 60)
    assert (high_rate.start_sample, high_rate.end_sample) == (80, 120)
    assert (low_rate.start_seconds, low_rate.end_seconds) == pytest.approx((4, 6))
    assert (high_rate.start_seconds, high_rate.end_seconds) == pytest.approx((4, 6))


def test_context_sample_count_uses_half_up_rounding() -> None:
    window = prepare_audio_windows(
        np.ones(30),
        2,
        context_seconds=2.25,
        center_fractions=(0.5,),
    )[0]

    assert window.end_sample - window.start_sample == 5


def test_silence_detection_combines_peak_floor_and_frame_fraction() -> None:
    source = np.zeros(10)
    source[:2] = 0.5

    window = prepare_audio_windows(
        source,
        10,
        context_seconds=1,
        center_fractions=(0.5,),
        relative_threshold=0.1,
        absolute_threshold=0.1,
        frame_duration_seconds=0.5,
        frame_active_fraction=0.4,
    )[0]

    assert (window.start_sample, window.end_sample) == (0, 2)
    with pytest.raises(AudioPreprocessingError, match="silent or unusable"):
        prepare_audio_windows(
            source,
            10,
            context_seconds=1,
            relative_threshold=0.1,
            absolute_threshold=0.1,
            frame_duration_seconds=0.5,
            frame_active_fraction=0.41,
        )


def test_silence_comparison_is_strictly_above_combined_threshold() -> None:
    source = np.array([0.5, 0.5, 0.5, 0.5])

    with pytest.raises(AudioPreprocessingError, match="silent or unusable"):
        prepare_audio_windows(
            source,
            4,
            context_seconds=1,
            relative_threshold=1.0,
            absolute_threshold=0.0,
            frame_duration_seconds=1,
            frame_active_fraction=0.1,
        )


def test_stereo_cancellation_is_rejected_as_silent() -> None:
    source = np.stack((np.ones(100), -np.ones(100)))

    with pytest.raises(AudioPreprocessingError, match="silent or unusable"):
        prepare_audio_windows(source, 10)


@pytest.mark.parametrize(
    "source",
    [
        np.array(1.0),
        np.ones((1, 2, 3)),
        np.empty((0, 5)),
        np.empty((2, 0)),
        np.array([True, False]),
        np.array([1 + 2j, 3 + 4j]),
        np.array([1.0, np.nan]),
        np.array([1.0, np.inf]),
        np.array([-np.inf, 1.0]),
        np.array(["1", "2"]),
    ],
)
def test_invalid_decoded_arrays_raise_typed_validation_error(source: np.ndarray) -> None:
    with pytest.raises(AudioPreprocessingError):
        prepare_audio_windows(source, 10)


@pytest.mark.parametrize("sample_rate", [0, -1, 1.5, True, np.bool_(False)])
def test_invalid_sample_rates_raise_typed_validation_error(sample_rate: object) -> None:
    with pytest.raises(AudioPreprocessingError, match="sample_rate"):
        prepare_audio_windows(np.ones(10), sample_rate)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "context_seconds",
    [0, -1, True, np.bool_(True), np.nan, np.inf, -np.inf],
)
def test_invalid_context_lengths_raise_typed_validation_error(context_seconds: object) -> None:
    with pytest.raises(AudioPreprocessingError, match="context_seconds"):
        prepare_audio_windows(
            np.ones(10),
            10,
            context_seconds=context_seconds,  # type: ignore[arg-type]
        )


@pytest.mark.parametrize(
    "fractions",
    [(), (False,), (-0.1,), (1.1,), (np.nan,), (np.inf,), (0.5, "bad")],
)
def test_invalid_center_fractions_raise_typed_validation_error(fractions: object) -> None:
    with pytest.raises(AudioPreprocessingError, match="center_fractions"):
        prepare_audio_windows(
            np.ones(10),
            10,
            center_fractions=fractions,  # type: ignore[arg-type]
        )


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("relative_threshold", -0.1),
        ("relative_threshold", 1.1),
        ("relative_threshold", np.nan),
        ("relative_threshold", True),
        ("relative_threshold", np.bool_(True)),
        ("absolute_threshold", -0.1),
        ("absolute_threshold", np.inf),
        ("absolute_threshold", False),
        ("absolute_threshold", np.bool_(False)),
        ("frame_duration_seconds", 0),
        ("frame_duration_seconds", np.nan),
        ("frame_active_fraction", 0),
        ("frame_active_fraction", 1.1),
        ("frame_active_fraction", np.inf),
        ("frame_active_fraction", True),
        ("frame_active_fraction", np.bool_(True)),
    ],
)
def test_invalid_silence_configuration_is_rejected(name: str, value: object) -> None:
    with pytest.raises(AudioPreprocessingError, match=name):
        prepare_audio_windows(np.ones(10), 10, **{name: value})


def test_window_records_and_sample_buffers_are_immutable_and_independently_owned() -> None:
    source = np.arange(10, dtype=np.float64) + 1
    original = source.copy()
    windows = prepare_audio_windows(source, 10, context_seconds=0.5, center_fractions=(0.5,))
    window = windows[0]

    assert isinstance(window, AudioWindow)
    with pytest.raises(FrozenInstanceError):
        window.start_sample = 99  # type: ignore[misc]
    assert not window.samples.flags.writeable
    assert not np.shares_memory(source, window.samples)
    with pytest.raises(ValueError):
        window.samples[0] = 99
    with pytest.raises(ValueError):
        window.samples.setflags(write=True)
    with pytest.raises(AttributeError):
        windows.append(window)  # type: ignore[attr-defined]
    np.testing.assert_array_equal(source, original)


def test_readonly_window_does_not_change_if_source_is_later_modified() -> None:
    source = np.ones(20)
    window = prepare_audio_windows(source, 10, context_seconds=1, center_fractions=(0.5,))[0]

    source[:] = 8

    np.testing.assert_array_equal(window.samples, np.ones(10))
