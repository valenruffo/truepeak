# Design: fix-waveform-dynamics

## Problem

The waveform visualization suffers a **double-squash pipeline** that makes every track look like a flat brick:

1. **Backend** (`analyzer.py:39-65`): 70% RMS blend compresses transient peaks. A `scale = 3.0` multiplier + `clamp [-1.0, 1.0]` then flattens everything further. No per-track normalization means absolute amplitude dictates bar height — a quiet jazz track and a loud EDM track render completely different visual scales.
2. **Frontend** (`waveform.tsx:63`): A `* 0.45` multiplier squashes bars to ~30% of available height on top of the backend squash. Result: most bars are 2-6px in a 48px container.
3. **API** (`submissions.py:501-630`): The `load_and_extract` closure is copy-pasted across 3 code paths (missing peaks, old-peak regen, fallback). Maintenance burden and divergence risk.

## Solution Overview

| Layer | Change | Effect |
|-------|--------|--------|
| Backend analyzer | Pure peak sampling + per-track normalization | Bars reflect real dynamics; loudest section = 1.0 |
| Frontend | Remove `0.45` multiplier, reduce padding | Bars fill vertical space as designed |
| API | Extract shared helper | Single source of truth for peak extraction |

---

## 1. Backend: `_extract_waveform_peaks()` in `analyzer.py`

### Current code (lines 17-67)

```python
# 70% RMS + 30% peak blend
pos_value = 0.7 * rms + 0.3 * positive_peak
neg_value = -(0.7 * rms + 0.3 * abs(negative_peak))
# ...
scale = 3.0  # amplify RMS-dominant values
peaks = [min(max(p * scale, floor), 1.0) ...]  # clamp to [-1, 1]
```

**Problems:**
- RMS of a window is always <= peak. The 70/30 blend drags values toward RMS, losing transient detail.
- `scale = 3.0` was tuned for RMS-range values (~0.1-0.3). With the blend, most values land in 0.15-0.4, so 3x pushes them to 0.45-1.0 and clamps the rest. This compresses dynamic range.
- No per-track normalization: a -6dB track and a -14dB track look completely different even if both have full internal dynamics.

### New code

```python
def _extract_waveform_peaks(y: np.ndarray, target_points: int = 2000) -> list[float]:
    """Extract waveform peaks using pure sample-peak per window.

    Uses max(|sample|) per window — preserves transients, drops, and buildups.
    Per-track normalization ensures the loudest section = 1.0 regardless of
    master volume. A floor of 0.02 keeps silent sections visible.

    Args:
        y: Audio signal (mono or stereo).
        target_points: Number of peak pairs to return.

    Returns:
        List of peak values in [-1.0, 1.0] range (per-track normalized).
    """
    y_mono = librosa.to_mono(y) if y.ndim == 2 else y
    src_len = len(y_mono)
    if src_len == 0:
        return [0.0] * target_points

    window_size = max(1, src_len // (target_points * 2))
    raw_peaks: list[float] = []

    for i in range(0, src_len, window_size):
        chunk = y_mono[i : i + window_size]
        if len(chunk) == 0:
            break
        peak = float(np.max(np.abs(chunk)))
        raw_peaks.append(peak)
        raw_peaks.append(-peak)  # mirror for symmetric waveform
        if len(raw_peaks) >= target_points * 2:
            break

    # Per-track normalization: loudest peak = 1.0
    max_peak = max(abs(p) for p in raw_peaks) if raw_peaks else 1.0
    if max_peak == 0:
        max_peak = 1.0

    floor = 0.02
    peaks = [
        max(p / max_peak, floor) if p >= 0 else min(p / max_peak, -floor)
        for p in raw_peaks
    ]
    return peaks
```

### Design decisions

| Decision | Rationale |
|----------|-----------|
| **Pure peak (no RMS blend)** | `np.max(np.abs(chunk))` captures the actual sample peak per window. This is what the waveform should show — the envelope of the signal. RMS represents energy/density, which is useful for loudness meters but wrong for waveform visualization. |
| **Per-track normalization** | Dividing by `max_peak` makes each track self-scaled. A -6dB master and a -14dB master both fill the container. Relative dynamics within a track are preserved. |
| **Floor of 0.02** | Silent sections (true zeros or near-zeros) still render as tiny bars (~0.4px at 48px height, rounded to 2px by `Math.max(2, ...)`). Without floor, silence = no bar = visual gap. |
| **No global scale/clamp** | Normalization produces values in [0, 1.0] by construction. The `scale = 3.0` + `clamp` from the old code was a workaround for RMS values being small — not needed when peaks are already in range. |
| **Symmetric pairs** | Each window produces `[+peak, -peak]`. The frontend renders these as mirrored bars. This matches the existing consumer contract (2000 points = 4000 values). |

