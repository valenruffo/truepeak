from __future__ import annotations

import io
import sys
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from app.audio.embedding.openl3_provider import (
    OpenL3AudioError,
    OpenL3EmbeddingProvider,
    OpenL3ModelError,
)


def encoded_audio(
    *,
    format: str = "WAV",
    frames: int = 800,
    sample_rate: int = 8_000,
    channels: int = 1,
    nonfinite: bool = False,
) -> bytes:
    samples = np.cos(2 * np.pi * 440 * np.arange(frames) / sample_rate)
    if nonfinite:
        samples[frames // 2] = np.nan
    if channels > 1:
        samples = np.tile(samples[:, None], (1, channels))
    buffer = io.BytesIO()
    sf.write(buffer, samples, sample_rate, format=format, subtype="FLOAT" if nonfinite else None)
    return buffer.getvalue()


def test_injected_inference_pools_frames_and_windows_with_source_timestamps() -> None:
    loaded: list[object] = []
    rates: list[int] = []
    model = object()

    def infer(actual: object, samples: np.ndarray, rate: int) -> tuple[np.ndarray, np.ndarray]:
        assert actual is model
        rates.append(rate)
        if len(rates) % 5 < 4:
            return np.array([[100.0, 0.0] + [0.0] * 510, [0.0, 1.0] + [0.0] * 510]), [0, 0.1]
        return np.array([[0.0, 1.0] + [0.0] * 510]), [0]

    provider = OpenL3EmbeddingProvider(
        max_decoded_frames=1_000,
        max_channels=2,
        model_loader=lambda: loaded.append(model) or model,
        inference=infer,
    )
    audio = encoded_audio(frames=1_000, sample_rate=10)

    assert loaded == []  # Metadata and construction do not initialize OpenL3.
    segments = provider.generate_segment_embeddings(audio)
    track = provider.generate_track_embedding(audio)

    diagonal = 4 / np.sqrt(2)
    expected = np.array([diagonal, diagonal + 1])
    expected /= np.linalg.norm(expected)
    assert len(segments) == 5
    assert all(segment.metadata.dimension == 512 for segment in segments)
    assert all(
        a.end_seconds <= b.start_seconds for a, b in zip(segments, segments[1:], strict=False)
    )
    assert track.vector[:2] == pytest.approx(expected)
    assert rates == [10] * 10
    assert loaded == [model]


@pytest.mark.parametrize("format", ["WAV", "FLAC", "AIFF"])
def test_decoder_accepts_reference_container_formats(format: str) -> None:
    provider = OpenL3EmbeddingProvider(
        max_decoded_frames=1_000,
        max_channels=1,
        model_loader=object,
        inference=lambda *_: (np.ones((1, 512)), [0]),
    )
    assert len(provider.generate_segment_embeddings(encoded_audio(format=format))) == 1


@pytest.mark.parametrize("value", [0, -1, True, 1.0, "10", None])
@pytest.mark.parametrize("name", ["max_decoded_frames", "max_channels"])
def test_decode_limits_must_be_explicit_strict_positive_integers(name: str, value: object) -> None:
    limits = {"max_decoded_frames": 10, "max_channels": 2, name: value}
    with pytest.raises(ValueError, match=name):
        OpenL3EmbeddingProvider(**limits)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("audio", "frames", "channels"),
    [
        (b"", 1_000, 2),
        (b"ID3-not-a-container", 1_000, 2),
        (b"RIFF\x00\x00\x00\x00WAVE", 1_000, 2),
        (encoded_audio(), 799, 2),
        (encoded_audio(channels=2), 1_000, 1),
        (encoded_audio(nonfinite=True), 1_000, 2),
    ],
)
def test_decoder_rejects_empty_unsupported_malformed_nonfinite_or_oversized_audio(
    audio: bytes,
    frames: int,
    channels: int,
) -> None:
    provider = OpenL3EmbeddingProvider(
        max_decoded_frames=frames,
        max_channels=channels,
        model_loader=object,
        inference=lambda *_: pytest.fail("inference must not run"),
    )
    with pytest.raises(OpenL3AudioError):
        provider.generate_segment_embeddings(audio)


def test_openl3_timestamp_at_window_duration_is_valid() -> None:
    provider = OpenL3EmbeddingProvider(
        max_decoded_frames=1_000,
        max_channels=1,
        model_loader=object,
        inference=lambda *_: (np.ones((1, 512)), [0.1]),
    )

    segments = provider.generate_segment_embeddings(encoded_audio())

    assert len(segments) == 1
    assert (segments[0].start_seconds, segments[0].end_seconds) == pytest.approx((0.0, 0.1))


@pytest.mark.parametrize(
    ("vectors", "timestamps"),
    [
        (np.ones((1, 511)), [0]),
        (np.ones((2, 512)), [0]),
        (np.full((1, 512), np.nan), [0]),
        (np.ones((1, 512)), [0.11]),
        (np.ones((1, 512)), [-0.01]),
        (np.ones((1, 512)), [np.nan]),
        (np.ones((2, 512)), [0.05, 0.01]),
        (np.zeros((1, 512)), [0]),
    ],
)
def test_model_outputs_require_finite_512d_embeddings_and_aligned_timestamps(
    vectors: np.ndarray,
    timestamps: list[float],
) -> None:
    provider = OpenL3EmbeddingProvider(
        max_decoded_frames=1_000,
        max_channels=1,
        model_loader=object,
        inference=lambda *_: (vectors, timestamps),
    )
    with pytest.raises(OpenL3ModelError):
        provider.generate_segment_embeddings(encoded_audio())


def test_default_model_and_frontend_load_lazily_with_pinned_options(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []
    models = SimpleNamespace(
        load_audio_embedding_model=lambda **kw: calls.append(("load", kw)) or "model"
    )
    fake = SimpleNamespace(
        models=models,
        get_audio_embedding=lambda samples, rate, **kw: (
            calls.append(("infer", {"sample_rate": rate, **kw})) or np.ones((1, 512), dtype=float),
            np.array([0.0]),
        ),
    )
    monkeypatch.setitem(sys.modules, "openl3", fake)
    provider = OpenL3EmbeddingProvider(max_decoded_frames=1_000, max_channels=1)

    assert provider.metadata().version == "0.4.2-representative-window-normalized-pool-v1"
    assert calls == []
    provider.generate_segment_embeddings(encoded_audio())
    expected_options = dict(input_repr="mel256", content_type="music", embedding_size=512)
    assert calls[0] == ("load", expected_options)
    assert calls[1][0] == "infer"
    assert calls[1][1]["sample_rate"] == 8_000
    assert calls[1][1]["center"] is True and calls[1][1]["hop_size"] == 0.1
