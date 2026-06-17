"""Email API — send, logs, templates CRUD."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models import EmailLog, EmailTemplate, Label, Submission
from app.services.auth import verify_token
from app.services.email_service import EmailSendError, send_email

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
    label_id: str
    name: str
    template_type: str
    subject: str
    body: str
    created_at: datetime | None = None
    is_default: bool = False


class CreateTemplateRequest(BaseModel):
    name: str
    template_type: str  # rejection | approval | custom
    subject_template: str
    body_template: str


class UpdateTemplateRequest(BaseModel):
    name: str | None = None
    template_type: str | None = None
    subject_template: str | None = None
    body_template: str | None = None


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
async def list_templates(
    defaults: bool = False,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Return email templates for the authenticated label.
    
    If defaults=true, return the hardcoded original templates (for restore).
    Otherwise, return templates from DB with is_default flag.
    """
    label_id = auth["label_id"]
    
    # If requesting defaults, return hardcoded originals
    if defaults:
        from app.services.email_service import get_fixed_template
        
        # Get label's language preference
        label = session.get(Label, label_id)
        lang = label.lang if label else "es"
        
        rejection = get_fixed_template("rejection", lang)
        approval = get_fixed_template("approval", lang)
        
        rejection_name = "Rejection" if lang == "en" else "Rechazo"
        approval_name = "Approval" if lang == "en" else "Aprobación"
        
        return [
            TemplateResponse(
                id="default-rejection",
                label_id=label_id,
                name=rejection_name,
                template_type="rejection",
                subject=rejection["subject"],
                body=rejection["body"],
                is_default=True,
            ),
            TemplateResponse(
                id="default-approval",
                label_id=label_id,
                name=approval_name,
                template_type="approval",
                subject=approval["subject"],
                body=approval["body"],
                is_default=True,
            ),
        ]
    
    # Fetch templates from DB, optionally filtered by the label's language
    # If a template doesn't have a language set (legacy), we still show it.
    label = session.get(Label, label_id)
    lang = label.lang if label else "es"
    
    templates = session.exec(
        select(EmailTemplate)
        .where(EmailTemplate.label_id == label_id)
        .where((EmailTemplate.lang == lang) | (EmailTemplate.lang == None))
        .order_by(EmailTemplate.created_at.desc())
    ).all()
    
    # Return templates with is_default flag
    return [
        TemplateResponse(
            id=t.id,
            label_id=t.label_id,
            name=t.name,
            template_type=t.template_type,
            subject=t.subject_template,
            body=t.body_template,
            created_at=t.created_at,
            is_default=(t.template_type in ["rejection", "approval"]),
        )
        for t in templates
    ]


@router.post("/templates", response_model=TemplateResponse)
async def create_template(
    body: CreateTemplateRequest,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Create a new email template for the authenticated label."""
    label_id = auth["label_id"]
    label = session.get(Label, label_id)
    lang = label.lang if label else "es"
    
    template = EmailTemplate(
        label_id=label_id,
        name=body.name,
        template_type=body.template_type,
        subject_template=body.subject_template,
        body_template=body.body_template,
        lang=lang,
    )
    session.add(template)
    session.commit()
    session.refresh(template)
    
    return TemplateResponse(
        id=template.id,
        label_id=template.label_id,
        name=template.name,
        template_type=template.template_type,
        subject=template.subject_template,
        body=template.body_template,
        created_at=template.created_at,
    )


@router.put("/templates/{template_id}", response_model=TemplateResponse)
async def update_template(
    template_id: str,
    body: UpdateTemplateRequest,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Update an existing email template."""
    template = session.get(EmailTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found.")
    if template.label_id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this template.")
    
    # Update fields if provided
    if body.name is not None:
        template.name = body.name
    if body.template_type is not None:
        template.template_type = body.template_type
    if body.subject_template is not None:
        template.subject_template = body.subject_template
    if body.body_template is not None:
        template.body_template = body.body_template
    
    template.updated_at = datetime.now(UTC)
    session.add(template)
    session.commit()
    session.refresh(template)
    
    return TemplateResponse(
        id=template.id,
        label_id=template.label_id,
        name=template.name,
        template_type=template.template_type,
        subject=template.subject_template,
        body=template.body_template,
        created_at=template.created_at,
    )


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: str,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Delete an email template."""
    template = session.get(EmailTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found.")
    if template.label_id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this template.")
    
    session.delete(template)
    session.commit()
    
    return {"status": "deleted"}
