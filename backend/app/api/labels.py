"""Label management API — create, config, login, stats."""

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models import Label, Submission
from app.services.auth import create_token, verify_token
from fastapi import Header

router = APIRouter(prefix="/api", tags=["labels"])


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


# --- Request / Response schemas ---

class CreateLabelRequest(BaseModel):
    name: str
    slug: str
    owner_email: str
    sonic_signature: dict[str, Any] | None = None


class CreateLabelResponse(BaseModel):
    id: str
    name: str
    slug: str
    owner_email: str
    created_at: str


class LabelConfig(BaseModel):
    id: str
    name: str
    slug: str
    owner_email: str
    sonic_signature: dict[str, Any]
    created_at: str


class SonicSignatureUpdate(BaseModel):
    sonic_signature: dict[str, Any]
    """Must include: bpm_min, bpm_max, lufs_target, lufs_tolerance, preferred_scales, auto_reject_rules"""


class LoginRequest(BaseModel):
    owner_email: str


class LoginResponse(BaseModel):
    token: str
    label_id: str
    slug: str


class LabelStats(BaseModel):
    total: int
    pending: int
    approved: int
    rejected: int


# --- Endpoints ---

@router.post("/labels", response_model=CreateLabelResponse)
async def create_label(
    body: CreateLabelRequest,
    session: Session = Depends(get_session),
):
    """Create a new label. No auth required for initial creation."""
    # Check slug uniqueness
    existing = session.exec(select(Label).where(Label.slug == body.slug)).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Slug '{body.slug}' is already taken.")

    sonic_signature = body.sonic_signature or {
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
        sonic_signature=sonic_signature,
    )
    session.add(label)
    session.commit()
    session.refresh(label)

    return CreateLabelResponse(
        id=label.id,
        name=label.name,
        slug=label.slug,
        owner_email=label.owner_email,
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
        sonic_signature=label.sonic_signature,
        created_at=label.created_at.isoformat(),
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
        sonic_signature=label.sonic_signature,
        created_at=label.created_at.isoformat(),
    )


@router.post("/labels/{slug}/login", response_model=LoginResponse)
async def label_login(
    slug: str,
    body: LoginRequest,
    session: Session = Depends(get_session),
):
    """Simple login: verify owner_email matches label, return JWT token."""
    label = session.exec(select(Label).where(Label.slug == slug)).first()
    if not label:
        raise HTTPException(status_code=404, detail=f"Label '{slug}' not found.")

    if label.owner_email != body.owner_email:
        raise HTTPException(status_code=401, detail="Email does not match label owner.")

    token = create_token(label_id=label.id, slug=label.slug)

    return LoginResponse(
        token=token,
        label_id=label.id,
        slug=label.slug,
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


