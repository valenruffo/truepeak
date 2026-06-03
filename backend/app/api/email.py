"""Email API — send, logs, fixed templates."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models import EmailLog, Label, Submission
from app.services.auth import verify_token
from app.services.email_service import EmailSendError, get_fixed_template, send_email

router = APIRouter(prefix="/api/email", tags=["email"])


# --- Request / Response schemas ---


class SendEmailRequest(BaseModel):
    to: str
    subject: str
    body: str
    from_name: str = "True Peak"
    submission_id: str | None = None  # Optional: associate with submission for quota tracking


class SendEmailResponse(BaseModel):
    id: str
    status: str


class EmailLogResponse(BaseModel):
    subject: str | None = None
    body: str | None = None


class TemplateResponse(BaseModel):
    id: str
    template_type: str
    subject: str
    body: str


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


# --- Endpoints ---


@router.post("/send", response_model=SendEmailResponse)
async def send_email_endpoint(
    body: SendEmailRequest,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Send an email via Resend API. Creates an EmailLog record.

    If submission_id is provided:
    - Checks human_email_sent flag (prevent double-send)
    - Checks monthly email quota (max_emails_month)
    """
    # If submission_id provided, validate and check quota
    if body.submission_id:
        submission = session.get(Submission, body.submission_id)
        if not submission:
            raise HTTPException(status_code=404, detail="Submission not found.")
        if submission.label_id != auth["label_id"]:
            raise HTTPException(status_code=403, detail="Access denied to this submission.")

        # Prevent double-send
        if submission.human_email_sent:
            raise HTTPException(
                status_code=400,
                detail="Email already sent for this submission.",
            )

        # Check monthly email quota
        label = session.get(Label, auth["label_id"])
        if label:
            now = datetime.now(UTC)
            # Reset counter if new month
            if label.emails_sent_month != now.month:
                label.emails_sent_this_month = 0
                label.emails_sent_month = now.month

            if (
                label.max_emails_month > 0
                and label.emails_sent_this_month >= label.max_emails_month
            ):
                raise HTTPException(
                    status_code=429,
                    detail=f"Monthly email quota exceeded ({label.emails_sent_this_month}/{label.max_emails_month}).",
                )
    try:
        # Get label owner email for reply-to — prefer custom reply_to_email if set
        label = session.get(Label, auth["label_id"])
        reply_to = (label.reply_to_email or label.owner_email) if label else None

        result = await send_email(
            to=body.to,
            subject=body.subject,
            body=body.body,
            from_name=body.from_name,
            reply_to=reply_to,
        )

        # Create EmailLog record
        log = EmailLog(
            submission_id=body.submission_id or "",
            sent_at=datetime.now(UTC),
            status="sent",
            subject=body.subject,
            body=body.body,
        )
        session.add(log)

        # Mark submission as emailed and increment quota
        if body.submission_id:
            submission = session.get(Submission, body.submission_id)
            if submission:
                submission.human_email_sent = True

            label = session.get(Label, auth["label_id"])
            if label:
                label.emails_sent_this_month += 1

        session.commit()

        return SendEmailResponse(id=result.id, status=result.status)

    except EmailSendError as e:
        # Log the failure
        log = EmailLog(
            submission_id=body.submission_id or "",
            sent_at=datetime.now(UTC),
            status="failed",
            error=e.message,
            subject=body.subject,
            body=body.body,
        )
        session.add(log)
        session.commit()

        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/logs/{submission_id}", response_model=EmailLogResponse)
async def get_email_logs(
    submission_id: str,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Fetch the latest email log details (subject and body) for a submission.

    Verifies label ownership of the submission.
    """
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")
    if submission.label_id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this submission.")

    log = session.exec(
        select(EmailLog)
        .where(EmailLog.submission_id == submission_id)
        .order_by(EmailLog.sent_at.desc())
    ).first()

    if not log:
        raise HTTPException(status_code=404, detail="No email log found for this submission.")

    return EmailLogResponse(subject=log.subject, body=log.body)


@router.get("/templates", response_model=list[TemplateResponse])
async def list_templates():
    """Return the fixed email templates (rejection and approval).

    No auth required — these are the same for all labels.
    Templates include placeholders like {{producer_name}}, {{track_name}}, {{bpm}}, etc.
    """
    rejection = get_fixed_template("rejection")
    approval = get_fixed_template("approval")
    return [
        TemplateResponse(
            id="fixed-rejection",
            template_type="rejection",
            subject=rejection["subject"],
            body=rejection["body"],
        ),
        TemplateResponse(
            id="fixed-approval",
            template_type="approval",
            subject=approval["subject"],
            body=approval["body"],
        ),
    ]
