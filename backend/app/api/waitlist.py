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
from app.models import WaitlistEntry, AppConfig, Label, Submission
from app.api.labels import _apply_plan_limits
from app.services.auth import sync_plan_to_supabase

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
    total_submissions: int = 0
    last_submission_at: datetime | None = None


class UserStatusUpdate(BaseModel):
    plan: str | None = None
    subscription_status: str | None = None


@router.get("/api/admin/users", response_model=list[AdminUserResponse])
def get_admin_users(
    session: Session = Depends(get_session),
    _ = Depends(verify_admin_password)
):
    """Retrieve all user record labels ordered by creation date.

    Each row is enriched with the submission count and most recent submission
    timestamp via a single grouped query (no N+1).
    """
    labels = session.exec(
        select(Label).order_by(Label.created_at.desc())
    ).all()

    # Aggregate submission counts and last timestamps in a single query.
    rows = session.exec(
        select(
            Submission.label_id,
            func.count(Submission.id),
            func.max(Submission.created_at),
        ).group_by(Submission.label_id)
    ).all()

    activity_by_label: dict[str, tuple[int, datetime | None]] = {
        label_id: (int(count or 0), last_at)
        for label_id, count, last_at in rows
    }

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
            role=label.role or "label_owner",
            total_submissions=activity_by_label.get(label.id, (0, None))[0],
            last_submission_at=activity_by_label.get(label.id, (0, None))[1],
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
    """Update a user label's plan and/or subscription status and apply relevant limits.

    On success, propagates the change to Supabase Auth user_metadata. The label-table
    update is authoritative; if the Supabase sync fails, the endpoint returns
    ``supabase_sync_ok=False`` so the dashboard can flag the partial success without
    rolling back the local change.
    """
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

    label.updated_at = datetime.now(UTC)
    session.add(label)
    session.commit()
    session.refresh(label)

    supabase_sync_ok = True
    if plan_changed or status_changed:
        # Propagate to Supabase Auth. Failures are logged inside the helper and
        # surfaced via supabase_sync_ok=False — the local label update stands.
        supabase_sync_ok = sync_plan_to_supabase(
            user_id=label.id,
            plan=label.plan or "free",
            subscription_status=label.subscription_status or "active",
            max_tracks_month=label.max_tracks_month,
        )

    return {
        "id": label.id,
        "plan": label.plan,
        "subscription_status": label.subscription_status,
        "frozen_at": label.frozen_at.isoformat() if label.frozen_at else None,
        "track_limit": label.max_tracks_month,
        "email_limit": label.max_emails_month,
        "hq_retention_days": label.hq_retention_days,
        "supabase_sync_ok": supabase_sync_ok,
    }


# --- Admin Activity Endpoints ---


@router.get("/api/admin/activity")
def get_admin_activity(
    label_id: str,
    session: Session = Depends(get_session),
    _ = Depends(verify_admin_password),
):
    """Aggregated activity metrics for a single label (admin only)."""
    label = session.exec(select(Label).where(Label.id == label_id)).first()
    if not label:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Label not found"
        )

    total_submissions = session.exec(
        select(func.count(Submission.id)).where(Submission.label_id == label_id)
    ).one()
    last_at = session.exec(
        select(func.max(Submission.created_at)).where(Submission.label_id == label_id)
    ).one()

    return {
        "total_submissions": int(total_submissions or 0),
        "last_submission_at": last_at.isoformat() if last_at else None,
        "emails_sent_this_month": int(label.emails_sent_this_month or 0),
        "max_emails_month": int(label.max_emails_month or 0),
    }


@router.get("/api/admin/recent-activity")
def get_admin_recent_activity(
    page: int = 1,
    per_page: int = 20,
    session: Session = Depends(get_session),
    _ = Depends(verify_admin_password),
):
    """Paginated recent submissions across all labels, newest first (admin only)."""
    page = max(1, page)
    per_page = max(1, min(per_page, 100))
    offset = (page - 1) * per_page

    total = session.exec(select(func.count(Submission.id))).one()
    rows = session.exec(
        select(Submission)
        .order_by(Submission.created_at.desc())
        .offset(offset)
        .limit(per_page)
    ).all()

    entries = [
        {
            "id": row.id,
            "label_id": row.label_id,
            "producer_name": row.producer_name,
            "track_title": row.track_name,
            "status": row.status,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]

    return {
        "total": int(total or 0),
        "page": page,
        "per_page": per_page,
        "entries": entries,
    }
