import csv
from datetime import datetime, UTC
import io
import os
from typing import Generator

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlmodel import Session, select, func

from app.database import get_session
from app.models import WaitlistEntry, AppConfig, Label
from app.api.labels import _apply_plan_limits
from app.services.auth import sync_user_to_supabase

router = APIRouter(tags=["waitlist"])
limiter = Limiter(key_func=get_remote_address)

# Request Models
class WaitlistSubmit(BaseModel):
    email: EmailStr
    company: str | None = None  # Honeypot field

class AppModeUpdate(BaseModel):
    mode: str  # "beta" | "prod"

# Dependency: verify admin password
def verify_admin_password(x_admin_password: str | None = Header(default=None, alias="X-Admin-Password")):
    admin_password = os.getenv("ADMIN_PASSWORD")
    if not admin_password:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ADMIN_PASSWORD environment variable not set on server"
        )
    if not x_admin_password or x_admin_password != admin_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized"
        )

# Public Mode Check
@router.get("/api/config/app-mode")
def get_app_mode(session: Session = Depends(get_session)):
    # 1. Check DB config
    db_config = session.exec(select(AppConfig).where(AppConfig.key == "app_mode")).first()
    if db_config:
        return {"mode": db_config.value}
    
    # 2. Check env var fallback
    env_mode = os.getenv("NEXT_PUBLIC_APP_MODE") or os.getenv("APP_MODE")
    if env_mode in ("beta", "prod"):
        return {"mode": env_mode}
        
    # 3. Default fallback
    return {"mode": "beta"}

# Admin Set Mode
@router.put("/api/config/app-mode")
def set_app_mode(
    req: AppModeUpdate,
    session: Session = Depends(get_session),
    _ = Depends(verify_admin_password)
):
    if req.mode not in ("beta", "prod"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid mode. Must be 'beta' or 'prod'."
        )
        
    db_config = session.exec(select(AppConfig).where(AppConfig.key == "app_mode")).first()
    if db_config:
        db_config.value = req.mode
    else:
        db_config = AppConfig(key="app_mode", value=req.mode)
        
    session.add(db_config)
    session.commit()
    return {"status": "ok", "mode": req.mode}

# Public Waitlist Join (Rate limited)
@router.post("/api/waitlist")
@limiter.limit("5/minute")
def join_waitlist(
    request: Request, # required for slowapi
    req: WaitlistSubmit,
    session: Session = Depends(get_session)
):
    # Honeypot: if company field is non-empty, ignore but return 200 OK (bot prevention)
    if req.company and req.company.strip():
        return {"status": "ok"}
        
    # Check if duplicate email already exists
    existing = session.exec(select(WaitlistEntry).where(WaitlistEntry.email == req.email)).first()
    if existing:
        return {"status": "ok"}
        
    entry = WaitlistEntry(email=req.email, source="landing")
    session.add(entry)
    session.commit()
    return {"status": "ok"}

# Admin List Waitlist (Paginated)
@router.get("/api/admin/waitlist")
def get_waitlist(
    page: int = 1,
    per_page: int = 20,
    session: Session = Depends(get_session),
    _ = Depends(verify_admin_password)
):
    # Calculate offset
    offset = (page - 1) * per_page
    
    # Query list ordered by created_at DESC
    entries = session.exec(
        select(WaitlistEntry)
        .order_by(WaitlistEntry.created_at.desc())
        .offset(offset)
        .limit(per_page)
    ).all()
    
    # Query total count
    total = session.exec(select(func.count(WaitlistEntry.id))).one()
    
    return {
        "total": total,
        "entries": entries
    }

# Admin Export Waitlist CSV
@router.get("/api/admin/waitlist/export")
def export_waitlist_csv(
    session: Session = Depends(get_session),
    _ = Depends(verify_admin_password)
):
    entries = session.exec(
        select(WaitlistEntry)
        .order_by(WaitlistEntry.created_at.desc())
    ).all()
    
    # Generate CSV in memory
    def generate_csv():
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Write header
        writer.writerow(["email", "created_at"])
        
        for entry in entries:
            # Format datetime
            created_str = entry.created_at.strftime("%Y-%m-%d %H:%M:%S")
            writer.writerow([entry.email, created_str])
            
        output.seek(0)
        yield output.getvalue()
        
    # Starlette/FastAPI will automatically add charset=utf-8 for text/csv
    response = StreamingResponse(
        generate_csv(),
        media_type="text/csv"
    )
    response.headers["Content-Disposition"] = "attachment; filename=waitlist.csv"
    return response


# --- Admin User Management Endpoints ---

class AdminUserResponse(BaseModel):
    id: str
    name: str
    slug: str
    email: str
    plan: str
    status: str
    created_at: datetime
    track_limit: int
    email_limit: int
    hq_retention_days: int
    role: str


class UserStatusUpdate(BaseModel):
    plan: str | None = None
    subscription_status: str | None = None


@router.get("/api/admin/users", response_model=list[AdminUserResponse])
def get_admin_users(
    session: Session = Depends(get_session),
    _ = Depends(verify_admin_password)
):
    """Retrieve all user record labels ordered by creation date."""
    labels = session.exec(
        select(Label).order_by(Label.created_at.desc())
    ).all()
    
    return [
        AdminUserResponse(
            id=label.id,
            name=label.name,
            slug=label.slug,
            email=label.owner_email,
            plan=label.plan or "free",
            status=label.subscription_status or "active",
            created_at=label.created_at,
            track_limit=label.max_tracks_month,
            email_limit=label.max_emails_month,
            hq_retention_days=label.hq_retention_days,
            role=label.role or "label_owner"
        )
        for label in labels
    ]


@router.put("/api/admin/users/{user_id}/status")
def update_user_status(
    user_id: str,
    req: UserStatusUpdate,
    session: Session = Depends(get_session),
    _ = Depends(verify_admin_password)
):
    """Update a user label's plan and/or subscription status and apply relevant limits."""
    label = session.exec(select(Label).where(Label.id == user_id)).first()
    if not label:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    plan_changed = False
    status_changed = False
    
    if req.plan is not None:
        plan_lower = req.plan.lower()
        if plan_lower not in ("free", "indie", "pro"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid plan. Must be 'free', 'indie', or 'pro'."
            )
        if label.plan != plan_lower:
            label.plan = plan_lower
            _apply_plan_limits(label, plan_lower)
            plan_changed = True
        
    if req.subscription_status is not None:
        status_lower = req.subscription_status.lower()
        if status_lower not in ("active", "frozen", "canceled", "suspended"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid subscription status. Must be 'active', 'frozen', 'canceled', or 'suspended'."
            )
        if label.subscription_status != status_lower:
            label.subscription_status = status_lower
            status_changed = True
            if status_lower == "active":
                label.frozen_at = None
            elif status_lower in ("frozen", "suspended"):
                label.frozen_at = datetime.now(UTC)
            
    if plan_changed or status_changed:
        try:
            sync_user_to_supabase(
                user_id=label.id,
                plan=label.plan,
                suspended=(label.subscription_status == "suspended"),
                raise_on_error=True
            )
        except Exception as e:
            session.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Supabase synchronization failed: {str(e)}"
            )

    label.updated_at = datetime.now(UTC)
    session.add(label)
    session.commit()
    session.refresh(label)
    
    return {
        "id": label.id,
        "plan": label.plan,
        "subscription_status": label.subscription_status,
        "frozen_at": label.frozen_at.isoformat() if label.frozen_at else None,
        "track_limit": label.max_tracks_month,
        "email_limit": label.max_emails_month,
        "hq_retention_days": label.hq_retention_days,
    }
