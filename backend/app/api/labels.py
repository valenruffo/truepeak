"""Label management API — register, config, login, stats."""

from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlmodel import Session, select

from app.database import get_session
from app.models import Label, Submission
from app.services.auth import create_token, get_password_hash, verify_password, verify_token

router = APIRouter(prefix="/api", tags=["labels"])

limiter = Limiter(key_func=get_remote_address)


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


# --- Request / Response schemas ---

class RegisterRequest(BaseModel):
    owner_email: EmailStr
    password: str
    name: str
    slug: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class RegisterResponse(BaseModel):
    id: str
    name: str
    slug: str
    owner_email: str
    plan: str
    created_at: str


class LoginRequest(BaseModel):
    owner_email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginResponse(BaseModel):
    id: str
    name: str
    slug: str
    owner_email: str
    plan: str


class LabelConfig(BaseModel):
    id: str
    name: str
    slug: str
    owner_email: str
    plan: str = "free"
    sonic_signature: dict[str, Any]
    created_at: str
    logo_path: str | None = None
    submission_title: str | None = None
    submission_description: str | None = None


class SonicSignatureUpdate(BaseModel):
    sonic_signature: dict[str, Any]
    """Must include: bpm_min, bpm_max, lufs_target, lufs_tolerance, preferred_scales, auto_reject_rules"""


class LabelStats(BaseModel):
    total: int
    pending: int
    approved: int
    rejected: int


# --- Endpoints ---

@router.post("/labels/register", response_model=RegisterResponse, status_code=201)
@limiter.limit("3/minute")
async def register_label(
    request: Request,
    body: RegisterRequest,
    response: Response,
    session: Session = Depends(get_session),
):
    """Register a new label with email and password."""
    # Check slug uniqueness
    existing_slug = session.exec(select(Label).where(Label.slug == body.slug)).first()
    if existing_slug:
        raise HTTPException(status_code=409, detail=f"Slug '{body.slug}' is already taken.")

    # Check email uniqueness
    existing_email = session.exec(select(Label).where(Label.owner_email == body.owner_email)).first()
    if existing_email:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    password_hash = get_password_hash(body.password)

    sonic_signature = {
        "bpm_min": 70,
        "bpm_max": 180,
        "lufs_target": -14.0,
        "lufs_tolerance": 1.0,
        "preferred_scales": [],
        "auto_reject_rules": {},
    }

    label = Label(
        name=body.name,
        slug=body.slug,
        owner_email=body.owner_email,
        password_hash=password_hash,
        sonic_signature=sonic_signature,
    )
    session.add(label)
    session.commit()
    session.refresh(label)

    # Set JWT as HTTPOnly cookie
    token = create_token(label_id=label.id, slug=label.slug)
    response.set_cookie(
        key="token",
        value=token,
        httponly=True,
        secure=False,  # Set True in production with HTTPS
        samesite="lax",
        max_age=86400,
    )

    return RegisterResponse(
        id=label.id,
        name=label.name,
        slug=label.slug,
        owner_email=label.owner_email,
        plan=label.plan or "free",
        created_at=label.created_at.isoformat(),
    )


