"""Label management API — register, config, login, stats."""

import os
import httpx
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlmodel import Session, select, func

from app.database import get_session
from app.models import Label, Submission, Notification
from app.services.auth import verify_token, sync_user_to_supabase
from app.services.r2 import upload_bytes_to_r2

router = APIRouter(prefix="/api/labels", tags=["labels"])

limiter = Limiter(key_func=get_remote_address)

# Plan limits configuration
PLAN_LIMITS = {
    "free":  {"max_tracks_month": 10,  "max_emails_month": 0,   "hq_retention_days": 0},
    "indie": {"max_tracks_month": 100, "max_emails_month": 100, "hq_retention_days": 7},
    "pro":   {"max_tracks_month": 1000, "max_emails_month": 500, "hq_retention_days": 14},
}


def _apply_plan_limits(label: Label, plan: str | None = None) -> None:
    """Set plan limits on a label based on its plan tier."""
    tier = (plan or label.plan or "free").lower()
    limits = PLAN_LIMITS.get(tier, PLAN_LIMITS["free"])
    label.max_tracks_month = limits["max_tracks_month"]
    label.max_emails_month = limits["max_emails_month"]
    label.hq_retention_days = limits["hq_retention_days"]




# --- Auth helper (header + cookie) ---

def _get_label_from_token(request: Request) -> dict[str, str]:
    """Extract and verify JWT from Authorization header, X-Label-Token, or cookie."""
    token = None
    
    authorization = request.headers.get("authorization")
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]

    if not token:
        x_label_token = request.headers.get("x-label-token")
        if x_label_token:
            token = x_label_token

    if not token:
        token = request.cookies.get("token")

    if not token:
        raise HTTPException(status_code=401, detail="Authentication required.")

    try:
        return verify_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")


# --- Request / Response schemas ---

class RegisterProfileRequest(BaseModel):
    name: str
    slug: str
    role: str = "label_owner"

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ("label_owner", "label", "dj"):
            raise ValueError("Role must be 'label_owner', 'label' or 'dj'")
        return v


class RegisterResponse(BaseModel):
    id: str
    name: str
    slug: str
    owner_email: str
    plan: str
    role: str
    created_at: str


class LabelConfig(BaseModel):
    id: str
    name: str
    slug: str
    owner_email: str
    plan: str = "free"
    subscription_status: str = "active"
    frozen_at: str | None = None
    max_tracks_month: int = 10
    max_emails_month: int = 0
    hq_retention_days: int = 0
    sonic_signature: dict[str, Any]
    created_at: str
    logo_path: str | None = None
    submission_title: str | None = None
    submission_description: str | None = None
    ask_instagram: bool = False
    ask_soundcloud: bool = False
    ask_spotify: bool = False
    role: str = "label_owner"
    reply_to_email: str | None = None  # Custom Reply-To address for outbound emails


class SonicSignatureUpdate(BaseModel):
    sonic_signature: dict[str, Any]
    """Must include: bpm_min, bpm_max, lufs_target, lufs_tolerance, preferred_scales, auto_reject_rules"""


class PlanUpdate(BaseModel):
    plan: str  # "free" | "indie" | "pro"


class LabelStats(BaseModel):
    total: int
    inbox: int
    shortlist: int
    rejected: int
    auto_rejected: int
    max_tracks_month: int
    emails_sent_this_month: int


class BillingDetails(BaseModel):
    plan: str
    status: str | None = None
    next_billing_date: str | None = None
    amount: int | None = None
    currency: str | None = None
    subscription_id: str | None = None

class PortalResponse(BaseModel):
    url: str

class HQCountResponse(BaseModel):
    count: int
    limit: int
    processed_count: int = 0
    retention_days: int = 0
    max_approved: int = 10


# --- Admin auth helper ---

def _verify_admin_key(request: Request) -> None:
    """Verify X-Admin-Key header against ADMIN_API_KEY env var."""
    admin_key = os.getenv("ADMIN_API_KEY", "")
    if not admin_key:
        raise HTTPException(status_code=500, detail="ADMIN_API_KEY not configured")
    req_key = request.headers.get("X-Admin-Key", "")
    if req_key != admin_key:
        raise HTTPException(status_code=401, detail="Admin key required")


# --- Endpoints ---

