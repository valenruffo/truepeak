"""Pure, side-effect-free validation for future reference-audio intake.

The supported suffixes and size policy mirror ``app/api/upload.py``: its
``ALLOWED_EXTENSIONS`` and legacy upload fallback of 100 MiB with a 200 MiB
cap. They are intentionally local so this helper does not import that
credential- and lifecycle-bound API module. Callers must validate a bounded
prefix (at most 12 bytes); this module never reads or decodes an audio body.
"""

from __future__ import annotations

from dataclasses import dataclass

_MIB = 1024 * 1024
_DEFAULT_LIMIT_BYTES = 100 * _MIB
_ABSOLUTE_LIMIT_BYTES = 200 * _MIB
_MAX_HEADER_PREFIX_BYTES = 12


class TypedReferenceValidationError(ValueError):
    """A filename, declared size, or bounded reference header is invalid."""


@dataclass(frozen=True, slots=True)
class ValidatedReferenceUpload:
    """Canonical metadata validated from caller declarations, not object contents."""

    filename: str
    canonical_extension: str
    canonical_mime: str
    size_bytes: int
    effective_limit_bytes: int


def _canonical_audio_type(filename: str) -> tuple[str, str]:
    if not isinstance(filename, str) or not filename or filename.isspace():
        raise TypedReferenceValidationError("filename must be a non-empty plain string")
    if any(
        character in "/\\:" or ord(character) < 32 or ord(character) == 127
        for character in filename
    ):
        raise TypedReferenceValidationError("filename must not contain paths or control characters")

    stem, separator, suffix = filename.rpartition(".")
    if not separator or not stem.strip() or not suffix:
        raise TypedReferenceValidationError("filename must have a non-empty supported extension")

    extension = f".{suffix.lower()}"
    if extension == ".wav":
        return extension, "audio/wav"
    if extension == ".flac":
        return extension, "audio/flac"
    if extension in (".aiff", ".aif"):
        return ".aiff", "audio/aiff"
    raise TypedReferenceValidationError("filename extension is not a supported audio format")


def _require_positive_integer(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise TypedReferenceValidationError(f"{field} must be a strictly positive integer")
    return value


def validate_reference_upload(
    filename: str,
    declared_size: int,
    max_size_bytes: int = _DEFAULT_LIMIT_BYTES,
) -> ValidatedReferenceUpload:
    """Validate a plain filename and declared byte limits without reading a body.

    ``max_size_bytes`` is the caller-supplied per-label limit. The effective
    limit is capped at 200 MiB; this helper does not infer subscription,
    cumulative quota, storage, or actual-object-size policy.
    """
    canonical_extension, canonical_mime = _canonical_audio_type(filename)
    declared_size = _require_positive_integer(declared_size, "declared_size")
    configured_limit = _require_positive_integer(max_size_bytes, "max_size_bytes")
    effective_limit = min(configured_limit, _ABSOLUTE_LIMIT_BYTES)
    if declared_size > effective_limit:
        raise TypedReferenceValidationError("declared size exceeds the effective upload limit")

    return ValidatedReferenceUpload(
        filename=filename,
        canonical_extension=canonical_extension,
        canonical_mime=canonical_mime,
        size_bytes=declared_size,
        effective_limit_bytes=effective_limit,
    )


def validate_reference_header(filename: str, prefix: bytes) -> None:
    """Check only a <=12-byte container prefix; this does not validate full audio.

    WAV requires RIFF and WAVE at offsets 0 and 8. AIFF/AIF require FORM and
    AIFF/AIFC at those offsets. FLAC requires its four-byte magic plus the
    four-byte metadata-block header. No codec parsing, decoding, duration,
    quality, silence, or actual object-size claim is made.
    """
    extension, _mime = _canonical_audio_type(filename)
    if not isinstance(prefix, bytes) or len(prefix) > _MAX_HEADER_PREFIX_BYTES:
        raise TypedReferenceValidationError(
            "header must be a bounded bytes prefix of at most 12 bytes"
        )

    if extension == ".wav":
        valid = len(prefix) >= 12 and prefix[:4] == b"RIFF" and prefix[8:12] == b"WAVE"
    elif extension == ".aiff":
        valid = len(prefix) >= 12 and prefix[:4] == b"FORM" and prefix[8:12] in (b"AIFF", b"AIFC")
    else:
        valid = len(prefix) >= 8 and prefix[:4] == b"fLaC"

    if not valid:
        raise TypedReferenceValidationError("audio header does not match the filename extension")
