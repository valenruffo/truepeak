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
from app.models import WaitlistEntry, AppConfig

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
