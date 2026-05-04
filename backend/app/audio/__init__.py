"""Audio processing package — analysis, conversion, and lifecycle orchestration."""

from app.audio.analyzer import analyze_audio
from app.audio.converter import convert_to_mp3
from app.audio.exceptions import AudioAnalysisError, ConversionError, FileCleanupError
from app.audio.lifecycle import process_submission

__all__ = [
    "analyze_audio",
    "convert_to_mp3",
    "process_submission",
    "AudioAnalysisError",
    "ConversionError",
    "FileCleanupError",
]
