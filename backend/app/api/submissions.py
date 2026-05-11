"""Submission management API — list, detail, status updates, delete."""

import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session, select, func

from app.database import get_session
from app.models import Label, Submission
from app.services.auth import verify_token

router = APIRouter(prefix="/api", tags=["submissions"])


# --- Request / Response schemas ---

class SubmissionDetail(BaseModel):
    id: str
    label_id: str
    producer_name: str
    producer_email: str
    track_name: str
    bpm: float | None
    lufs: float | None
    duration: float | None
    phase_correlation: float | None
    musical_key: str | None
    status: str
    rejection_reason: str | None
    mp3_path: str | None
    original_path: str | None
    notes: str | None
    created_at: str


class SubmissionSummary(BaseModel):
    id: str
    producer_name: str
    producer_email: str | None
    track_name: str
    status: str
    rejection_reason: str | None = None
    mp3_path: str | None
    original_path: str | None
    bpm: float | None
    lufs: float | None
    duration: float | None
    phase_correlation: float | None
    musical_key: str | None
    true_peak: float | None = None
    crest_factor: float | None = None
    notes: str | None
    created_at: str
    deleted_at: str | None = None


class UpdateStatusRequest(BaseModel):
    status: str  # "shortlist" | "rejected" | "approved" | "auto_rejected"
    rejection_reason: str | None = None


class UpdateStatusResponse(BaseModel):
    id: str
    status: str
    rejection_reason: str | None
    mp3_path: str | None


class DeleteResponse(BaseModel):
    id: str
    deleted: bool


class RestoreResponse(BaseModel):
    id: str
    restored: bool


# --- Auth helper (header + cookie) ---

def _get_label_from_token(request: Request) -> dict[str, str]:
    """Extract and verify JWT from cookie, Authorization header, or X-Label-Token."""
    token = request.cookies.get("token")

    if not token:
        authorization = request.headers.get("authorization")
        if authorization and authorization.startswith("Bearer "):
            token = authorization.split(" ", 1)[1]

    if not token:
        x_label_token = request.headers.get("x-label-token")
        if x_label_token:
            token = x_label_token

    if not token:
        raise HTTPException(status_code=401, detail="Authentication required.")

    try:
        return verify_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")


def _verify_label_ownership(session: Session, label_id: str, submission: Submission) -> None:
    """Ensure the submission belongs to the authenticated label."""
    if submission.label_id != label_id:
        raise HTTPException(status_code=403, detail="Access denied to this submission.")


# --- Endpoints ---

