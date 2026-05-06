"""True Peak AI — FastAPI application entry point."""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan: initialize database on startup."""
    init_db()
    yield


app = FastAPI(
    title="True Peak AI",
    description="AI-powered audio mastering submission and review system",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware — allow all origins in dev; restrict in production
ALLOWED_ORIGINS = ["*"]  # TODO: restrict to specific origins in production

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root() -> dict[str, str]:
    """Health check endpoint."""
    return {"service": "truepeak-ai", "status": "ok"}


# Phase 2: Audio upload router
from app.api.upload import router as upload_router

app.include_router(upload_router)

# Phase 3: Business API routers
from app.api.submissions import router as submissions_router
from app.api.labels import router as labels_router
from app.api.email import router as email_router

app.include_router(submissions_router)
app.include_router(labels_router)
app.include_router(email_router)

# Phase 6: Health check router
from app.api.health import router as health_router

app.include_router(health_router)

# Serve label logos
LOGOS_DIR = Path("/app/data/logos")
LOGOS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/logos", StaticFiles(directory=str(LOGOS_DIR)), name="logos")

# Serve approved MP3 files
MP3S_DIR = Path("/app/data/mp3s")
MP3S_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/mp3s", StaticFiles(directory=str(MP3S_DIR)), name="mp3s")
