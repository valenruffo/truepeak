"""FFmpeg-based WAV to MP3 conversion."""

import os
import subprocess
from pathlib import Path

from app.audio.exceptions import ConversionError


def convert_to_mp3(wav_path: str, mp3_path: str, bitrate: str = "128k") -> str:
    """Convert a WAV file to MP3 using FFmpeg.

    Args:
        wav_path: Path to source WAV file.
        mp3_path: Path to destination MP3 file.
        bitrate: MP3 bitrate (e.g., "128k", "192k", "320k").

    Returns:
        The mp3_path on success.

    Raises:
        ConversionError: If FFmpeg fails or output file is invalid.
    """
    # Ensure output directory exists
    Path(mp3_path).parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "ffmpeg",
        "-y",  # Overwrite output without asking
        "-i", wav_path,
        "-codec:a", "libmp3lame",
        "-b:a", bitrate,
        "-map_metadata", "-1",  # Strip metadata for smaller file
        mp3_path,
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,  # 30-second max for conversion
        )

        if result.returncode != 0:
            raise ConversionError(
                f"FFmpeg conversion failed (exit code {result.returncode}): "
                f"{result.stderr.strip()}"
            )

    except subprocess.TimeoutExpired as e:
        raise ConversionError(
            f"FFmpeg conversion timed out after 30 seconds: {e}"
        ) from e
    except FileNotFoundError as e:
        raise ConversionError(
            "FFmpeg binary not found. Ensure ffmpeg is installed and in PATH."
        ) from e

    # Validate output file exists and has content
    if not os.path.exists(mp3_path):
        raise ConversionError(
            f"FFmpeg completed but output file does not exist: {mp3_path}"
        )

    if os.path.getsize(mp3_path) == 0:
        raise ConversionError(
            f"FFmpeg produced empty output file: {mp3_path}"
        )

    return mp3_path
