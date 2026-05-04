"""WAV upload endpoint — accepts audio, triggers analysis lifecycle, returns results."""

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

router = APIRouter(prefix="/api", tags=["upload"])

# Constants
MAX_WAV_SIZE = 100 * 1024 * 1024  # 100MB
TMP_DIR = Path("/tmp")
TMP_DIR.mkdir(parents=True, exist_ok=True)


class UploadResponse(BaseModel):
    submission_id: str
    status: str
    metrics: dict | None = None
    rejection_reason: str | None = None
    mp3_path: str | None = None


def _safe_remove(file_path: str) -> None:
    """Safely remove a temporary file."""
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except OSError:
        # Log but don't crash — cleanup best-effort
        pass


@router.post("/upload", response_model=UploadResponse)
async def upload_wav(
    file: UploadFile = File(...),
    label_slug: str = Form(...),
):
    """Upload a WAV file for audio analysis and submission.

    Validates file type and size, saves to /tmp temporarily,
    runs the zero-storage lifecycle pipeline, and returns results.
    """
    wav_path: str | None = None

    try:
        # --- Validate file type ---
        if not file.filename or not file.filename.lower().endswith(".wav"):
            raise HTTPException(
                status_code=400,
                detail="Only WAV files are accepted.",
            )

        # --- Read file content and validate size ---
        content = await file.read()
        if len(content) > MAX_WAV_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {MAX_WAV_SIZE // (1024 * 1024)}MB.",
            )

        if len(content) == 0:
            raise HTTPException(
                status_code=400,
                detail="Empty file received.",
            )

        # --- Save to /tmp with UUID name ---
        wav_filename = f"{uuid.uuid4()}.wav"
        wav_path = str(TMP_DIR / wav_filename)

        with open(wav_path, "wb") as f:
            f.write(content)

        # --- Look up label and sonic signature ---
        session = next(get_session())
        try:
            label = session.query(Label).filter(Label.slug == label_slug).first()
            if not label:
                _safe_remove(wav_path)
                raise HTTPException(
                    status_code=404,
                    detail=f"Label with slug '{label_slug}' not found.",
                )

            sonic_signature = label.sonic_signature
            label_id = label.id
        finally:
            session.close()

        # --- Process through lifecycle ---
        submission_id = str(uuid.uuid4())

        try:
            result = await process_submission(
                file_path=wav_path,
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

        # --- Create submission record in DB ---
        session = next(get_session())
        try:
            submission = Submission(
                id=submission_id,
                label_id=label_id,
                producer_name=file.filename or "Unknown",
                producer_email="unknown@example.com",  # TODO: from form data
                track_name=file.filename or "Unknown Track",
                bpm=result["metrics"].get("bpm") if result["metrics"] else None,
                lufs=result["metrics"].get("lufs") if result["metrics"] else None,
                phase_correlation=result["metrics"].get("phase_correlation") if result["metrics"] else None,
                musical_key=result["metrics"].get("musical_key") if result["metrics"] else None,
                status=result["status"],
                rejection_reason=result["rejection_reason"],
                mp3_path=result["mp3_path"],
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
        )

    except HTTPException:
        # Re-raise HTTP exceptions (already handled cleanup where needed)
        raise

    except librosa.LibrosaError as e:
        # Catch librosa errors specifically — return 400
        _safe_remove(wav_path)
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format: {e}",
        )

    except Exception as e:
        # Catch-all: never crash the server
        _safe_remove(wav_path)
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {e}",
        )
