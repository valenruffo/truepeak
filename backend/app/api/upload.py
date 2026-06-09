"""Audio upload endpoints — presigned URL, analyze trigger, legacy fallback.

Three-phase flow (Phase 2 of upload-progress-improvement):
  1. POST /api/presigned-url  -> {upload_url, r2_key, submission_id}
  2. Browser PUTs file directly to R2 with XHR progress.
  3. POST /api/analyze        -> SSE stream of progress + final result.

The legacy /api/upload endpoint is kept (marked deprecated) as a fallback
when direct R2 upload is unavailable.
"""

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
from app.services.r2 import generate_presigned_url
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


class PresignedUrlRequest(BaseModel):
    label_slug: str
    filename: str
    content_type: str
    file_size: int


class PresignedUrlResponse(BaseModel):
    upload_url: str
    r2_key: str
    submission_id: str


class AnalyzeRequest(BaseModel):
    r2_key: str
    submission_id: str | None = None
    label_slug: str
    producer_name: str = ""
    producer_email: str = ""
    track_name: str = ""
    notes: str = ""
    producer_instagram: str = ""
    producer_soundcloud: str = ""
    producer_spotify: str = ""


ORIGINALS_DIR = Path("/app/data/originals")


def _safe_remove(file_path: str) -> None:
    """Safely remove a temporary file."""
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except OSError:
        # Log but don't crash — cleanup best-effort
        pass


def _validate_label_for_submission(label_slug: str) -> tuple[str, dict, int]:
    """Look up the label, enforce subscription and free-plan limits.

    Returns:
        (label_id, sonic_signature, hq_retention_days)

    Raises:
        HTTPException(404) when the label is missing.
        HTTPException(403) when the label subscription is frozen.
        HTTPException(400) when the free-plan monthly limit is hit.
    """
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
                    detail=(
                        f"Plan gratuito: máximo {label.max_tracks_month} tracks por mes. "
                        "Esperá al mes próximo o hacé upgrade."
                    ),
                )
        return label_id, sonic_signature, hq_retention_days
    finally:
        session.close()


def _extension_to_content_type(ext: str) -> str | None:
    """Map a file extension to the canonical audio MIME type used in R2 metadata."""
    ext = (ext or "").lower()
    if ext == ".wav":
        return "audio/wav"
    if ext == ".flac":
        return "audio/flac"
    if ext in (".aiff", ".aif"):
        return "audio/aiff"
    return None


# ── POST /api/presigned-url ──────────────────────────────────────────────────


@router.post("/presigned-url", response_model=PresignedUrlResponse)
@limiter.limit("30/minute")
async def create_presigned_url(request: Request, body: PresignedUrlRequest):
    """Generate a presigned PUT URL so the browser can upload directly to R2.

    The URL is signed for 15 minutes and bound to the requested
    Content-Type + Content-Length, so the user cannot bypass the size or
    format restrictions we advertise.

    This endpoint does NOT touch the database; the resulting
    `submission_id` is reserved only in the sense that the analyze step
    that follows will look up the file at the same R2 key.
    """
    if not body.filename:
        raise HTTPException(status_code=400, detail="filename is required")
    if not body.content_type:
        raise HTTPException(status_code=400, detail="content_type is required")
    if body.file_size <= 0:
        raise HTTPException(status_code=400, detail="file_size must be > 0")

    # Validate the label exists & is accepting submissions.
    label_id, sonic_signature, _hq = _validate_label_for_submission(body.label_slug)

    # Enforce format/size limits BEFORE generating the URL.
    ext = Path(body.filename).suffix.lower()
    allowed_formats = sonic_signature.get("allowed_formats", ["wav", "flac", "aiff"])
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

    # Cap by sonic signature, hard ceiling 200MB (matches the spec).
    max_upload_size_mb = min(sonic_signature.get("max_upload_size_mb", 100), 200)
    max_size_bytes = max_upload_size_mb * 1024 * 1024
    if body.file_size > max_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=(
                f"El archivo es demasiado grande. "
                f"El límite para este sello es {max_upload_size_mb}MB."
            ),
        )

    # The R2 key mirrors the lifecycle's naming convention so we don't have
    # to rename anything on the analyze step.
    submission_id = str(uuid.uuid4())
    r2_key = f"tracks/{submission_id}/original{ext}"
    content_type = _extension_to_content_type(ext) or body.content_type

    try:
        upload_url = await generate_presigned_url(
            r2_key=r2_key,
            content_type=content_type,
            content_length=body.file_size,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate presigned URL: {e}",
        )

    return PresignedUrlResponse(
        upload_url=upload_url,
        r2_key=r2_key,
        submission_id=submission_id,
    )


# ── POST /api/analyze (new 3-phase endpoint) ────────────────────────────────