@router.get("/submissions", response_model=list[SubmissionSummary])
async def list_submissions(
    label_id: str | None = None,
    status: str | None = None,
    offset: int = 0,
    limit: int = 100,
    include_deleted: bool = False,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """List submissions with optional filters. Requires label owner auth."""
    label_id = auth["label_id"]

    query = select(Submission).where(
        Submission.label_id == label_id,
    )

    if not include_deleted:
        query = query.where(Submission.deleted_at.is_(None))

    if status:
        if status not in ("inbox", "shortlist", "rejected", "auto_rejected", "pending", "approved"):
            raise HTTPException(status_code=400, detail=f"Invalid status filter: {status}")
        query = query.where(Submission.status == status)

    query = query.order_by(Submission.created_at.desc()).offset(offset).limit(limit)
    submissions = session.exec(query).all()

    return [
        SubmissionSummary(
            id=s.id,
            producer_name=s.producer_name,
            producer_email=s.producer_email,
            track_name=s.track_name,
            status=s.status,
            rejection_reason=s.rejection_reason,
            mp3_path=s.mp3_path,
            original_path=s.original_path,
            bpm=s.bpm,
            lufs=s.lufs,
            duration=s.duration,
            phase_correlation=s.phase_correlation,
            musical_key=s.musical_key,
            true_peak=s.true_peak,
            crest_factor=s.crest_factor,
            notes=s.notes,
            created_at=s.created_at.isoformat(),
            deleted_at=s.deleted_at.isoformat() if s.deleted_at else None,
        )
        for s in submissions
    ]


@router.get("/submissions/{submission_id}", response_model=SubmissionDetail)
async def get_submission(
    submission_id: str,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Get single submission detail. Requires label owner auth."""
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")

    _verify_label_ownership(session, auth["label_id"], submission)

    return SubmissionDetail(
        id=submission.id,
        label_id=submission.label_id,
        producer_name=submission.producer_name,
        producer_email=submission.producer_email,
        track_name=submission.track_name,
        bpm=submission.bpm,
        lufs=submission.lufs,
        duration=submission.duration,
        phase_correlation=submission.phase_correlation,
        musical_key=submission.musical_key,
        status=submission.status,
        rejection_reason=submission.rejection_reason,
        mp3_path=submission.mp3_path,
        original_path=submission.original_path,
        notes=submission.notes,
        created_at=submission.created_at.isoformat(),
    )


@router.patch("/submissions/{submission_id}/status", response_model=UpdateStatusResponse)
async def update_submission_status(
    submission_id: str,
    body: UpdateStatusRequest,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Update submission status (shortlist/reject/auto_reject manually). Requires label owner auth."""
    if body.status not in ("shortlist", "rejected", "approved", "auto_rejected"):
        raise HTTPException(
            status_code=400,
            detail="Status must be 'shortlist', 'rejected', 'approved', or 'auto_rejected'.",
        )

    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")

    _verify_label_ownership(session, auth["label_id"], submission)

    # Rejecting requires a reason
    if body.status == "rejected":
        if not body.rejection_reason:
            raise HTTPException(
                status_code=400,
                detail="rejection_reason is required when rejecting.",
            )
        submission.rejection_reason = body.rejection_reason

    # Approving/shortlisting requires MP3 preview availability
    if body.status in ("approved", "shortlist") and not submission.mp3_path:
        raise HTTPException(
            status_code=400,
            detail="Cannot approve: MP3 preview not available. Run audio analysis first.",
        )

    submission.status = body.status

    session.add(submission)
    session.commit()
    session.refresh(submission)

    return UpdateStatusResponse(
        id=submission.id,
        status=submission.status,
        rejection_reason=submission.rejection_reason,
        mp3_path=submission.mp3_path,
    )


@router.delete("/submissions/{submission_id}", response_model=DeleteResponse)
async def delete_submission(
    submission_id: str,
    force: bool = False,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Soft-delete submission (sets deleted_at). If force=True, hard delete from DB and filesystem. Requires label owner auth."""

    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")

    _verify_label_ownership(session, auth["label_id"], submission)

    if force:
        # Hard delete: remove files from disk
        for path_attr in ("mp3_path", "original_path"):
            path = getattr(submission, path_attr)
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass  # Best effort
        
        session.delete(submission)
        session.commit()
    else:
        # Soft delete: set deleted_at timestamp
        submission.deleted_at = datetime.now(timezone.utc)
        session.add(submission)
        session.commit()

    return DeleteResponse(id=submission_id, deleted=True)


@router.patch("/submissions/{submission_id}/restore", response_model=RestoreResponse)
async def restore_submission(
    submission_id: str,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Restore a soft-deleted submission if within 24h window. Requires label owner auth."""
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")

    _verify_label_ownership(session, auth["label_id"], submission)

    if submission.deleted_at is None:
        raise HTTPException(status_code=400, detail="Submission is not deleted.")

    # Check 24h window
    now = datetime.now(timezone.utc)
    elapsed = (now - submission.deleted_at).total_seconds()
    if elapsed > 86400:  # 24 hours
        raise HTTPException(
            status_code=400,
            detail="Cannot restore: deleted more than 24h ago (permanently removed by cron).",
        )

    submission.deleted_at = None
    session.add(submission)
    session.commit()

    return RestoreResponse(id=submission_id, restored=True)


class DeleteFileResponse(BaseModel):
    deleted: bool


class HQCountResponse(BaseModel):
    count: int
    limit: int
    processed_count: int = 0


@router.delete("/submissions/{submission_id}/file", response_model=DeleteFileResponse)
async def delete_submission_file(
    submission_id: str,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Delete only the MP3 file from a submission (sets mp3_path to null). Requires label owner auth."""
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")

    _verify_label_ownership(session, auth["label_id"], submission)

    if not submission.mp3_path:
        raise HTTPException(status_code=400, detail="No MP3 file associated with this submission.")

    # Delete the MP3 file from disk
    if os.path.exists(submission.mp3_path):
        try:
            os.remove(submission.mp3_path)
        except OSError:
            pass  # Best-effort

    submission.mp3_path = None
    session.add(submission)
    session.commit()

    return DeleteFileResponse(deleted=True)


@router.get("/labels/{slug}/hq-count", response_model=HQCountResponse)
async def get_label_hq_count(
    slug: str,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Get the count of HQ (original WAV/FLAC) stored submissions for a label. Requires label owner auth."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail=f"Label '{slug}' not found.")

    if label.id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this label.")

    import sqlalchemy as sa
    
    count = session.exec(
        select(func.count()).where(
            Submission.label_id == label.id,
            Submission.deleted_at.is_(None),
            sa.or_(
                Submission.original_path.isnot(None),
                Submission.mp3_path.isnot(None),
            ),
        )
    ).one()

    processed = session.exec(
        select(func.count()).where(
            Submission.label_id == label.id,
            Submission.deleted_at.is_(None),
        )
    ).one()

    return HQCountResponse(count=count, limit=10, processed_count=processed)


@router.get("/submissions/{submission_id}/download")
async def download_original(
    submission_id: str,
    type: str | None = None,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Download the original or MP3 file. Requires label owner auth."""
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")

    _verify_label_ownership(session, auth["label_id"], submission)

    if type == "mp3":
        file_path = submission.mp3_path
    else:
        file_path = submission.original_path or submission.mp3_path

    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not available.")

    ext = Path(file_path).suffix
    filename = f"{submission.track_name or submission.id}{ext}"
    
    media_type = "audio/wav" if ext in (".wav",) else "audio/flac" if ext in (".flac",) else "audio/aiff" if ext in (".aiff", ".aif") else "audio/mpeg"
    
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type=media_type,
    )