@router.post("/register-profile", response_model=RegisterResponse, status_code=201)
async def register_label_profile(
    request: Request,
    body: RegisterProfileRequest,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Create a Label profile after successful Supabase Auth signup, or recover orphaned profiles."""
    
    # Block registration in beta mode
    from app.models import AppConfig
    db_config = session.exec(select(AppConfig).where(AppConfig.key == "app_mode")).first()
    app_mode = db_config.value if db_config else os.getenv("NEXT_PUBLIC_APP_MODE", "beta")
    if app_mode == "beta":
        raise HTTPException(status_code=403, detail="Registration is closed during beta. Please join the waitlist.")
    
    label_id = auth.get("label_id")
    owner_email = auth.get("email")

    if not label_id or not owner_email:
        raise HTTPException(status_code=400, detail="Invalid auth payload")

    # Check if profile already exists by ID
    existing_profile = session.exec(select(Label).where(Label.id == label_id)).first()
    if existing_profile:
        raise HTTPException(status_code=409, detail="Profile already exists for this user.")

    # Check if an orphaned profile exists by email (migration from SQLite auth to Supabase auth)
    orphaned_profile = session.exec(select(Label).where(Label.owner_email == owner_email)).first()
    if orphaned_profile:
        old_label_id = orphaned_profile.id
        original_slug = orphaned_profile.slug
        original_email = orphaned_profile.owner_email
        
        # 1. Temporarily modify the orphaned profile's slug and email to avoid unique violations.
        # This frees up the unique constraints in Postgres so we can insert the new Label first.
        orphaned_profile.slug = f"temp-{old_label_id}"
        orphaned_profile.owner_email = f"temp-{old_label_id}@temp.com"
        session.add(orphaned_profile)
        session.flush()
        
        # 2. Create a new Label with the new Supabase label_id, copying all attributes
        new_label = Label(
            id=label_id,
            name=orphaned_profile.name,
            slug=original_slug,
            owner_email=original_email,
            password_hash=orphaned_profile.password_hash,
            sonic_signature=orphaned_profile.sonic_signature,
            created_at=orphaned_profile.created_at,
            updated_at=datetime.now(timezone.utc),
            logo_path=orphaned_profile.logo_path,
            plan=orphaned_profile.plan or "free",
            subscription_status=orphaned_profile.subscription_status or "active",
            frozen_at=orphaned_profile.frozen_at,
            churn_warning_sent=orphaned_profile.churn_warning_sent,
            final_warning_sent=orphaned_profile.final_warning_sent,
            max_tracks_month=orphaned_profile.max_tracks_month,
            max_emails_month=orphaned_profile.max_emails_month,
            hq_retention_days=orphaned_profile.hq_retention_days,
            emails_sent_this_month=orphaned_profile.emails_sent_this_month,
            emails_sent_month=orphaned_profile.emails_sent_month,
            submission_title=orphaned_profile.submission_title,
            submission_description=orphaned_profile.submission_description,
            role=orphaned_profile.role,
            polar_customer_id=orphaned_profile.polar_customer_id,
            polar_subscription_id=orphaned_profile.polar_subscription_id,
            ask_instagram=orphaned_profile.ask_instagram,
            ask_soundcloud=orphaned_profile.ask_soundcloud,
            ask_spotify=orphaned_profile.ask_spotify,
        )
        session.add(new_label)
        session.flush()  # Make sure new_label exists in Postgres before referencing it in other tables
        
        # 3. Update Submission references
        from sqlmodel import update
        
        # Update Submissions
        submissions_stmt = (
            update(Submission)
            .where(Submission.label_id == old_label_id)
            .values(label_id=label_id)
        )
        session.exec(submissions_stmt)
        session.flush()
        
        # 4. Delete the old label
        session.delete(orphaned_profile)
        session.commit()
        
        return RegisterResponse(
            id=new_label.id,
            name=new_label.name,
            slug=new_label.slug,
            owner_email=new_label.owner_email,
            plan=new_label.plan or "free",
            role=new_label.role,
            created_at=new_label.created_at.isoformat(),
        )

    # Check slug uniqueness for brand new profiles
    existing_slug = session.exec(select(Label).where(Label.slug == body.slug)).first()
    if existing_slug:
        raise HTTPException(status_code=409, detail="Ese nombre ya está en uso. Elegí otro slug.")

    sonic_signature = {
        "bpm_min": 70,
        "bpm_max": 180,
        "lufs_target": -14.0,
        "lufs_tolerance": 1.0,
        "target_camelot_keys": [],
        "auto_reject_rules": {
            "phase": True,
            "lufs": True,
            "tempo": True,
            "reject_clipping": True,
            "reject_low_dynamic_range": True,
        },
        "peak_limit_max": 0.0,
        "peak_limit_critical": 1.5,
        "crest_factor_min": 5.0,
        "crest_factor_critical": 3.5,
        "phase_correlation_min": 0.3,
        "phase_correlation_critical": 0.0,
    }

    label = Label(
        id=label_id,
        name=body.name,
        slug=body.slug,
        owner_email=owner_email,
        sonic_signature=sonic_signature,
        role=body.role,
    )
    _apply_plan_limits(label)
    session.add(label)
    session.commit()
    session.refresh(label)

    return RegisterResponse(
        id=label.id,
        name=label.name,
        slug=label.slug,
        owner_email=label.owner_email,
        plan=label.plan or "free",
        role=label.role,
        created_at=label.created_at.isoformat(),
    )


@router.get("/lookup-email")
async def lookup_email(
    identifier: str,
    session: Session = Depends(get_session),
):
    """Resolve a label's email address by name or slug."""
    if not identifier or not identifier.strip():
        raise HTTPException(status_code=400, detail="Identifier query parameter is required.")
    
    label = session.exec(
        select(Label).where(
            (Label.slug == identifier) | (Label.name == identifier)
        )
    ).first()
    
    if not label:
        raise HTTPException(status_code=404, detail="Sello no encontrado.")
        
    return {"email": label.owner_email}


@router.get("/public/slugs", response_model=list[str])
async def get_public_slugs(
    session: Session = Depends(get_session),
):
    """Retrieve all active label slugs (subscription_status != 'frozen')."""
    labels = session.exec(
        select(Label).where(Label.subscription_status != "frozen")
    ).all()
    return [label.slug for label in labels]


@router.get("/{slug}", response_model=LabelConfig)
async def get_label_config(
    slug: str,
    session: Session = Depends(get_session),
):
    """Get label configuration by slug. Public endpoint for submission page."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail="Sello no encontrado.")

    role = label.role if label.role != "label" else "label_owner"
    return LabelConfig(
        id=label.id,
        name=label.name,
        slug=label.slug,
        owner_email=label.owner_email,
        plan=label.plan or "free",
        subscription_status=label.subscription_status or "active",
        frozen_at=label.frozen_at.isoformat() if label.frozen_at else None,
        max_tracks_month=label.max_tracks_month,
        max_emails_month=label.max_emails_month,
        hq_retention_days=label.hq_retention_days,
        sonic_signature=label.sonic_signature,
        created_at=label.created_at.isoformat(),
        logo_path=label.logo_path,
        submission_title=label.submission_title,
        submission_description=label.submission_description,
        ask_instagram=label.ask_instagram,
        ask_soundcloud=label.ask_soundcloud,
        ask_spotify=label.ask_spotify,
        role=role,
        reply_to_email=label.reply_to_email,
    )


@router.put("/{slug}/config", response_model=LabelConfig)
async def update_label_config(
    slug: str,
    body: SonicSignatureUpdate,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Update label sonic signature configuration. Requires label owner auth."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail="Sello no encontrado.")

    if label.id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this label.")

    # Validate required keys
    required_keys = {
        "bpm_min",
        "bpm_max",
        "lufs_target",
        "lufs_tolerance",
        "target_camelot_keys",
        "auto_reject_rules",
        "peak_limit_max",
        "crest_factor_min",
        "phase_correlation_min",
    }
    missing = required_keys - set(body.sonic_signature.keys())
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required sonic_signature keys: {', '.join(sorted(missing))}",
        )

    label.sonic_signature = body.sonic_signature
    label.updated_at = datetime.now(timezone.utc)

    session.add(label)
    session.commit()
    session.refresh(label)

    role = label.role if label.role != "label" else "label_owner"
    return LabelConfig(
        id=label.id,
        name=label.name,
        slug=label.slug,
        owner_email=label.owner_email,
        plan=label.plan or "free",
        subscription_status=label.subscription_status or "active",
        frozen_at=label.frozen_at.isoformat() if label.frozen_at else None,
        max_tracks_month=label.max_tracks_month,
        max_emails_month=label.max_emails_month,
        hq_retention_days=label.hq_retention_days,
        sonic_signature=label.sonic_signature,
        created_at=label.created_at.isoformat(),
        logo_path=label.logo_path,
        submission_title=label.submission_title,
        submission_description=label.submission_description,
        ask_instagram=label.ask_instagram,
        ask_soundcloud=label.ask_soundcloud,
        ask_spotify=label.ask_spotify,
        role=role,
        reply_to_email=label.reply_to_email,
    )


class EmailConfigUpdate(BaseModel):
    reply_to_email: str | None = None  # None clears it, string sets it


class EmailConfigResponse(BaseModel):
    reply_to_email: str | None


@router.put("/{slug}/email-config", response_model=EmailConfigResponse)
async def update_email_config(
    slug: str,
    body: EmailConfigUpdate,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Update the custom Reply-To email for outbound emails. Requires label owner auth.

    Set to None to revert to owner_email as reply-to.
    """
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail="Sello no encontrado.")

    if label.id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this label.")

    label.reply_to_email = body.reply_to_email
    label.updated_at = datetime.now(timezone.utc)

    session.add(label)
    session.commit()

    return EmailConfigResponse(reply_to_email=label.reply_to_email)


