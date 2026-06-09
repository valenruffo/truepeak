"""FFmpeg-based WAV to MP3 conversion with async progress reporting."""

import asyncio
import logging
import os
import re
import shutil
from pathlib import Path
from typing import Awaitable, Callable, Optional

from app.audio.exceptions import ConversionError

logger = logging.getLogger(__name__)

# Match FFmpeg's `time=HH:MM:SS.MS` marker in -progress / stderr lines.
# Captures hours, minutes, seconds (with optional fractional part).
_FFMPEG_TIME_RE = re.compile(r"time=(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)")

# Hard upper bound on FFmpeg execution time. The spec calls for 60s.
_FFMPEG_TIMEOUT_SECONDS = 60.0


def parse_ffmpeg_time(line: str) -> Optional[float]:
    """Extract the current encoded time (in seconds) from a single FFmpeg output line.

    Returns None if the line does not contain a `time=` marker.
    Exposed at module level for direct unit testing.
    """
    if not line:
        return None
    match = _FFMPEG_TIME_RE.search(line)
    if not match:
        return None
    hours = int(match.group(1))
    minutes = int(match.group(2))
    seconds = float(match.group(3))
    return hours * 3600 + minutes * 60 + seconds


def _compute_sub_pct(current_time: float, duration_seconds: float | None) -> int:
    """Translate current_time/duration into a 0..99 sub-progress percentage.

    If `duration_seconds` is unknown / non-positive, returns 0 (so the caller
    can fall back to stage-level progress: 0% at start, 100% at end).
    """
    if not duration_seconds or duration_seconds <= 0:
        return 0
    pct = int((current_time / duration_seconds) * 100)
    return max(0, min(99, pct))


async def convert_to_mp3(
    wav_path: str,
    mp3_path: str,
    bitrate: str = "320k",
    duration_seconds: float | None = None,
    on_progress: Optional[Callable[[str, int], Awaitable[None]]] = None,
) -> str:
    """Async-convert a WAV file to MP3 using FFmpeg, yielding sub-progress.

    Replaces the previous `subprocess.run` call with
    `asyncio.create_subprocess_exec`, parses FFmpeg's stderr for `time=`
    markers, and invokes `on_progress(stage, pct)` whenever the percentage
    changes.

    Args:
        wav_path: Path to source WAV file.
        mp3_path: Path to destination MP3 file.
        bitrate: MP3 bitrate (e.g., "128k", "192k", "320k").
        duration_seconds: Optional known duration of the source file. When
            provided, the percentage is computed as `current_time / duration`.
            When absent, percentage stays at 0 during conversion and jumps to
            99 only on success.
        on_progress: Async callback receiving `(stage_label, sub_pct)`.
            `sub_pct` is clamped to 0..99 during conversion; the caller
            usually advances the overall bar from 60% to 80%.

    Returns:
        The mp3_path on success.

    Raises:
        ConversionError: If FFmpeg fails, times out, or produces no output.
    """
    if not re.match(r"^\d+[kKmM]$", bitrate):
        raise ConversionError(f"Invalid bitrate format: {bitrate}")

    if not Path(wav_path).exists():
        raise ConversionError(f"Source WAV file does not exist: {wav_path}")

    # Ensure output directory exists
    Path(mp3_path).parent.mkdir(parents=True, exist_ok=True)

    # If a previous attempt left a partial file, remove it so FFmpeg can
    # start cleanly.
    if os.path.exists(mp3_path):
        try:
            os.remove(mp3_path)
        except OSError as e:
            raise ConversionError(
                f"Could not remove pre-existing output {mp3_path}: {e}"
            ) from e

    if shutil.which("ffmpeg") is None:
        raise ConversionError("FFmpeg binary not found. Ensure ffmpeg is installed and in PATH.")

    cmd = [
        "ffmpeg",
        "-y",  # Overwrite output without asking
        "-nostdin",  # Don't try to read from stdin (prevents hangs)
        "-hide_banner",
        "-loglevel", "info",  # We need `time=` markers, which are emitted at info
        "-i", wav_path,
        "-vn",  # Strip album art/video streams
        "-codec:a", "libmp3lame",
        "-b:a", bitrate,
        "-map_metadata", "-1",  # Strip metadata for smaller file
        "-progress", "pipe:2",  # Emit `out_time_ms=...` to stderr
        mp3_path,
    ]

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as e:
        raise ConversionError(
            "FFmpeg binary not found. Ensure ffmpeg is installed and in PATH."
        ) from e

    assert process.stderr is not None
    last_reported_pct = -1

    async def _report(pct: int) -> None:
        nonlocal last_reported_pct
        if pct == last_reported_pct:
            return
        last_reported_pct = pct
        if on_progress is not None:
            try:
                await on_progress("Convirtiendo a MP3...", pct)
            except Exception as e:  # noqa: BLE001
                logger.warning("convert_to_mp3 progress callback raised: %s", e)

    # Emit a 0% tick so the UI shows motion immediately.
    await _report(0)

    stderr_chunks: list[str] = []

    async def _drain_stderr() -> None:
        while True:
            line = await process.stderr.readline()
            if not line:
                return
            try:
                text = line.decode("utf-8", errors="replace")
            except Exception:  # noqa: BLE001
                continue
            stderr_chunks.append(text)
            current_time = parse_ffmpeg_time(text)
            if current_time is None:
                continue
            sub_pct = _compute_sub_pct(current_time, duration_seconds)
            if sub_pct > last_reported_pct:
                await _report(sub_pct)

    drain_task = asyncio.create_task(_drain_stderr())

    try:
        try:
            await asyncio.wait_for(process.wait(), timeout=_FFMPEG_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            process.kill()
            try:
                await process.wait()
            except Exception:  # noqa: BLE001
                pass
            drain_task.cancel()
            _cleanup_partial_output(mp3_path)
            raise ConversionError(
                f"FFmpeg conversion timed out after {_FFMPEG_TIMEOUT_SECONDS} seconds"
            )
    except Exception:
        # Make sure the drain task finishes / is cancelled before we move on.
        if not drain_task.done():
            drain_task.cancel()
        try:
            await drain_task
        except Exception:  # noqa: BLE001
            pass
        # The drain task already appended stderr chunks; nothing else to do.
        raise

    # Wait for stderr drain to fully complete (it stops at EOF).
    try:
        await asyncio.wait_for(drain_task, timeout=2.0)
    except asyncio.TimeoutError:
        drain_task.cancel()
        try:
            await drain_task
        except Exception:  # noqa: BLE001
            pass

    returncode = process.returncode
    if returncode != 0:
        _cleanup_partial_output(mp3_path)
        stderr_text = "".join(stderr_chunks).strip()[-500:]
        raise ConversionError(
            f"FFmpeg conversion failed (exit code {returncode}): {stderr_text}"
        )

    # Final 99% — caller advances to 100 after upload.
    await _report(99)

    # Validate output file exists and has content
    if not os.path.exists(mp3_path):
        raise ConversionError(
            f"FFmpeg completed but output file does not exist: {mp3_path}"
        )

    if os.path.getsize(mp3_path) == 0:
        _cleanup_partial_output(mp3_path)
        raise ConversionError(
            f"FFmpeg produced empty output file: {mp3_path}"
        )

    return mp3_path


def _cleanup_partial_output(mp3_path: str) -> None:
    """Best-effort removal of a partial MP3 file. Never raises."""
    try:
        if os.path.exists(mp3_path):
            os.remove(mp3_path)
    except OSError:
        pass
