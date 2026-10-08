"""Lazy OpenL3 0.4.2 music embeddings with caller-bounded audio decoding."""

from __future__ import annotations

from collections.abc import Callable
from io import BytesIO
from threading import Lock
from typing import Any

import numpy as np

from app.ar_matching.similarity import normalized_centroid
from app.audio.embedding.pooling import pool_segment_embeddings
from app.audio.embedding.preprocessing import (
    AudioPreprocessingError,
    AudioWindow,
    prepare_audio_windows,
)
from app.audio.embedding.schemas import (
    EmbeddingMetadata,
    EmbeddingProviderError,
    SegmentEmbedding,
    TrackEmbedding,
)

_DECODE_CHUNK_FRAMES = 65_536
_UNLOADED = object()
_METADATA = EmbeddingMetadata(
    provider="openl3",
    model="mel256-music-512",
    version="0.4.2-representative-window-normalized-pool-v1",
    dimension=512,
)


class OpenL3AudioError(EmbeddingProviderError, ValueError):
    """Encoded audio is unsupported, invalid, oversized, or unusable."""


class OpenL3ModelError(EmbeddingProviderError):
    """OpenL3 loading, inference, or returned model data is invalid."""


def _positive_limit(value: object, *, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a strictly positive integer")
    return value


def _container_format(audio: bytes) -> str:
    if len(audio) >= 12 and audio[:4] == b"RIFF" and audio[8:12] == b"WAVE":
        return "WAV"
    if len(audio) >= 12 and audio[:4] == b"FORM" and audio[8:12] in (b"AIFF", b"AIFC"):
        return "AIFF"
    if len(audio) >= 8 and audio[:4] == b"fLaC":
        return "FLAC"
    raise OpenL3AudioError("audio must be a supported WAV, FLAC, or AIFF container")


def _checked_block(block: np.ndarray, *, frames: int, channels: int) -> np.ndarray:
    if not isinstance(block, np.ndarray) or block.shape != (frames, channels):
        raise OpenL3AudioError("audio decoder returned an incomplete or malformed frame block")
    if block.dtype.kind not in "iuf" or not np.isfinite(block).all():
        raise OpenL3AudioError("decoded audio must contain finite real samples")
    return block


def _decode_audio(audio: bytes, *, max_frames: int, max_channels: int) -> tuple[np.ndarray, int]:
    if not isinstance(audio, bytes) or not audio:
        raise OpenL3AudioError("audio must be nonempty bytes")
    expected_format = _container_format(audio)

    try:
        import soundfile as sf

        with sf.SoundFile(BytesIO(audio)) as source:
            if source.format != expected_format:
                raise OpenL3AudioError("audio container header does not match decoded format")
            frames, channels, sample_rate = source.frames, source.channels, source.samplerate
            if frames <= 0 or channels <= 0 or sample_rate <= 0:
                raise OpenL3AudioError("audio metadata is empty or invalid")
            if frames > max_frames:
                raise OpenL3AudioError("decoded audio exceeds max_decoded_frames")
            if channels > max_channels:
                raise OpenL3AudioError("decoded audio exceeds max_channels")

            # Scan in bounded blocks first: malformed or nonfinite data is rejected
            # before allocating the full decoded sample matrix.
            for start in range(0, frames, _DECODE_CHUNK_FRAMES):
                count = min(_DECODE_CHUNK_FRAMES, frames - start)
                _checked_block(
                    source.read(frames=count, dtype="float64", always_2d=True),
                    frames=count,
                    channels=channels,
                )

            source.seek(0)
            decoded = np.empty((frames, channels), dtype=np.float64)
            for start in range(0, frames, _DECODE_CHUNK_FRAMES):
                count = min(_DECODE_CHUNK_FRAMES, frames - start)
                decoded[start : start + count] = _checked_block(
                    source.read(frames=count, dtype="float64", always_2d=True),
                    frames=count,
                    channels=channels,
                )
    except OpenL3AudioError:
        raise
    except Exception as error:
        raise OpenL3AudioError("audio could not be decoded") from error

    return decoded.T, sample_rate


class OpenL3EmbeddingProvider:
    """OpenL3 music embeddings from opaque, explicitly bounded audio bytes.

    ``model_loader`` and ``inference`` are deterministic test seams. The default
    imports and loads OpenL3 only when inference is first requested; the loaded
    model is cached on this provider instance.
    """

    def __init__(
        self,
        *,
        max_decoded_frames: int,
        max_channels: int,
        model_loader: Callable[[], object] | None = None,
        inference: Callable[[object, np.ndarray, int], tuple[object, object]] | None = None,
    ) -> None:
        self.max_decoded_frames = _positive_limit(max_decoded_frames, name="max_decoded_frames")
        self.max_channels = _positive_limit(max_channels, name="max_channels")
        if model_loader is not None and not callable(model_loader):
            raise ValueError("model_loader must be callable")
        if inference is not None and not callable(inference):
            raise ValueError("inference must be callable")
        self._model_loader = model_loader
        self._inference = inference
        self._model: object = _UNLOADED
        self._openl3: Any | None = None
        self._model_lock = Lock()

    def metadata(self) -> EmbeddingMetadata:
        return _METADATA

    def _load_model(self) -> object:
        if self._model is _UNLOADED:
            with self._model_lock:
                if self._model is _UNLOADED:
                    try:
                        if self._model_loader is None:
                            import openl3

                            self._openl3 = openl3
                            model = openl3.models.load_audio_embedding_model(
                                input_repr="mel256",
                                content_type="music",
                                embedding_size=512,
                            )
                        else:
                            model = self._model_loader()
                        if model is None:
                            raise ValueError("model loader returned None")
                        self._model = model
                    except Exception as error:
                        raise OpenL3ModelError("OpenL3 model could not be loaded") from error
        return self._model

    def _infer(self, window: AudioWindow) -> tuple[np.ndarray, np.ndarray]:
        model = self._load_model()
        try:
            if self._inference is not None:
                raw_embeddings, raw_timestamps = self._inference(
                    model, window.samples, window.sample_rate
                )
            else:
                raw_embeddings, raw_timestamps = self._openl3.get_audio_embedding(
                    window.samples,
                    window.sample_rate,
                    model=model,
                    input_repr="mel256",
                    content_type="music",
                    embedding_size=512,
                    center=True,
                    hop_size=0.1,
                    verbose=0,
                )
            embeddings = np.asarray(raw_embeddings)
            timestamps = np.asarray(raw_timestamps)
        except Exception as error:
            raise OpenL3ModelError("OpenL3 inference failed") from error

        if (
            embeddings.ndim != 2
            or embeddings.shape[0] == 0
            or embeddings.shape[1] != _METADATA.dimension
            or embeddings.dtype.kind not in "iuf"
        ):
            raise OpenL3ModelError("OpenL3 embeddings must have shape (frames, 512)")
        if (
            timestamps.ndim != 1
            or timestamps.size != embeddings.shape[0]
            or timestamps.dtype.kind not in "iuf"
        ):
            raise OpenL3ModelError("OpenL3 timestamps must align with embedding frames")
        if not np.isfinite(embeddings).all() or not np.isfinite(timestamps).all():
            raise OpenL3ModelError("OpenL3 outputs must contain finite values")
        duration = (window.end_sample - window.start_sample) / window.sample_rate
        if np.any(timestamps < 0) or np.any(timestamps > duration):
            raise OpenL3ModelError("OpenL3 timestamps fall outside the source window")
        if timestamps.size > 1 and np.any(np.diff(timestamps) <= 0):
            raise OpenL3ModelError("OpenL3 timestamps must be strictly increasing")
        return embeddings.astype(np.float64, copy=False), timestamps.astype(np.float64, copy=False)

    def generate_segment_embeddings(self, audio: bytes) -> tuple[SegmentEmbedding, ...]:
        decoded, sample_rate = _decode_audio(
            audio, max_frames=self.max_decoded_frames, max_channels=self.max_channels
        )
        try:
            windows = prepare_audio_windows(decoded, sample_rate)
        except AudioPreprocessingError as error:
            raise OpenL3AudioError("audio has no usable embedding windows") from error

        segments: list[SegmentEmbedding] = []
        for window in windows:
            embeddings, _timestamps = self._infer(window)
            try:
                vector = normalized_centroid(embeddings)
                segments.append(
                    SegmentEmbedding(
                        self.metadata(), vector, window.start_seconds, window.end_seconds
                    )
                )
            except ValueError as error:
                raise OpenL3ModelError("OpenL3 frame embeddings cannot be normalized") from error
        return tuple(segments)

    def generate_track_embedding(self, audio: bytes) -> TrackEmbedding:
        return pool_segment_embeddings(self.generate_segment_embeddings(audio))
