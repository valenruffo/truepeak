"""Email API — send, generate draft, template CRUD."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models import EmailLog, EmailTemplate, Label, Submission
from app.services.auth import verify_token
from app.services.email_service import EmailSendError, send_email
from app.services.llm_email import LLMEmailError, generate_email_draft, get_fallback_template

router = APIRouter(prefix="/api", tags=["email"])


# --- Request / Response schemas ---

class SendEmailRequest(BaseModel):
    to: str
    subject: str
    body: str
    from_name: str = "True Peak AI"


class SendEmailResponse(BaseModel):
    id: str
    status: str


class GenerateEmailRequest(BaseModel):
    submission_id: str
    template_type: str  # "rejection" | "approval"


class GenerateEmailResponse(BaseModel):
    subject: str
    body: str


class EmailTemplateCreate(BaseModel):
    label_id: str
    name: str
    template_type: str  # rejection | approval | followup
    subject_template: str
    body_template: str


class EmailTemplateResponse(BaseModel):
    id: str
    label_id: str
    name: str
    template_type: str
    subject_template: str
    body_template: str


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

@router.post("/email/send", response_model=SendEmailResponse)
async def send_email_endpoint(
    body: SendEmailRequest,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Send an email via Resend API. Creates an EmailLog record."""
    try:
        # Get label owner email for reply-to
        label = session.get(Label, auth["label_id"])
        reply_to = label.owner_email if label else None

        result = await send_email(
            to=body.to,
            subject=body.subject,
            body=body.body,
            from_name=body.from_name,
            reply_to=reply_to,
        )

        # Create EmailLog record
        log = EmailLog(
            submission_id="",  # TODO: associate with submission if available
            sent_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
            status="sent",
        )
        session.add(log)
        session.commit()

        return SendEmailResponse(id=result.id, status=result.status)

    except EmailSendError as e:
        # Log the failure
        log = EmailLog(
            submission_id="",
            sent_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
            status="failed",
            error=e.message,
        )
        session.add(log)
        session.commit()

        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.post("/email/generate", response_model=GenerateEmailResponse)
async def generate_email(
    body: GenerateEmailRequest,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Generate personalized rejection/approval email draft via LLM.

    Fetches submission metrics, builds prompt with technical details,
    calls OpenAI to generate personalized email. Falls back to template
    if LLM call fails.
    """
    # Fetch submission
    submission = session.get(Submission, body.submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")

    # Verify ownership
    if submission.label_id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this submission.")

    # Fetch label
    label = session.get(Label, submission.label_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found.")

    # Validate template type
    if body.template_type not in ("rejection", "approval"):
        raise HTTPException(
            status_code=400,
            detail="template_type must be 'rejection' or 'approval'.",
        )

    # Try LLM generation first, fall back to template
    try:
        draft = await generate_email_draft(
            submission=submission,
            template_type=body.template_type,
            label=label,
        )
    except LLMEmailError:
        # Fall back to basic template
        draft = get_fallback_template(
            submission=submission,
            template_type=body.template_type,
            label=label,
        )

    return GenerateEmailResponse(subject=draft["subject"], body=draft["body"])


@router.get("/email/templates", response_model=list[EmailTemplateResponse])
async def list_email_templates(
    label_id: str | None = None,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """List email templates for a label."""
    target_label_id = label_id or auth["label_id"]

    if target_label_id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to these templates.")

    templates = session.exec(
        select(EmailTemplate).where(EmailTemplate.label_id == target_label_id)
    ).all()

    return [
        EmailTemplateResponse(
            id=t.id,
            label_id=t.label_id,
            name=t.name,
            template_type=t.template_type,
            subject_template=t.subject_template,
            body_template=t.body_template,
        )
        for t in templates
    ]


@router.post("/email/templates", response_model=EmailTemplateResponse)
async def create_email_template(
    body: EmailTemplateCreate,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Create or update an email template for a label."""
    # Verify label ownership
    if body.label_id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this label.")

    # Check if template with same name already exists for this label
    existing = session.exec(
        select(EmailTemplate).where(
            EmailTemplate.label_id == body.label_id,
            EmailTemplate.name == body.name,
        )
    ).first()

    if existing:
        # Update existing template
        existing.template_type = body.template_type
        existing.subject_template = body.subject_template
        existing.body_template = body.body_template
        session.add(existing)
        session.commit()
        session.refresh(existing)
        template = existing
    else:
        # Create new template
        template = EmailTemplate(
            label_id=body.label_id,
            name=body.name,
            template_type=body.template_type,
            subject_template=body.subject_template,
            body_template=body.body_template,
        )
        session.add(template)
        session.commit()
        session.refresh(template)

    return EmailTemplateResponse(
        id=template.id,
        label_id=template.label_id,
        name=template.name,
        template_type=template.template_type,
        subject_template=template.subject_template,
        body_template=template.body_template,
    )
