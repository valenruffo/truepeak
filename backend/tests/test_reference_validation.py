"""Pure filename, declared-size, and bounded audio-header validation tests."""

from __future__ import annotations

from dataclasses import FrozenInstanceError, fields

import pytest

from app.ar_matching.reference_validation import (
    TypedReferenceValidationError,
    ValidatedReferenceUpload,
    validate_reference_header,
    validate_reference_upload,
)

MiB = 1024 * 1024


@pytest.mark.parametrize(
    ("filename", "size", "extension", "mime"),
    [
        ("reference.wav", 12, ".wav", "audio/wav"),
        ("REFERENCE.WAV", 12, ".wav", "audio/wav"),
        ("Beyoncé.FLAC", 8, ".flac", "audio/flac"),
        ("reference.aiff", 12, ".aiff", "audio/aiff"),
        ("reference.AIF", 12, ".aiff", "audio/aiff"),
    ],
)
def test_upload_descriptor_is_canonical_and_immutable(filename, size, extension, mime):
    result = validate_reference_upload(filename, size, max_size_bytes=size)

    assert isinstance(result, ValidatedReferenceUpload)
    assert result.filename == filename
    assert result.canonical_extension == extension
    assert result.canonical_mime == mime
    assert result.size_bytes == size
    assert result.effective_limit_bytes == size
    assert [field.name for field in fields(result)] == [
        "filename",
        "canonical_extension",
        "canonical_mime",
        "size_bytes",
        "effective_limit_bytes",
    ]
    with pytest.raises(FrozenInstanceError):
        result.filename = "renamed.wav"


def test_size_limits_are_inclusive_and_cap_configured_limit():
    default_boundary = validate_reference_upload("reference.wav", 100 * MiB)
    assert default_boundary.effective_limit_bytes == 100 * MiB

    capped = validate_reference_upload("reference.wav", 200 * MiB, max_size_bytes=250 * MiB)
    assert capped.effective_limit_bytes == 200 * MiB
    with pytest.raises(TypedReferenceValidationError):
        validate_reference_upload("reference.wav", 200 * MiB + 1, max_size_bytes=250 * MiB)

    small = validate_reference_upload("reference.wav", 7, max_size_bytes=8)
    assert small.effective_limit_bytes == 8
    with pytest.raises(TypedReferenceValidationError):
        validate_reference_upload("reference.wav", 9, max_size_bytes=8)


@pytest.mark.parametrize("value", [0, -1, True, False, 1.0, 1.5, "12", None])
def test_declared_size_must_be_a_strictly_positive_integer(value):
    with pytest.raises(TypedReferenceValidationError):
        validate_reference_upload("reference.wav", value)


@pytest.mark.parametrize("value", [0, -1, True, False, 1.0, 1.5, "12", None])
def test_configured_limit_must_be_a_strictly_positive_integer(value):
    with pytest.raises(TypedReferenceValidationError):
        validate_reference_upload("reference.wav", 1, max_size_bytes=value)


@pytest.mark.parametrize(
    "filename",
    [
        "",
        "   ",
        None,
        12,
        ".",
        "..",
        "../reference.wav",
        "folder\\reference.wav",
        "folder/reference.wav",
        "C:reference.wav",
        "reference:\\audio.wav",
        "reference\x00.wav",
        "reference\n.wav",
        "reference\x7f.wav",
        "reference",
        "reference.txt",
        "reference.wav ",
    ],
)
def test_rejects_invalid_names_paths_controls_and_extensions(filename):
    with pytest.raises(TypedReferenceValidationError):
        validate_reference_upload(filename, 1)


@pytest.mark.parametrize(
    ("filename", "prefix"),
    [
        ("reference.wav", b"RIFF\x00\x00\x00\x00WAVE"),
        ("reference.aiff", b"FORM\x00\x00\x00\x00AIFF"),
        ("reference.aif", b"FORM\x00\x00\x00\x00AIFC"),
        ("reference.flac", b"fLaC\x00\x00\x00\x22"),
    ],
)
def test_accepts_minimal_canonical_headers(filename, prefix):
    assert validate_reference_header(filename, prefix) is None


@pytest.mark.parametrize(
    ("filename", "prefix"),
    [
        ("reference.wav", b"RIFF\x00\x00\x00\x00AVI "),
        ("reference.wav", b"RIFF\x00\x00WAVE"),
        ("reference.wav", b"NOPE\x00\x00\x00\x00WAVE"),
        ("reference.aiff", b"FORM\x00\x00\x00\x00AVI "),
        ("reference.aif", b"FORM\x00\x00\x00\x00AIFF "),
        ("reference.flac", b"fLaC"),
        ("reference.wav", b"RIFF\x00\x00\x00\x00WAV"),
    ],
)
def test_rejects_truncated_mismatched_or_other_container_headers(filename, prefix):
    with pytest.raises(TypedReferenceValidationError):
        validate_reference_header(filename, prefix)


@pytest.mark.parametrize("prefix", ["RIFF........WAVE", bytearray(b"RIFF........WAVE"), None])
def test_header_requires_bounded_bytes_prefix(prefix):
    with pytest.raises(TypedReferenceValidationError):
        validate_reference_header("reference.wav", prefix)


def test_header_validation_rejects_unsupported_filename_and_oversized_prefix():
    with pytest.raises(TypedReferenceValidationError):
        validate_reference_header("reference.mp3", b"fLaC\x00\x00\x00\x22")
    with pytest.raises(TypedReferenceValidationError):
        validate_reference_header("reference.wav", b"RIFF\x00\x00\x00\x00WAVE" + b"x")