@router.get("/{slug}/stats", response_model=LabelStats)
async def get_label_stats(
    slug: str,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Get submission stats for a label. Requires label owner auth."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail="Sello no encontrado.")

    if label.id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this label.")

    # Count non-deleted for status breakdowns
    total_active = session.exec(
        select(Submission).where(
            Submission.label_id == label.id,
            Submission.deleted_at.is_(None)
        )
    ).all()

    inbox = len([s for s in total_active if s.status == "inbox"])
    shortlist = len([s for s in total_active if s.status in ("shortlist", "approved")])
    rejected = len([s for s in total_active if s.status == "rejected"])
    auto_rejected = len([s for s in total_active if s.status == "auto_rejected"])

    # Total tracks processed this month (including deleted — for limit enforcement)
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    monthly_total = session.exec(
        select(func.count(Submission.id)).where(
            Submission.label_id == label.id,
            Submission.created_at >= month_start,
        )
    ).one()

    return LabelStats(
        total=monthly_total,
        inbox=inbox,
        shortlist=shortlist,
        rejected=rejected,
        auto_rejected=auto_rejected,
        max_tracks_month=label.max_tracks_month,
        emails_sent_this_month=label.emails_sent_this_month,
    )


# --- Logo upload ---

LOGO_DIR = Path("/app/data/logos")
LOGO_DIR.mkdir(parents=True, exist_ok=True)
MAX_LOGO_SIZE = 5 * 1024 * 1024  # 5MB
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


class LogoUploadResponse(BaseModel):
    logo_url: str


@router.post("/{slug}/logo", response_model=LogoUploadResponse)
async def upload_label_logo(
    slug: str,
    file: UploadFile = File(...),
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Upload a logo for a label. Requires label owner auth.

    Validates image type and size, resizes to max 512x512 with Pillow,
    saves as optimized PNG, and updates the label's logo_path.
    """
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail="Sello no encontrado.")

    if label.id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this label.")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Only JPG, PNG, and WebP images are accepted.",
        )

    content = await file.read()
    if len(content) > MAX_LOGO_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_LOGO_SIZE // (1024 * 1024)}MB.",
        )

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file received.")

    # Process with Pillow if available, otherwise save raw
    try:
        from PIL import Image

        img = Image.open(BytesIO(content))
        # Convert to RGB if necessary (e.g., RGBA, P mode)
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        # Resize maintaining aspect ratio
        img.thumbnail((512, 512), Image.Resampling.LANCZOS)
        # Save as optimized PNG
        output = BytesIO()
        img.save(output, format="PNG", optimize=True)
        output.seek(0)
        processed_content = output.getvalue()
        content_type = "image/png"
    except ImportError:
        # Pillow not available — save raw file (add pillow to dependencies)
        processed_content = content
        content_type = file.content_type or "application/octet-stream"

    # Upload to Cloudflare R2
    logo_filename = f"logos/{label.id}.png"
    
    await upload_bytes_to_r2(
        data=processed_content,
        r2_key=logo_filename,
        content_type=content_type
    )

    public_url_base = os.getenv("CLOUDFLARE_R2_PUBLIC_URL", "").rstrip("/")
    if public_url_base:
        logo_url = f"{public_url_base}/{logo_filename}"
    else:
        logo_url = f"/{logo_filename}"

    # Update label
    label.logo_path = logo_url
    label.updated_at = datetime.now(timezone.utc)
    session.add(label)
    session.commit()

    return LogoUploadResponse(logo_url=logo_url)


class SubmissionTextUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    ask_instagram: bool | None = None
    ask_soundcloud: bool | None = None
    ask_spotify: bool | None = None


class SubmissionTextResponse(BaseModel):
    submission_title: str | None
    submission_description: str | None
    ask_instagram: bool
    ask_soundcloud: bool
    ask_spotify: bool


@router.put("/{slug}/submission-text", response_model=SubmissionTextResponse)
async def update_submission_text(
    slug: str,
    body: SubmissionTextUpdate,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Update the submission page title and description for a label. Requires label owner auth."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail="Sello no encontrado.")

    if label.id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this label.")

    if body.title is not None:
        label.submission_title = body.title
    if body.description is not None:
        label.submission_description = body.description
    if body.ask_instagram is not None:
        label.ask_instagram = body.ask_instagram
    if body.ask_soundcloud is not None:
        label.ask_soundcloud = body.ask_soundcloud
    if body.ask_spotify is not None:
        label.ask_spotify = body.ask_spotify
    label.updated_at = datetime.now(timezone.utc)

    session.add(label)
    session.commit()

    return SubmissionTextResponse(
        submission_title=label.submission_title,
        submission_description=label.submission_description,
        ask_instagram=label.ask_instagram,
        ask_soundcloud=label.ask_soundcloud,
        ask_spotify=label.ask_spotify,
    )


@router.patch("/{slug}/plan", response_model=LabelConfig)
async def update_label_plan(
    slug: str,
    body: PlanUpdate,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Update label plan. FOR ADMIN/TESTING PURPOSES.
    In production, this would be handled by Stripe/PayPal webhooks.
    """
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail="Sello no encontrado.")

    if label.id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied.")

    label.plan = body.plan.lower()
    _apply_plan_limits(label)  # Sync max_tracks, etc.
    label.updated_at = datetime.now(timezone.utc)

    session.add(label)
    session.commit()
    session.refresh(label)

    role = label.role if label.role != "label" else "label_owner"
    return LabelConfig(
        id=label.id,
        name=label.name,
        slug=label.slug,
        owner_email=label.owner_email,
        plan=label.plan or "free",
        subscription_status=label.subscription_status or "active",
        frozen_at=label.frozen_at.isoformat() if label.frozen_at else None,
        max_tracks_month=label.max_tracks_month,
        max_emails_month=label.max_emails_month,
        hq_retention_days=label.hq_retention_days,
        sonic_signature=label.sonic_signature,
        created_at=label.created_at.isoformat(),
        logo_path=label.logo_path,
        submission_title=label.submission_title,
        submission_description=label.submission_description,
        role=role,
    )


# --- Polar Billing & Portal ---

POLAR_ACCESS_TOKEN = os.getenv("POLAR_ACCESS_TOKEN")
POLAR_ORGANIZATION_ID = os.getenv("POLAR_ORGANIZATION_ID")

PRODUCT_TO_PLAN = {
    "400b734f-4dfd-4376-99e5-2bab977cc1fe": "indie",
    "7272cf53-e552-4d24-acbb-d455999803a1": "pro",
}

PLAN_TO_PRODUCT = {v: k for k, v in PRODUCT_TO_PLAN.items()}

class UpdateSubscriptionRequest(BaseModel):
    new_plan: str

class AdminPlanUpdateRequest(BaseModel):
    email: str
    slug: str
    plan: str
    polar_customer_id: str | None = None
    polar_subscription_id: str | None = None

@router.post("/admin/by-email/plan")
async def update_plan_admin(
    req: AdminPlanUpdateRequest,
    request: Request,
    _: None = Depends(_verify_admin_key),
    session: Session = Depends(get_session)
):
    """Internal endpoint for Vercel proxy to sync DB after Polar updates. Requires admin key."""
    label = session.exec(select(Label).where(Label.owner_email == req.email)).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
        
    label.plan = req.plan
    _apply_plan_limits(label, req.plan)
    
    if req.polar_customer_id:
        label.polar_customer_id = req.polar_customer_id
    if req.polar_subscription_id:
        label.polar_subscription_id = req.polar_subscription_id
    
    label.updated_at = datetime.now(timezone.utc)
    session.add(label)
    session.commit()
    return {"status": "ok"}

@router.get("/me/secure")
async def get_me_secure(
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Get secure label details using JWT. Used by Vercel API proxy."""
    label = session.exec(select(Label).where(Label.id == auth["label_id"])).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    
    return {
        "email": label.owner_email,
        "plan": label.plan or "free",
        "slug": label.slug,
        "name": label.name,
        "polar_customer_id": label.polar_customer_id,
        "polar_subscription_id": label.polar_subscription_id
    }


class NotificationResponse(BaseModel):
    id: str
    title: str
    message: str
    created_at: str
    read: bool


@router.get("/me/notifications", response_model=list[NotificationResponse])
async def get_me_notifications(
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Get recent notifications for the authenticated label."""
    label_id = auth["label_id"]

    # Run expiration checks so they are fresh
    from app.services.expiration import check_and_process_expirations
    await check_and_process_expirations(label_id, session)

    query = (
        select(Notification)
        .where(Notification.label_id == label_id)
        .order_by(Notification.created_at.desc())
    )
    notifications = session.exec(query).all()

    return [
        NotificationResponse(
            id=n.id,
            title=n.title,
            message=n.message,
            created_at=n.created_at.isoformat(),
            read=n.read,
        )
        for n in notifications
    ]


@router.post("/me/notifications/read")
async def mark_notifications_as_read(
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Mark all notifications for the label as read."""
    label_id = auth["label_id"]
    from sqlmodel import update

    stmt = (
        update(Notification)
        .where(Notification.label_id == label_id)
        .where(Notification.read == False)
        .values(read=True)
    )
    session.exec(stmt)
    session.commit()

    return {"status": "ok"}


@router.get("/{slug}/billing", response_model=BillingDetails)
async def get_label_billing(
    slug: str,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Get billing details for a label from Polar."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label or label.id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Forbidden")

    if not POLAR_ACCESS_TOKEN or not POLAR_ORGANIZATION_ID:
        # Fallback for local development or missing config
        return BillingDetails(
            plan=label.plan or "free",
            status="active",
            next_billing_date=None,
            amount=None,
            currency=None
        )

    headers = {"Authorization": f"Bearer {POLAR_ACCESS_TOKEN}"}
    
    try:
        async with httpx.AsyncClient() as client:
            # 1. List subscriptions for the organization
            resp = await client.get(
                "https://api.polar.sh/v1/subscriptions/",
                params={"organization_id": POLAR_ORGANIZATION_ID, "limit": 100},
                headers=headers
            )
            resp.raise_for_status()
            subs = resp.json().get("items", [])
            
            # 2. Filter by customer email (case-insensitive)
            # Polar might have customer_email or nested in customer object
            user_sub = None
            for s in subs:
                email = s.get("customer", {}).get("email") or s.get("customer_email")
                if email and email.lower() == label.owner_email.lower() and s.get("status") in ("active", "canceled", "past_due"):
                    user_sub = s
                    break
            
            if not user_sub:
                return BillingDetails(
                    plan=label.plan or "free",
                    status="free",
                    next_billing_date=None,
                    amount=None,
                    currency=None
                )
            
            # 3. Extract details
            plan_name = PRODUCT_TO_PLAN.get(user_sub.get("product_id"), "free")
            next_date = user_sub.get("current_period_end")
            price_obj = user_sub.get("price", {})
            amount = price_obj.get("price_amount")
            currency = price_obj.get("price_currency")

            return BillingDetails(
                plan=plan_name,
                status=user_sub.get("status"),
                next_billing_date=next_date,
                amount=amount,
                currency=currency,
                subscription_id=user_sub.get("id")
            )
    except Exception as e:
        # Don't crash if Polar is down
        return BillingDetails(
            plan=label.plan or "free",
            status="active",
            next_billing_date=None,
            amount=None,
            currency=None
        )


@router.get("/{slug}/hq-count", response_model=HQCountResponse)
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
    from app.models import Submission
    
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

    return HQCountResponse(
        count=count, 
        limit=label.max_tracks_month, 
        processed_count=processed,
        retention_days=label.hq_retention_days,
        max_approved=label.max_tracks_month  # Using max_tracks_month as proxy for capacity
    )


@router.api_route("/{slug}/portal", methods=["GET", "POST"], response_model=PortalResponse)
async def create_portal_session(
    slug: str,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Create a Polar Customer Portal session."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label or label.id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Forbidden")

    if not POLAR_ACCESS_TOKEN or not POLAR_ORGANIZATION_ID:
        raise HTTPException(status_code=500, detail=f"Polar configuration missing. Token: {'set' if POLAR_ACCESS_TOKEN else 'missing'}, Org: {'set' if POLAR_ORGANIZATION_ID else 'missing'}")

    headers = {"Authorization": f"Bearer {POLAR_ACCESS_TOKEN}"}
    print(f"DEBUG: Starting portal session creation for slug: {slug}, email: {label.owner_email}")
    
    try:
        async with httpx.AsyncClient() as client:
            # 1. Find or create customer by email
            print(f"DEBUG: Searching customer for {label.owner_email} in org {POLAR_ORGANIZATION_ID}")
            c_resp = await client.get(
                "https://api.polar.sh/v1/customers/",
                params={"organization_id": POLAR_ORGANIZATION_ID, "email": label.owner_email},
                headers=headers
            )
            
            if c_resp.status_code != 200:
                print(f"DEBUG: Polar search failed: {c_resp.status_code} - {c_resp.text}")
                c_resp.raise_for_status()

            customers = c_resp.json().get("items", [])
            customer_id = None
            
            if customers:
                customer_id = customers[0].get("id")
                print(f"DEBUG: Found existing customer: {customer_id}")
            else:
                print(f"DEBUG: Customer not found, creating one...")
                create_resp = await client.post(
                    "https://api.polar.sh/v1/customers/",
                    json={
                        "organization_id": POLAR_ORGANIZATION_ID, 
                        "email": label.owner_email, 
                        "name": label.name
                    },
                    headers=headers
                )
                if create_resp.status_code != 201:
                    print(f"DEBUG: Polar create failed: {create_resp.status_code} - {create_resp.text}")
                    create_resp.raise_for_status()
                
                customer_id = create_resp.json().get("id")
                print(f"DEBUG: Created new customer: {customer_id}")

            # 2. Create Portal Session
            print(f"DEBUG: Creating portal session for customer: {customer_id}")
            p_resp = await client.post(
                "https://api.polar.sh/v1/customer-sessions/",
                json={"customer_id": customer_id},
                headers=headers
            )
            
            if p_resp.status_code != 201 and p_resp.status_code != 200:
                print(f"DEBUG: Polar session creation failed: {p_resp.status_code} - {p_resp.text}")
                p_resp.raise_for_status()
            
            portal_data = p_resp.json()
            print(f"DEBUG: Polar portal response: {portal_data}")
            
            # The portal URL might be in 'customer_portal_url' or we might need to use the token
            portal_url = portal_data.get("customer_portal_url")
            if not portal_url:
                # Fallback to token-based URL if URL not directly provided
                token = portal_data.get("token") or portal_data.get("session_token")
                if token:
                    # Note: You might need the organization slug here. 
                    # If not available, we hope customer_portal_url is present.
                    portal_url = f"https://polar.sh/customer-portal/?token={token}"
                else:
                    raise HTTPException(status_code=500, detail="Could not retrieve portal URL from Polar")

            return PortalResponse(url=portal_url)
            
    except httpx.HTTPStatusError as e:
        print(f"ERROR: Polar API returned error {e.response.status_code}: {e.response.text}")
        raise HTTPException(status_code=502, detail=f"Polar API Error: {e.response.text}")
    except Exception as e:
        print(f"ERROR: Unexpected error creating portal session: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{slug}/cancel-subscription")
async def cancel_subscription(
    slug: str,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Cancel subscription immediately (revoke) via Polar API."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label or label.id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied.")

    # Need to find the active subscription ID
    async with httpx.AsyncClient(timeout=30.0) as client:
        headers = {"Authorization": f"Bearer {POLAR_ACCESS_TOKEN}"}
        
        # 1. Get Customer ID from Polar
        c_resp = await client.get(
            f"https://api.polar.sh/v1/customers/?organization_id={POLAR_ORGANIZATION_ID}&email={label.owner_email}",
            headers=headers
        )
        c_resp.raise_for_status()
        customers = c_resp.json().get("items", [])
        if not customers:
            raise HTTPException(status_code=404, detail="No Polar customer found.")
        
        customer_id = customers[0]["id"]

        # 2. Get Active Subscription
        s_resp = await client.get(
            f"https://api.polar.sh/v1/subscriptions/?organization_id={POLAR_ORGANIZATION_ID}&customer_id={customer_id}&active=true",
            headers=headers
        )
        s_resp.raise_for_status()
        subs = s_resp.json().get("items", [])
        if not subs:
            raise HTTPException(status_code=404, detail="No active subscription found.")
        
        sub_id = subs[0]["id"]

        # 3. Revoke/Cancel Subscription
        print(f"DEBUG: Cancelling Polar subscription {sub_id}")
        del_resp = await client.delete(
            f"https://api.polar.sh/v1/subscriptions/{sub_id}",
            headers=headers
        )
        
        if del_resp.status_code not in [200, 204]:
            print(f"DEBUG: Polar cancellation failed: {del_resp.status_code} - {del_resp.text}")
            del_resp.raise_for_status()

        # Update local label plan to free
        label.plan = "free"
        _apply_plan_limits(label)
        session.add(label)
        session.commit()

        return {"status": "success", "message": "Subscription cancelled successfully."}


@router.post("/{slug}/update-subscription")
async def update_subscription(
    slug: str,
    req: UpdateSubscriptionRequest,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Upgrade or downgrade subscription with proration."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label or label.id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied.")

    new_product_id = PLAN_TO_PRODUCT.get(req.new_plan.lower())
    if not new_product_id:
        raise HTTPException(status_code=400, detail=f"Invalid plan: {req.new_plan}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        headers = {"Authorization": f"Bearer {POLAR_ACCESS_TOKEN}"}
        
        # 1. Get Customer ID
        c_resp = await client.get(
            f"https://api.polar.sh/v1/customers/?organization_id={POLAR_ORGANIZATION_ID}&email={label.owner_email}",
            headers=headers
        )
        c_resp.raise_for_status()
        customers = c_resp.json().get("items", [])
        if not customers:
            raise HTTPException(status_code=404, detail="No Polar customer found.")
        
        customer_id = customers[0]["id"]

        # 2. Get Active Subscription
        s_resp = await client.get(
            f"https://api.polar.sh/v1/subscriptions/?organization_id={POLAR_ORGANIZATION_ID}&customer_id={customer_id}&active=true",
            headers=headers
        )
        s_resp.raise_for_status()
        subs = s_resp.json().get("items", [])
        
        if not subs:
            raise HTTPException(status_code=404, detail="No active subscription found to update.")
        
        sub_id = subs[0]["id"]

        # 3. Update Subscription
        print(f"DEBUG: Updating Polar subscription {sub_id} to {req.new_plan} ({new_product_id})")
        up_resp = await client.patch(
            f"https://api.polar.sh/v1/subscriptions/{sub_id}",
            json={
                "product_id": new_product_id,
                "proration_behavior": "prorate"
            },
            headers=headers
        )
        
        if up_resp.status_code not in [200, 204]:
            print(f"DEBUG: Polar update failed: {up_resp.status_code} - {up_resp.text}")
            up_resp.raise_for_status()

        # Update local label plan
        label.plan = req.new_plan.lower()
        _apply_plan_limits(label)
        session.add(label)
        session.commit()

        return {"status": "success", "message": f"Subscription updated to {req.new_plan} successfully."}


import logging
logger = logging.getLogger(__name__)

class PlanUpdateByEmail(BaseModel):
    email: str
    plan: str
    slug: str | None = None


@router.post("/admin/by-email/plan")
async def admin_update_label_plan_by_email(
    body: PlanUpdateByEmail,
    request: Request,
    _: None = Depends(_verify_admin_key),
    session: Session = Depends(get_session),
):
    """Admin endpoint to update label plan by owner email. Used by Polar webhook proxy.
    Creates the label automatically if it doesn't exist (payment-before-register flow).
    """
    logger.info(f"UPDATING PLAN: {body}")
    label = session.exec(select(Label).where(Label.owner_email == body.email)).first()

    if not label:
        # Auto-create label for payment-before-register flow
        import secrets
        from app.services.auth import get_password_hash

        plan_name = body.plan.lower()
        slug_base = body.email.split("@")[0].lower()
        slug = slug_base
        counter = 1
        while session.exec(select(Label).where(Label.slug == slug)).first():
            slug = f"{slug_base}{counter}"
            counter += 1

        random_password = secrets.token_urlsafe(32)
        sonic_signature = {
            "bpm_min": 70,
            "bpm_max": 180,
            "lufs_target": -14.0,
            "lufs_tolerance": 1.0,
            "target_camelot_keys": [],
            "auto_reject_rules": {
                "phase": True,
                "lufs": True,
                "tempo": True,
                "reject_clipping": True,
                "reject_low_dynamic_range": True,
            },
        }

        label = Label(
            name=body.email.split("@")[0],
            slug=slug,
            owner_email=body.email,
            password_hash=get_password_hash(random_password),
            sonic_signature=sonic_signature,
            plan=plan_name,
        )
        _apply_plan_limits(label, plan=plan_name)
        session.add(label)
        session.commit()
        session.refresh(label)
        sync_user_to_supabase(
            user_id=label.id,
            plan=label.plan,
            suspended=(label.subscription_status == "suspended"),
            raise_on_error=False
        )
        return {"id": label.id, "slug": label.slug, "plan": label.plan, "auto_created": True}

    label.plan = body.plan.lower()
    _apply_plan_limits(label)
    label.updated_at = datetime.now(timezone.utc)

    session.add(label)
    session.commit()
    session.refresh(label)

    sync_user_to_supabase(
        user_id=label.id,
        plan=label.plan,
        suspended=(label.subscription_status == "suspended"),
        raise_on_error=False
    )

    return {"id": label.id, "slug": label.slug, "plan": label.plan}


@router.post("/admin/{slug}/plan", response_model=LabelConfig)
async def admin_update_label_plan(
    slug: str,
    body: PlanUpdate,
    request: Request,
    _: None = Depends(_verify_admin_key),
    session: Session = Depends(get_session),
):
    """Admin endpoint to update label plan. Requires admin key."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail="Sello no encontrado.")

    label.plan = body.plan.lower()
    _apply_plan_limits(label)
    label.updated_at = datetime.now(timezone.utc)

    session.add(label)
    session.commit()
    session.refresh(label)

    sync_user_to_supabase(
        user_id=label.id,
        plan=label.plan,
        suspended=(label.subscription_status == "suspended"),
        raise_on_error=False
    )

    role = label.role if label.role != "label" else "label_owner"
    return LabelConfig(
        id=label.id,
        name=label.name,
        slug=label.slug,
        owner_email=label.owner_email,
        plan=label.plan or "free",
        subscription_status=label.subscription_status or "active",
        frozen_at=label.frozen_at.isoformat() if label.frozen_at else None,
        max_tracks_month=label.max_tracks_month,
        max_emails_month=label.max_emails_month,
        hq_retention_days=label.hq_retention_days,
        sonic_signature=label.sonic_signature,
        created_at=label.created_at.isoformat(),
        logo_path=label.logo_path,
        submission_title=label.submission_title,
        submission_description=label.submission_description,
        role=role,
    )


class RoleUpdate(BaseModel):
    role: str  # "label" | "dj"


@router.post("/webhook-debug")
async def debug_webhook_payload(
    body: dict,
    request: Request,
    _: None = Depends(_verify_admin_key),
    session: Session = Depends(get_session)
):
    """Functional webhook handler used for debugging and production sync.
    Handles both raw Polar payloads AND simplified payloads from our Next.js proxy.
    """
    event_type = body.get("type", "")
    
    # Handle simplified payload from Next.js proxy
    if "productId" in body:
        customer_email = body.get("email", "")
        product_id = body.get("productId", "")
        slug = body.get("slug", "")
        metadata = {}
    else:
        # Handle raw Polar payload
        data = body.get("data", {})
        customer_email = (data.get("customer", {}) or {}).get("email") or data.get("customer_email") or data.get("email") or ""
        product_id = (data.get("product", {}) or {}).get("id") or data.get("product_id") or ""
        metadata = data.get("metadata", {})
        if isinstance(metadata, str):
            try:
                import json
                metadata = json.loads(metadata)
            except:
                metadata = {}
        slug = metadata.get("slug") or ""
    
    # Logging for debug
    log_line = f"[{datetime.now().isoformat()}] WEBHOOK DEBUG | Type: {event_type} | Email: {customer_email} | Slug: {slug} | Product: {product_id}"
    with open("/app/data/webhook.log", "a") as f:
        f.write(log_line + "\n")
    logger.info(f"WEBHOOK-DEBUG: {log_line}")

    # 3. Find Label
    label = None
    if slug:
        label = session.exec(select(Label).where(Label.slug == slug)).first()
        logger.info(f"WEBHOOK-DEBUG: Lookup by slug='{slug}' -> {'FOUND' if label else 'NOT FOUND'}")
    
    if not label and customer_email:
        # Case-insensitive email match using func.lower for SQLite compatibility
        from sqlalchemy import func as sa_func
        label = session.exec(
            select(Label).where(sa_func.lower(Label.owner_email) == customer_email.lower().strip())
        ).first()
        logger.info(f"WEBHOOK-DEBUG: Lookup by email='{customer_email}' -> {'FOUND ' + label.slug if label else 'NOT FOUND'}")

    if not label:
        logger.warning(f"WEBHOOK-DEBUG: Label not found for email={customer_email} slug={slug}")
        with open("/app/data/webhook.log", "a") as f:
            f.write(f"  -> SKIPPED: label not found\n")
        return {"received": True, "skipped": True, "reason": "label not found"}

    # 4. Process Plan Changes
    success_events = ("subscription.created", "subscription.active", "subscription.updated", "order.created", "order.paid", "checkout.completed")
    cancel_events = ("subscription.canceled", "subscription.revoked")

    if event_type in success_events:
        plan = PRODUCT_TO_PLAN.get(product_id)
        logger.info(f"WEBHOOK-DEBUG: Success event. product_id={product_id} -> plan={plan}")
        if plan:
            old_plan = label.plan
            label.plan = plan
            _apply_plan_limits(label)
            label.updated_at = datetime.now(timezone.utc)
            session.add(label)
            session.commit()
            session.refresh(label)
            logger.info(f"WEBHOOK-DEBUG: UPGRADED {label.slug} from {old_plan} to {label.plan}")
            with open("/app/data/webhook.log", "a") as f:
                f.write(f"  -> UPGRADED: {label.slug} {old_plan} -> {label.plan}\n")
            return {"received": True, "action": "upgraded", "plan": plan, "label": label.slug}
        else:
            logger.warning(f"WEBHOOK-DEBUG: Unknown product_id={product_id}, known products: {list(PRODUCT_TO_PLAN.keys())}")
            with open("/app/data/webhook.log", "a") as f:
                f.write(f"  -> SKIPPED: unknown product_id {product_id}\n")

    elif event_type in cancel_events:
        old_plan = label.plan
        label.plan = "free"
        _apply_plan_limits(label)
        label.updated_at = datetime.now(timezone.utc)
        session.add(label)
        session.commit()
        session.refresh(label)
        logger.info(f"WEBHOOK-DEBUG: DOWNGRADED {label.slug} from {old_plan} to free")
        with open("/app/data/webhook.log", "a") as f:
            f.write(f"  -> DOWNGRADED: {label.slug} {old_plan} -> free\n")
        return {"received": True, "action": "downgraded", "plan": "free", "label": label.slug}

    with open("/app/data/webhook.log", "a") as f:
        f.write(f"  -> SKIPPED: unhandled event {event_type}\n")
    return {"received": True, "skipped": True, "reason": f"unhandled event: {event_type}"}


class RoleUpdate(BaseModel):
    role: str  # "label_owner" | "label" | "dj"


@router.post("/admin/{slug}/role")
async def admin_update_label_role(
    slug: str,
    body: RoleUpdate,
    request: Request,
    _: None = Depends(_verify_admin_key),
    session: Session = Depends(get_session),
):
    """Admin endpoint to update label role. Requires admin key."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail="Sello no encontrado.")

    if body.role.lower() not in ("label_owner", "label", "dj"):
        raise HTTPException(status_code=400, detail="Role must be 'label_owner', 'label' or 'dj'.")

    label.role = body.role.lower()
    label.updated_at = datetime.now(timezone.utc)

    session.add(label)
    session.commit()
    session.refresh(label)

    return {"id": label.id, "slug": label.slug, "role": label.role}
