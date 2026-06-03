"""Audio upload endpoint — accepts audio, triggers analysis lifecycle, returns results."""

import asyncio
import json
import os
import re
import struct
import uuid
from pathlib import Path

import librosa
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.audio.exceptions import AudioAnalysisError, FileCleanupError
from app.audio.lifecycle import process_submission
from app.database import get_session
from app.models import Label, Submission
from sqlmodel import select, func
from datetime import datetime, timezone


# ── Magic bytes for audio format validation ──────────────────────────────────

AUDIO_MAGIC_BYTES = {
    ".wav": (b"RIFF", 0),
    ".flac": (b"fLaC", 0),
    ".aiff": (b"FORM", 0),
    ".aif": (b"FORM", 0),
}

EMAIL_RE = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')


def _validate_magic_bytes(content: bytes, ext: str) -> bool:
    """Verify file content matches its claimed audio format via magic bytes."""
    entry = AUDIO_MAGIC_BYTES.get(ext)
    if entry is None:
        return False
    magic, offset = entry
    return len(content) > offset + len(magic) and content[offset:offset + len(magic)] == magic


# ── Router ───────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api", tags=["upload"])
limiter = Limiter(key_func=get_remote_address)

# Constants
MAX_AUDIO_SIZE = 200 * 1024 * 1024  # 200MB
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
    status_tecnico: str = "optimo"
    alertas: list[str] | None = None


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
@limiter.limit("10/minute")
async def upload_audio(
    request: Request,
    file: UploadFile = File(...),
    label_slug: str = Form(...),
    producer_name: str = Form(""),
    producer_email: str = Form(""),
    track_name: str = Form(""),
    notes: str = Form(""),
    producer_instagram: str = Form(""),
    producer_soundcloud: str = Form(""),
    producer_spotify: str = Form(""),
):
    """Upload an audio file for analysis and submission.

    Validates file type and size, saves to /tmp temporarily,
    runs the zero-storage lifecycle pipeline, and returns results.
    """
    audio_path: str | None = None

    try:
        # --- Look up label and sonic signature first ---
        session = next(get_session())
        try:
            label = session.query(Label).filter(Label.slug == label_slug).first()
            if not label:
                raise HTTPException(
                    status_code=404,
                    detail=f"Label with slug '{label_slug}' not found.",
                )

            if label.subscription_status == "frozen":
                raise HTTPException(
                    status_code=403,
                    detail="Este link de recepción se encuentra deshabilitado temporalmente.",
                )

            sonic_signature = label.sonic_signature
            label_id = label.id
            hq_retention_days = label.hq_retention_days

            # Free plan limit: max tracks THIS MONTH
            current_plan = label.plan or "free"
            if current_plan == "free":
                now = datetime.now(timezone.utc)
                month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                month_count = session.exec(
                    select(func.count(Submission.id)).where(
                        Submission.label_id == label_id,
                        Submission.created_at >= month_start,
                    )
                ).one()
                if month_count >= label.max_tracks_month:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Plan gratuito: máximo {label.max_tracks_month} tracks por mes. Esperá al mes próximo o hacé upgrade.",
                    )
        finally:
            session.close()

        # --- Validate file type ---
        if not file.filename:
            raise HTTPException(
                status_code=400,
                detail="No filename provided.",
            )
        ext = Path(file.filename).suffix.lower()
        
        # Get allowed formats from sonic signature (fallback to all 3)
        allowed_formats = sonic_signature.get("allowed_formats", ["wav", "flac", "aiff"])
        
        # Build allowed extensions set
        allowed_exts = set()
        for fmt in allowed_formats:
            fmt_lower = fmt.lower()
            if fmt_lower == "wav":
                allowed_exts.update({".wav"})
            elif fmt_lower == "flac":
                allowed_exts.update({".flac"})
            elif fmt_lower in ("aiff", "aif"):
                allowed_exts.update({".aiff", ".aif"})
                
        if ext not in allowed_exts:
            allowed_str = ", ".join(fmt.upper() for fmt in allowed_formats)
            raise HTTPException(
                status_code=400,
                detail=f"Formatos permitidos por este sello: {allowed_str}.",
            )

        # Get max upload size from sonic signature (fallback to 100MB, cap at 200MB)
        max_upload_size_mb = min(sonic_signature.get("max_upload_size_mb", 100), 200)
        max_size_bytes = max_upload_size_mb * 1024 * 1024

        # --- Read file content and validate size ---
        content = await file.read()
        if len(content) > max_size_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"El archivo es demasiado grande. El límite para este sello es {max_upload_size_mb}MB.",
            )

        if len(content) == 0:
            raise HTTPException(
                status_code=400,
                detail="Empty file received.",
            )

        # --- Validate magic bytes (real audio content, not just extension) ---
        if not _validate_magic_bytes(content, ext):
            raise HTTPException(
                status_code=400,
                detail=f"File content does not match its claimed {ext} format. Only valid WAV, FLAC, or AIFF files are accepted.",
            )

        # --- Validate producer email ---
        if producer_email and not EMAIL_RE.match(producer_email):
            raise HTTPException(
                status_code=400,
                detail="Invalid email format.",
            )

        # --- Save to /tmp with UUID name, preserving original extension ---
        audio_filename = f"{uuid.uuid4()}{ext}"
        audio_path = str(TMP_DIR / audio_filename)

        with open(audio_path, "wb") as f:
            f.write(content)

        # --- Process through lifecycle with SSE progress streaming ---
        submission_id = str(uuid.uuid4())
        
        async def event_generator():
            """SSE async generator: yields progress events then final result."""
            progress_queue: asyncio.Queue = asyncio.Queue()
            
            async def on_progress(stage: str, pct: int):
                await progress_queue.put({"stage": stage, "pct": pct})
            
            # Launch processing in background
            process_task = asyncio.create_task(
                process_submission(
                    file_path=audio_path,
                    submission_id=submission_id,
                    label_id=label_id,
                    sonic_signature=sonic_signature,
                    on_progress=on_progress,
                )
            )
            
            # Stream progress events while processing
            while not process_task.done():
                try:
                    event = await asyncio.wait_for(progress_queue.get(), timeout=0.3)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # No progress yet, check if task is done
                    continue
            
            # Get result
            try:
                result = await process_task
            except AudioAnalysisError as e:
                yield f"data: {json.dumps({'error': f'Audio analysis failed: {e}'})}\n\n"
                return
            except Exception as e:
                yield f"data: {json.dumps({'error': f'Processing failed: {e}'})}\n\n"
                return
            
            # Signal completion
            yield f"data: {json.dumps({'stage': 'Guardando...', 'pct': 95})}\n\n"
            
            # --- Save original file for HQ download based on plan limits ---
            original_path: str | None = None
            if hq_retention_days > 0:
                original_path = result["original_path"]
            else:
                if result["original_path"]:
                    from app.services.r2 import delete_file_from_r2
                    try:
                        await delete_file_from_r2(result["original_path"])
                    except Exception:
                        pass
            
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
                    true_peak=result["metrics"].get("true_peak") if result["metrics"] else None,
                    crest_factor=result["metrics"].get("crest_factor") if result["metrics"] else None,
                    status=result["status"],
                    status_tecnico=result.get("status_tecnico", "optimo"),
                    alertas=result.get("alertas"),
                    rejection_reason=result["rejection_reason"],
                    mp3_path=result["mp3_path"],
                    original_path=original_path,
                    peaks=result.get("peaks"),
                    notes=notes or None,
                    producer_instagram=producer_instagram or None,
                    producer_soundcloud=producer_soundcloud or None,
                    producer_spotify=producer_spotify or None,
                )
                session.add(submission)
                session.commit()
            except Exception as e:
                import traceback
                traceback.print_exc()
                session.rollback()
                yield f"data: {json.dumps({'error': f'Failed to save: {e}'})}\n\n"
                return
            finally:
                session.close()
            
            # Final success event
            yield f"data: {json.dumps({
                'done': True,
                'submission_id': submission_id,
                'status': result['status'],
                'metrics': result['metrics'],
                'rejection_reason': result['rejection_reason'],
                'mp3_path': result['mp3_path'],
                'has_original': original_path is not None,
                'status_tecnico': result.get('status_tecnico', 'optimo'),
                'alertas': result.get('alertas'),
            })}\n\n"
        
        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
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
        # Catch-all: never crash the server, never leak internal details
        _safe_remove(audio_path)
        raise HTTPException(
            status_code=500,
            detail="Internal server error. Please try again later.",
        )
