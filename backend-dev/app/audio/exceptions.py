"""Custom exceptions for the audio processing pipeline."""


class AudioAnalysisError(Exception):
    """Raised when audio feature extraction fails (librosa/pyloudnorm/scipy errors)."""

    pass


class ConversionError(Exception):
    """Raised when FFmpeg MP3 conversion fails."""

    pass


class FileCleanupError(Exception):
    """Raised when a temporary WAV file cannot be deleted."""

    pass