@router.post("/analyze")
@limiter.limit("10/minute")
async def analyze_submission(
    request: Request,
    body: AnalyzeRequest,
):
    """Trigger the analysis pipeline against a file that is already on R2.

    The frontend should have already:
      1. Called `/api/presigned-url` to get an upload URL.
      2. PUT the file directly to R2 with XHR progress tracking.

    This endpoint then downloads the file from R2, runs the analysis
    pipeline, and streams progress as Server-Sent Events.
    """
    if not body.r2_key:
        raise HTTPException(status_code=400, detail="r2_key is required")
    if not body.label_slug:
        raise HTTPException(status_code=400, detail="label_slug is required")

    label_id, sonic_signature, hq_retention_days = _validate_label_for_submission(
        body.label_slug
    )
    if body.producer_email and not EMAIL_RE.match(body.producer_email):
        raise HTTPException(status_code=400, detail="Invalid email format.")

    submission_id = body.submission_id or str(uuid.uuid4())
    return await _sse_submission_response(
        submission_id=submission_id,
        label_id=label_id,
        sonic_signature=sonic_signature,
        hq_retention_days=hq_retention_days,
        r2_key=body.r2_key,
        producer_name=body.producer_name,
        producer_email=body.producer_email,
        track_name=body.track_name,
        notes=body.notes,
        producer_instagram=body.producer_instagram,
        producer_soundcloud=body.producer_soundcloud,
        producer_spotify=body.producer_spotify,
    )


async def _sse_submission_response(
    submission_id: str,
    label_id: str,
    sonic_signature: dict,
    hq_retention_days: int,
    *,
    r2_key: str | None = None,
    local_file_path: str | None = None,
    producer_name: str = "",
    producer_email: str = "",
    track_name: str = "",
    notes: str = "",
    producer_instagram: str = "",
    producer_soundcloud: str = "",
    producer_spotify: str = "",
    file_label_name: str | None = None,
) -> StreamingResponse:
    """Build the SSE StreamingResponse that runs the lifecycle and streams events.

    Exactly one of `r2_key` or `local_file_path` must be set. The first runs
    the new download-based pipeline; the second runs the legacy
    already-on-disk path used as a fallback by /api/upload.
    """
    if (r2_key is None) == (local_file_path is None):
        raise HTTPException(
            status_code=500,
            detail="SSE builder requires exactly one of r2_key or local_file_path",
        )

    async def event_generator():
        progress_queue: asyncio.Queue = asyncio.Queue()

        async def on_progress(stage: str, pct: int):
            await progress_queue.put({"stage": stage, "pct": pct})

        if r2_key is not None:
            process_kwargs = {"r2_key": r2_key}
        else:
            process_kwargs = {"file_path": local_file_path}

        process_task = asyncio.create_task(
            process_submission(
                submission_id=submission_id,
                label_id=label_id,
                sonic_signature=sonic_signature,
                on_progress=on_progress,
                **process_kwargs,
            )
        )

        # Stream progress events while processing
        while not process_task.done():
            try:
                event = await asyncio.wait_for(progress_queue.get(), timeout=0.3)
                yield f"data: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                continue

        try:
            result = await process_task
        except AudioAnalysisError as e:
            yield f"data: {json.dumps({'error': f'Audio analysis failed: {e}'})}\n\n"
            return
        except Exception as e:
            yield f"data: {json.dumps({'error': f'Processing failed: {e}'})}\n\n"
            return

        yield f"data: {json.dumps({'stage': 'Guardando...', 'pct': 95})}\n\n"

        original_path: str | None = None
        if hq_retention_days > 0:
            original_path = result.get("original_path")
        else:
            op = result.get("original_path")
            if op:
                from app.services.r2 import delete_file_from_r2
                try:
                    await delete_file_from_r2(op)
                except Exception:  # noqa: BLE001
                    pass

        # --- Create submission record in DB ---
        session = next(get_session())
        try:
            submission = Submission(
                id=submission_id,
                label_id=label_id,
                producer_name=producer_name or file_label_name or "Unknown",
                producer_email=producer_email or "",
                track_name=track_name or file_label_name or "Unknown Track",
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


# ── POST /api/upload (legacy fallback, deprecated) ───────────────────────────


@router.post("/upload", response_model=UploadResponse, deprecated=True)
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
    """Legacy fallback upload endpoint.

    Used only when the new 3-phase flow (`/api/presigned-url` +
    direct R2 upload + `/api/analyze`) is unavailable (e.g. R2 CORS not
    configured). Prefer `/api/presigned-url` for new clients.

    Validates file type and size, saves to /tmp temporarily, runs the
    zero-storage lifecycle pipeline, and streams results as SSE.
    """
    audio_path: str | None = None

    try:
        label_id, sonic_signature, hq_retention_days = _validate_label_for_submission(label_slug)

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

        return await _sse_submission_response(
            submission_id=submission_id,
            label_id=label_id,
            sonic_signature=sonic_signature,
            hq_retention_days=hq_retention_days,
            local_file_path=audio_path,
            producer_name=producer_name,
            producer_email=producer_email,
            track_name=track_name,
            notes=notes,
            producer_instagram=producer_instagram,
            producer_soundcloud=producer_soundcloud,
            producer_spotify=producer_spotify,
            file_label_name=file.filename,
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
