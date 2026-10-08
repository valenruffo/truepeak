# OpenL3 music embedding provider

`OpenL3EmbeddingProvider` implements `MusicEmbeddingProvider` for opaque audio bytes. Imports stay
OpenL3/TensorFlow-free; the default model loads lazily and is reused within each provider instance.

## Decoder limits and formats

Callers must select `max_decoded_frames` and `max_channels`; both require strictly positive Python
integers (booleans are rejected). Container and soundfile metadata limits are checked before reads.
Audio is scanned in soundfile reads of at most 65,536 frames for malformed/nonfinite samples before
the full bounded float64 `(frames, channels)` matrix is allocated. That matrix is capped at
`8 * max_decoded_frames * max_channels` bytes; preprocessing also requires working memory. There is
no implicit limit or duration policy: callers choose the bounds.

Supported signatures match reference intake: RIFF/WAVE, `fLaC`, and FORM/AIFF or AIFC, decoded by
`soundfile`. The source sample rate is kept unchanged through preprocessing and passed to OpenL3.

## Model, frontend, and pooling

The OpenL3 0.4.2 model is loaded with `input_repr="mel256"`, `content_type="music"`, and
`embedding_size=512`. Inference uses that model with `center=True`, `hop_size=0.1`, and `verbose=0`.
Preprocessing reuses up to five chronological 10-second windows centered at fractions 0.15, 0.32,
0.50, 0.68, and 0.85; existing silence thresholds are relative 0.01, absolute 1e-4, 50 ms frames,
and 0.1 active fraction. Segment bounds stay on the decoded source timeline.

Within each window, every OpenL3 frame vector is normalized and contributes equally to the
normalized window centroid. Each window yields one segment; `pool_segment_embeddings` then
normalizes segment vectors and gives each representative window equal contribution to the track.
Identity is `openl3 / mel256-music-512 / 0.4.2-representative-window-normalized-pool-v1` (512-D).
This is distinct from the demo's mean-frame identity; no musical-quality claim is made.
