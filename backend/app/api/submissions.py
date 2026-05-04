"""Submission management API — list, detail, status updates, delete."""

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlmodel import Session, select

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
    phase_correlation: float | None
    musical_key: str | None
    status: str
    rejection_reason: str | None
    mp3_path: str | None
    created_at: str


class SubmissionSummary(BaseModel):
    id: str
    producer_name: str
    track_name: str
    status: str
    bpm: float | None
    lufs: float | None
    phase_correlation: float | None
    musical_key: str | None
    created_at: str


class UpdateStatusRequest(BaseModel):
    status: str  # "approved" | "rejected"
    rejection_reason: str | None = None


class UpdateStatusResponse(BaseModel):
    id: str
    status: str
    rejection_reason: str | None
    mp3_path: str | None


class DeleteResponse(BaseModel):
    id: str
    deleted: bool


# --- Auth helper ---

def _get_label_from_token(
    authorization: str | None = Header(None),
    x_label_token: str | None = Header(None),
) -> dict[str, str]:
    """Extract and verify JWT from Authorization header or X-Label-Token."""
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    elif x_label_token:
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
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """List submissions with optional filters. Requires label owner auth."""
    label_id = auth["label_id"]

    query = select(Submission).where(Submission.label_id == label_id)

    if status:
        if status not in ("pending", "approved", "rejected"):
            raise HTTPException(status_code=400, detail=f"Invalid status filter: {status}")
        query = query.where(Submission.status == status)

    query = query.order_by(Submission.created_at.desc())
    submissions = session.exec(query).all()

    return [
        SubmissionSummary(
            id=s.id,
            producer_name=s.producer_name,
            track_name=s.track_name,
            status=s.status,
            bpm=s.bpm,
            lufs=s.lufs,
            phase_correlation=s.phase_correlation,
            musical_key=s.musical_key,
            created_at=s.created_at.isoformat(),
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
        phase_correlation=submission.phase_correlation,
        musical_key=submission.musical_key,
        status=submission.status,
        rejection_reason=submission.rejection_reason,
        mp3_path=submission.mp3_path,
        created_at=submission.created_at.isoformat(),
    )


@router.patch("/submissions/{submission_id}/status", response_model=UpdateStatusResponse)
async def update_submission_status(
    submission_id: str,
    body: UpdateStatusRequest,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Update submission status (approve/reject manually). Requires label owner auth."""
    if body.status not in ("approved", "rejected"):
        raise HTTPException(
            status_code=400,
            detail="Status must be 'approved' or 'rejected'.",
        )

    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")

    _verify_label_ownership(session, auth["label_id"], submission)

    if submission.status not in ("pending",):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot update status of a '{submission.status}' submission.",
        )

    # Rejecting requires a reason
    if body.status == "rejected":
        if not body.rejection_reason:
            raise HTTPException(
                status_code=400,
                detail="rejection_reason is required when rejecting.",
            )
        submission.rejection_reason = body.rejection_reason

    # Approving requires MP3 preview availability
    if body.status == "approved" and not submission.mp3_path:
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
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Delete submission and associated MP3 file. Requires label owner auth."""
    import os

    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")

    _verify_label_ownership(session, auth["label_id"], submission)

    # Delete associated MP3 file if it exists
    if submission.mp3_path and os.path.exists(submission.mp3_path):
        try:
            os.remove(submission.mp3_path)
        except OSError:
            pass  # Best-effort cleanup

    session.delete(submission)
    session.commit()

    return DeleteResponse(id=submission_id, deleted=True)