@router.get("/labels/{slug}", response_model=LabelConfig)
async def get_label_config(
    slug: str,
    session: Session = Depends(get_session),
):
    """Get label configuration by slug. Public endpoint for submission page."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail=f"Label '{slug}' not found.")

    return LabelConfig(
        id=label.id,
        name=label.name,
        slug=label.slug,
        owner_email=label.owner_email,
        plan=label.plan or "free",
        sonic_signature=label.sonic_signature,
        created_at=label.created_at.isoformat(),
        logo_path=label.logo_path,
        submission_title=label.submission_title,
        submission_description=label.submission_description,
    )


@router.put("/labels/{slug}/config", response_model=LabelConfig)
async def update_label_config(
    slug: str,
    body: SonicSignatureUpdate,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Update label sonic signature configuration. Requires label owner auth."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail=f"Label '{slug}' not found.")

    if label.id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this label.")

    # Validate required keys
    required_keys = {"bpm_min", "bpm_max", "lufs_target", "lufs_tolerance", "preferred_scales", "auto_reject_rules"}
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

    return LabelConfig(
        id=label.id,
        name=label.name,
        slug=label.slug,
        owner_email=label.owner_email,
        plan=label.plan or "free",
        sonic_signature=label.sonic_signature,
        created_at=label.created_at.isoformat(),
        logo_path=label.logo_path,
        submission_title=label.submission_title,
        submission_description=label.submission_description,
    )


@router.post("/labels/{slug}/login", response_model=LoginResponse)
@limiter.limit("5/minute")
async def label_login(
    slug: str,
    request: Request,
    body: LoginRequest,
    response: Response,
    session: Session = Depends(get_session),
):
    """Login with email and password. Sets JWT as HTTPOnly cookie."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail=f"Label '{slug}' not found.")

    if label.owner_email != body.owner_email:
        raise HTTPException(status_code=401, detail="Email does not match label owner.")

    if not verify_password(body.password, label.password_hash):
        raise HTTPException(status_code=401, detail="Invalid password.")

    token = create_token(label_id=label.id, slug=label.slug)

    response.set_cookie(
        key="token",
        value=token,
        httponly=True,
        secure=False,  # Set True in production with HTTPS
        samesite="lax",
        max_age=86400,
    )

    return LoginResponse(
        id=label.id,
        name=label.name,
        slug=label.slug,
        owner_email=label.owner_email,
        plan=label.plan or "free",
    )


@router.get("/labels/{slug}/stats", response_model=LabelStats)
async def get_label_stats(
    slug: str,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Get submission stats for a label. Requires label owner auth."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail=f"Label '{slug}' not found.")

    if label.id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this label.")

    total = session.exec(
        select(Submission).where(Submission.label_id == label.id)
    ).all()

    pending = len([s for s in total if s.status == "pending"])
    approved = len([s for s in total if s.status == "approved"])
    rejected = len([s for s in total if s.status == "rejected"])

    return LabelStats(
        total=len(total),
        pending=pending,
        approved=approved,
        rejected=rejected,
    )


# --- Logo upload ---

LOGO_DIR = Path("/app/data/logos")
LOGO_DIR.mkdir(parents=True, exist_ok=True)
MAX_LOGO_SIZE = 5 * 1024 * 1024  # 5MB
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


class LogoUploadResponse(BaseModel):
    logo_url: str


@router.post("/labels/{slug}/logo", response_model=LogoUploadResponse)
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
        raise HTTPException(status_code=404, detail=f"Label '{slug}' not found.")

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
    except ImportError:
        # Pillow not available — save raw file (add pillow to dependencies)
        processed_content = content

    # Save to disk
    logo_filename = f"{label.id}.png"
    logo_path = LOGO_DIR / logo_filename
    with open(logo_path, "wb") as f:
        f.write(processed_content)

    # Update label
    label.logo_path = logo_filename
    label.updated_at = datetime.now(timezone.utc)
    session.add(label)
    session.commit()

    return LogoUploadResponse(logo_url=f"/logos/{logo_filename}")


class SubmissionTextUpdate(BaseModel):
    title: str | None = None
    description: str | None = None


class SubmissionTextResponse(BaseModel):
    submission_title: str | None
    submission_description: str | None


@router.put("/labels/{slug}/submission-text", response_model=SubmissionTextResponse)
async def update_submission_text(
    slug: str,
    body: SubmissionTextUpdate,
    auth: dict = Depends(_get_label_from_token),
    session: Session = Depends(get_session),
):
    """Update the submission page title and description for a label. Requires label owner auth."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail=f"Label '{slug}' not found.")

    if label.id != auth["label_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this label.")

    if body.title is not None:
        label.submission_title = body.title
    if body.description is not None:
        label.submission_description = body.description
    label.updated_at = datetime.now(timezone.utc)

    session.add(label)
    session.commit()

    return SubmissionTextResponse(
        submission_title=label.submission_title,
        submission_description=label.submission_description,
    )