### Data flow

```
Audio buffer (y)
    │
    ▼
to_mono() → 1D numpy array
    │
    ▼
Window into chunks (window_size = src_len / 4000)
    │
    ▼
Per chunk: max(|samples|) → raw peak value
    │
    ▼
raw_peaks: [+peak, -peak, +peak, -peak, ...]  (up to 4000 values)
    │
    ▼
Normalize: each value / max(|raw_peaks|)
    │
    ▼
Apply floor: clamp magnitude to [0.02, 1.0]
    │
    ▼
Output: list[float] in [-1.0, 1.0], max(|value|) = 1.0
```

### Backward compatibility

- **Output shape unchanged**: still returns `list[float]` of length `target_points * 2` (default 4000).
- **Output range unchanged**: still `[-1.0, 1.0]`.
- **Semantic change**: values are now per-track normalized. Old values were absolute + scaled. This is the intended fix — existing "flat" peaks will be regenerated by the API's old-peak detection.

---

## 2. Frontend: `Waveform` component in `waveform.tsx`

### Current code (line 63)

```tsx
const barH = Math.max(2, absPeak * (height - 16) * 0.45);
```

With `height = 48`: `absPeak * 32 * 0.45 = absPeak * 14.4`. A normalized peak of 1.0 → 14.4px bar. Average peak ~0.3 → 4.3px bar. Most of the 48px container is empty.

### New code

```tsx
const barH = Math.max(2, absPeak * (height - 8));
```

With `height = 48`: `absPeak * 40`. A normalized peak of 1.0 → 40px bar. Average peak ~0.3 → 12px bar. The waveform fills the container with visible dynamics.

### Design decisions

| Decision | Rationale |
|----------|-----------|
| **Remove `* 0.45`** | This multiplier was compensating for the backend's `scale = 3.0` over-amplification. With normalized peaks (max = 1.0), bars at full scale should use the full available height. 0.45 was making everything tiny. |
| **`(height - 8)` instead of `(height - 16)`** | Reduces vertical padding from 8px-per-side to 4px-per-side. The tallest bar (peak=1.0) reaches 40px of the 48px container, leaving 4px breathing room top and bottom. |
| **Keep `Math.max(2, ...)`** | Ensures even silent bars (floor = 0.02 → 0.8px) render as at least 2px. Prevents visual gaps. |

### Sizing math

| Peak value | Old barH | New barH |
|-----------|----------|----------|
| 1.0 (loudest) | 14.4px | 40px |
| 0.5 | 7.2px | 20px |
| 0.2 | 2.9px | 8px |
| 0.02 (floor) | 2px (min) | 2px (min) |

---

## 3. API: `get_waveform_peaks()` in `submissions.py`

### Current code (lines 501-630)

Three code paths each inline the same `load_and_extract` closure + download + persist logic:
1. **Lines 514-569**: `submission.peaks` is empty → download, extract, persist
2. **Lines 571-625**: Peaks exist but look "flat" (old algorithm) → re-download, re-extract, persist
3. **Lines 627-630**: Return peaks (no extraction needed)

### New code

Extract a module-level helper above the endpoint:

```python
async def _extract_peaks_from_mp3(
    session: Session,
    submission: Submission,
    temp_mp3_path: str,
    submission_id: str,
) -> list[float]:
    """Extract peaks from a local MP3 file and persist to DB."""
    import librosa
    import asyncio
    from app.audio.analyzer import _extract_waveform_peaks

    def load_and_extract(path: str):
        y, sr = librosa.load(path, sr=None, mono=False)
        peaks = _extract_waveform_peaks(y)
        duration = float(len(librosa.to_mono(y)) / sr) if sr and len(y) > 0 else 0.0
        return peaks, duration

    peaks, duration = await asyncio.to_thread(load_and_extract, temp_mp3_path)
    submission.peaks = peaks
    if not submission.duration:
        submission.duration = duration
    session.add(submission)
    session.commit()
    return peaks
```

Then the endpoint's 3 paths become:

```python
@router.get("/{submission_id}/peaks")
async def get_waveform_peaks(
    submission_id: str,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")
    _verify_label_ownership(session, auth["label_id"], submission)

    needs_extraction = False

    if not submission.peaks:
        needs_extraction = True
    else:
        # Detect old flat peaks and regenerate
        import numpy as np
        peaks_array = np.array(submission.peaks)
        if len(peaks_array) > 0:
            positive_peaks = peaks_array[peaks_array > 0]
            if len(positive_peaks) > 0:
                high_ratio = np.sum(positive_peaks > 0.85) / len(positive_peaks)
                if high_ratio > 0.8:
                    needs_extraction = True

    if needs_extraction and submission.mp3_path:
        import tempfile
        from app.services.r2 import download_file_from_r2

        temp_dir = tempfile.gettempdir()
        temp_mp3_path = os.path.join(temp_dir, f"{submission_id}_peaks_temp.mp3")

        try:
            if submission.mp3_path.startswith(("http://", "https://")):
                r2_key = f"tracks/{submission_id}/preview.mp3"
                await download_file_from_r2(r2_key, temp_mp3_path)
            else:
                if os.path.exists(submission.mp3_path):
                    temp_mp3_path = submission.mp3_path
                else:
                    raise FileNotFoundError("Local MP3 file missing.")

            await _extract_peaks_from_mp3(session, submission, temp_mp3_path, submission_id)

        except Exception as e:
            if not submission.peaks:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to generate peaks dynamically: {e}"
                )
            # If regen fails but we have old peaks, keep them
        finally:
            if temp_mp3_path != submission.mp3_path and os.path.exists(temp_mp3_path):
                try:
                    os.remove(temp_mp3_path)
                except OSError:
                    pass

    elif not submission.peaks:
        raise HTTPException(
            status_code=404,
            detail="Waveform peaks not available and MP3 file is missing."
        )

    return {
        "peaks": submission.peaks,
        "duration": submission.duration,
    }
```

### Design decisions

| Decision | Rationale |
|----------|-----------|
| **Module-level helper** | `_extract_peaks_from_mp3` is a pure async function with clear inputs (session, submission, path, id). Testable in isolation, no duplication. |
| **Single download block** | The R2 download + temp file logic is now in one place. If the download strategy changes, only one block to update. |
| **`needs_extraction` flag** | Collapses the two "should we extract?" checks (missing peaks, flat peaks) into a single boolean. The extraction block runs once regardless of trigger. |
| **Graceful degradation on regen failure** | If old peaks exist but regen fails, keep old peaks rather than 500-ing. Only raise 500 when peaks are completely missing. |
| **Imports moved to helper** | `librosa`, `asyncio`, `_extract_waveform_peaks` are imported inside the helper rather than scattered across 3 inline blocks. |

---

## 4. Old-peak detection heuristic — risk note

The current heuristic flags peaks as "old" when >80% of positive peaks exceed 0.85. With the **new** per-track normalization, the loudest peak is always 1.0, but the distribution should be wider (many peaks below 0.5 for tracks with dynamics). The heuristic should still work because:

- **Old algorithm**: scale=3.0 + clamp → most values saturate near 1.0 → high_ratio > 0.8 → flagged
- **New algorithm**: per-track normalized peaks → wide distribution → high_ratio < 0.8 → not flagged

The heuristic naturally distinguishes old vs new because the old algorithm's `scale + clamp` produced a different distribution shape than per-track normalization.

**However**: tracks that are genuinely loud throughout (e.g., brickwalled EDM) might have most peaks near 1.0 even with the new algorithm. This could cause false re-extraction on every API call. Mitigation: the re-extraction is fast (<1s) and the result is the same, so the only cost is one extra compute per request. If this becomes a problem, add a `peaks_version` column to track algorithm version.

---

## 5. Testing strategy

### Backend unit tests

| Test | Input | Expected |
|------|-------|----------|
| Pure sine wave | 440Hz sine, -6dBFS | All peaks ~equal, max = 1.0 |
| Track with silence | 50% silence + 50% loud | Silent windows at floor (0.02), loud at ~1.0 |
| Very quiet track | -20dBFS pink noise | Normalized to 1.0 max, dynamics preserved |
| Empty array | `np.array([])` | Returns `[0.0] * 2000` |
| Stereo input | 2-channel array | Converts to mono, processes normally |

### Frontend visual verification

- Load a track with known dynamics (quiet intro → loud drop → quiet outro)
- Verify bars show clear height variation
- Verify tallest bars ~40px in 48px container
- Verify silent sections show tiny bars (not gaps)

### API integration test

- Submit track with no peaks → verify peaks generated and persisted
- Submit track with old flat peaks → verify regeneration triggered
- Verify temp file cleanup in all paths

---

## 6. Migration / rollout

No migration needed. The changes are:
1. **New extractions** use the new algorithm automatically (analyzer.py change)
2. **Existing extractions** are regenerated on first API call via the flat-peak detection heuristic
3. **Frontend** works with both old and new peaks (just renders them at proper scale)

The only visible transition: users with old flat peaks will see the new dynamic waveform after their next page load (which triggers regeneration).
