"""Audio upload endpoint — accepts audio, triggers analysis lifecycle, returns results."""

import os
import uuid
from pathlib import Path

import librosa
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from app.audio.exceptions import AudioAnalysisError, FileCleanupError
from app.audio.lifecycle import process_submission
from app.database import get_session
from app.models import Label, Submission
from sqlmodel import select

router = APIRouter(prefix="/api", tags=["upload"])

# Constants
MAX_AUDIO_SIZE = 100 * 1024 * 1024  # 100MB
ALLOWED_EXTENSIONS = {".wav", ".flac", ".aiff", ".aif"}
TMP_DIR = Path("/tmp")
TMP_DIR.mkdir(parents=True, exist_ok=True)


class UploadResponse(BaseModel):
    submission_id: str
    status: str
    metrics: dict | None = None
    rejection_reason: str | None = None
    mp3_path: str | None = None
    has_original: bool = False


ORIGINALS_DIR = Path("/app/data/originals")


def _safe_remove(file_path: str) -> None:
    """Safely remove a temporary file."""
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except OSError:
        # Log but don't crash — cleanup best-effort
        pass


@router.post("/upload", response_model=UploadResponse)
async def upload_audio(
    file: UploadFile = File(...),
    label_slug: str = Form(...),
    producer_name: str = Form(""),
    producer_email: str = Form(""),
    track_name: str = Form(""),
    notes: str = Form(""),
):
    """Upload an audio file for analysis and submission.

    Validates file type and size, saves to /tmp temporarily,
    runs the zero-storage lifecycle pipeline, and returns results.
    """
    audio_path: str | None = None

    try:
        # --- Validate file type ---
        if not file.filename:
            raise HTTPException(
                status_code=400,
                detail="No filename provided.",
            )
        ext = Path(file.filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail="Only WAV, FLAC, and AIFF files are accepted.",
            )

        # --- Read file content and validate size ---
        content = await file.read()
        if len(content) > MAX_AUDIO_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {MAX_AUDIO_SIZE // (1024 * 1024)}MB.",
            )

        if len(content) == 0:
            raise HTTPException(
                status_code=400,
                detail="Empty file received.",
            )

        # --- Save to /tmp with UUID name, preserving original extension ---
        audio_filename = f"{uuid.uuid4()}{ext}"
        audio_path = str(TMP_DIR / audio_filename)

        with open(audio_path, "wb") as f:
            f.write(content)

        # --- Look up label and sonic signature ---
        session = next(get_session())
        try:
            label = session.query(Label).filter(Label.slug == label_slug).first()
            if not label:
                _safe_remove(audio_path)
                raise HTTPException(
                    status_code=404,
                    detail=f"Label with slug '{label_slug}' not found.",
                )

            sonic_signature = label.sonic_signature
            label_id = label.id

            # HQ storage limit check: max 10 approved submissions with MP3
            hq_count = session.exec(
                select(Submission).where(
                    Submission.label_id == label_id,
                    Submission.mp3_path.isnot(None),
                )
            ).all()
            if len(hq_count) >= 10:
                _safe_remove(audio_path)
                raise HTTPException(
                    status_code=400,
                    detail="Llegaste al límite de 10 demos de alta calidad almacenados. Eliminá uno desde el dashboard para seguir guardando.",
                )
        finally:
            session.close()

        # --- Process through lifecycle ---
        submission_id = str(uuid.uuid4())

        try:
            result = await process_submission(
                file_path=audio_path,
                submission_id=submission_id,
                label_id=label_id,
                sonic_signature=sonic_signature,
            )
        except AudioAnalysisError as e:
            # Analysis failed — return 400 with clean message
            raise HTTPException(
                status_code=400,
                detail=f"Audio analysis failed: {e}",
            )

        # --- Save original file for HQ download ---
        original_path: str | None = None
        try:
            ORIGINALS_DIR.mkdir(parents=True, exist_ok=True)
            orig_filename = f"{submission_id}{ext}"
            orig_fullpath = str(ORIGINALS_DIR / orig_filename)
            with open(orig_fullpath, "wb") as f:
                f.write(content)
            original_path = orig_fullpath
        except OSError:
            pass  # Best-effort: if we can't save original, continue with MP3 only

        # --- Create submission record in DB ---
        session = next(get_session())
        try:
            submission = Submission(
                id=submission_id,
                label_id=label_id,
                producer_name=producer_name or file.filename or "Unknown",
                producer_email=producer_email or "",
                track_name=track_name or file.filename or "Unknown Track",
                bpm=result["metrics"].get("bpm") if result["metrics"] else None,
                lufs=result["metrics"].get("lufs") if result["metrics"] else None,
                duration=result["metrics"].get("duration") if result["metrics"] else None,
                phase_correlation=result["metrics"].get("phase_correlation") if result["metrics"] else None,
                musical_key=result["metrics"].get("musical_key") if result["metrics"] else None,
                status=result["status"],
                rejection_reason=result["rejection_reason"],
                mp3_path=result["mp3_path"],
                original_path=original_path,
                notes=notes or None,
            )
            session.add(submission)
            session.commit()
        except Exception:
            session.rollback()
            raise HTTPException(
                status_code=500,
                detail="Failed to save submission record.",
            )
        finally:
            session.close()

        return UploadResponse(
            submission_id=submission_id,
            status=result["status"],
            metrics=result["metrics"],
            rejection_reason=result["rejection_reason"],
            mp3_path=result["mp3_path"],
            has_original=original_path is not None,
        )

    except HTTPException:
        # Re-raise HTTP exceptions (already handled cleanup where needed)
        raise

    except librosa.LibrosaError as e:
        # Catch librosa errors specifically — return 400
        _safe_remove(audio_path)
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format: {e}",
        )

    except Exception as e:
        # Catch-all: never crash the server
        _safe_remove(audio_path)
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {e}",
        )
