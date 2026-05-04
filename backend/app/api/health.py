"""Health check endpoint for infrastructure monitoring."""

import shutil

from fastapi import APIRouter

from app.database import engine

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
async def health_check() -> dict:
    """Return service health status including database and ffmpeg availability."""
    # Check database connectivity
    db_status = "connected"
    try:
        with engine.connect() as conn:
            from sqlalchemy import text
            conn.execute(text("SELECT 1"))
    except Exception:
        db_status = "disconnected"

    # Check ffmpeg availability
    ffmpeg_status = "available" if shutil.which("ffmpeg") else "missing"

    return {
        "status": "ok",
        "database": db_status,
        "ffmpeg": ffmpeg_status,
    }
