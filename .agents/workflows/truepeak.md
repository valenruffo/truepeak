---
description: true peak, app para sellos discograficos para filtrar temaws que no coinciden con sus firmas sonicas bases y evitar escuchar basura.
---

# True Peak AI — Project Context for Gemini

> **Domain:** `truepeak.space`  
> **Repo:** `https://github.com/valenruffo/truepeak`  
> **Backend VPS:** Oracle Cloud ARM64 (Ampere A1, 4 OCPU, 24GB RAM) at `164.152.194.196:8000`  
> **Frontend:** Vercel (root `vercel.json` builds `frontend/`)  
> **WhatsApp:** `+5491135167226`

---

## 1. Project Overview

**True Peak AI** is a B2B SaaS that automates demo filtering for electronic music labels via audio analysis. Label owners configure "sonic signatures" (BPM range, LUFS target, phase correlation, musical key) and the system auto-evaluates every incoming WAV/FLAC/AIFF submission. Producers upload through anonymous public links — no account required.

**Core value proposition:** Labels stop wasting time listening to demos that don't match their technical requirements. The system auto-rejects tracks that fail sonic signature checks and presents only compliant demos in a Kanban inbox.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│                    VERCEL (Frontend)                 │
│  Next.js 16 App Router → /api/:path* rewrite ──────┐│
│  https://truepeak.space                             ││
└─────────────────────────────────────────────────────┘│
                                                       │ rewrites
                                                       ▼
┌───────────────────────────────────────────────────────────────┐
│              ORACLE CLOUD VPS (Backend)                       │
│  FastAPI + Uvicorn on 164.152.194.196:8000                    │
│  Docker container: python:3.12-slim + ffmpeg + cron           │
│  SQLite DB: /app/data/database.db                             │
│  Files: /app/data/mp3s/ | /app/data/originals/ | /app/data/logos/ │
└───────────────────────────────────────────────────────────────┘
```

### 2.1 Deployment

- **Frontend:** Vercel auto-deploys from `main` branch. Build: `cd frontend && npm run build`
- **Backend:** Docker container on Oracle Cloud VPS. Deploy via `deploy.sh` (git pull → docker compose down → build --no-cache → up -d → health check)
- **CORS origins:** `https://www.truepeak.space`, `https://truepeak.space`, `http://localhost:3000`

### 2.2 API Proxy / Rewrites

Both `next.config.ts` and `frontend/vercel.json` configure:
```
/api/:path* → http://164.152.194.196:8000/api/:path*
```

### 2.3 Root `vercel.json`
```json
{
  "buildCommand": "cd frontend && npm run build",
  "outputDirectory": "frontend/.next",
  "devCommand": "cd frontend && npm run dev",
  "installCommand": "cd frontend && npm install"
}
```

---

## 3. Backend (Python/FastAPI)

### 3.1 Stack

| Component | Version |
|-----------|---------|
| Python | 3.12 |
| FastAPI | 0.115+ |
| SQLModel | 0.0.22 (SQLite ORM) |
| librosa | 0.10.2 (audio analysis) |
| pyloudnorm | 0.1.1 (LUFS measurement) |
| scipy | 1.14 |
| numpy | 2.1 |
| PyJWT | 2.9 |
| python-jose | 3.3 |
| bcrypt | 4.0 |
| slowapi | 0.1.9 (rate limiting) |
| librosa | 0.10.2 |
| Pillow | 10.0 (image processing) |
| resend | 2.0 (email) |
| openai | 1.51 (OpenRouter LLM) |
| httpx | 0.27 |

### 3.2 Database Models (SQLModel/SQLite)

#### Label
```
id: str (UUID PK)
name: str
slug: str (unique, indexed)
owner_email: str (unique, indexed)
password_hash: str (bcrypt)
sonic_signature: JSON {bpm_min, bpm_max, lufs_target, lufs_tolerance, preferred_scales, auto_reject_rules}
plan: str ("free"|"indie"|"pro")
max_tracks_month: int (default 10)
max_emails_month: int (default 0)
hq_retention_days: int (default 0)
emails_sent_this_month: int (default 0)
emails_sent_month: int (default 1)
logo_path: str | None
submission_title: str | None
submission_description: str | None
created_at: datetime
updated_at: datetime
```

#### Submission
```
id: str (UUID PK)
label_id: str (FK -> label.id, indexed)
producer_name: str
producer_email: str
track_name: str
bpm: float | None
lufs: float | None
duration: float | None
phase_correlation: float | None
musical_key: str | None
status: str ("inbox"|"shortlist"|"rejected"|"auto_rejected", indexed)
deleted_at: datetime | None (soft delete)
human_email_sent: bool (default False)
rejection_reason: str | None
mp3_path: str | None
original_path: str | None (WAV/FLAC/AIFF for HQ download)
notes: str | None
created_at: datetime
```

#### EmailTemplate
```
id: str (UUID PK)
label_id: str (FK -> label.id, indexed)
name: str
template_type: str ("rejection"|"approval"|"followup", indexed)
subject_template: str
body_template: str
```

#### EmailLog
```
id: str (UUID PK)
submission_id: str (FK -> submission.id, indexed)
template_id: str | None (FK -> email_template.id, nullable)
sent_at: datetime
status: str ("sent"|"failed")
error: str | None
```

### 3.3 Database Migrations

SQLite doesn't support ALTER TABLE ADD COLUMN IF NOT EXISTS, so migrations are applied idempotently in `database.py`:
```python
migrations = [
    "ALTER TABLE submission ADD COLUMN notes TEXT",
    "ALTER TABLE label ADD COLUMN submission_title TEXT",
    "ALTER TABLE label ADD COLUMN submission_description TEXT",
    "ALTER TABLE label ADD COLUMN max_tracks_month INTEGER DEFAULT 10",
    "ALTER TABLE label ADD COLUMN max_emails_month INTEGER DEFAULT 0",
    "ALTER TABLE label ADD COLUMN hq_retention_days INTEGER DEFAULT 0",
    "ALTER TABLE label ADD COLUMN emails_sent_this_month INTEGER DEFAULT 0",
    "ALTER TABLE label ADD COLUMN emails_sent_month INTEGER DEFAULT 1",
    "ALTER TABLE submission ADD COLUMN deleted_at DATETIME",
    "ALTER TABLE submission ADD COLUMN human_email_sent BOOLEAN DEFAULT 0",
]
```

### 3.4 API Endpoints

#### Upload
- **POST /api/upload** — Accepts multipart form: `file`, `label_slug`, `producer_name`, `producer_email`, `track_name`, `notes`. Validates WAV/FLAC/AIFF only, max 100MB. Checks free plan limit (10 tracks/month), HQ storage limit (10 approved tracks). Runs audio lifecycle pipeline. Returns `{submission_id, status, metrics, rejection_reason, mp3_path, has_original}`.

#### Labels
- **POST /api/labels/register** — Register new label (rate limited 3/min). Requires `owner_email`, `password` (min 8 chars), `name`, `slug`.
- **POST /api/labels/login** — Login by identifier (email/name/slug) + password. Rate limited 5/min. Sets JWT as httpOnly cookie.
- **POST /api/labels/{slug}/login** — Legacy login by slug + email + password. Rate limited 5/min.
- **POST /api/labels/logout** — Clear auth cookie.
- **GET /api/labels/{slug}** — Public label config (for submission page).
- **PUT /api/labels/{slug}/config** — Update sonic signature (auth required).
- **GET /api/labels/{slug}/stats** — Submission stats by status (auth required).
- **POST /api/labels/{slug}/logo** — Upload label logo (Pillow resize to 512x512 PNG, max 5MB, JPG/PNG/WebP).
- **PUT /api/labels/{slug}/submission-text** — Update submission page title/description (auth required).
- **GET /api/labels/{slug}/hq-count** — HQ storage count (auth required).

#### Submissions
- **GET /api/submissions** — List with filters (status, offset, limit, include_deleted). Auth required.
- **GET /api/submissions/{id}** — Single submission detail. Auth required.
- **PATCH /api/submissions/{id}/status** — Update status (shortlist/rejected/approved). Auth required.
- **DELETE /api/submissions/{id}** — Soft delete (sets deleted_at). Auth required.
- **PATCH /api/submissions/{id}/restore** — Restore within 24h window. Auth required.
- **DELETE /api/submissions/{id}/file** — Delete MP3 file only (frees HQ storage). Auth required.
- **GET /api/submissions/{id}/download** — Download original or MP3. Auth required.

#### Email
- **POST /api/email/send** — Send via Resend API, with quota tracking. Auth required.
- **POST /api/email/generate** — LLM-generated email draft (OpenRouter), fallback to template. Auth required.
- **GET /api/email/templates** — List templates for label. Auth required.
- **POST /api/email/templates** — Create/update template (upsert by name). Auth required.

#### Health
- **GET /api/health** — Returns `{status, database, ffmpeg}`.

### 3.5 Audio Pipeline (Zero-Storage Lifecycle)

Located in `backend/app/audio/`:

1. **Analyzer** (`analyzer.py`): Extracts BPM (librosa beat tracking), LUFS (pyloudnorm integrated loudness), phase correlation (stereo cross-correlation), musical key (Krumhansl-Schmuckler chroma algorithm), duration. Runs in thread pool via `asyncio.to_thread`. Explicitly `del y, del sr, gc.collect()` for ARM64 memory management.

2. **Converter** (`converter.py`): FFmpeg WAV→MP3 at 320kbps, strips metadata, 30s timeout.

3. **Lifecycle** (`lifecycle.py`): Orchestrates analyze → compare sonic signature → convert/delete → cleanup. Auto-reject rules: inverted phase, excessive loudness, out of tempo, wrong musical key. **Always** deletes temp WAV file in `finally` block.

4. **Exceptions**: `AudioAnalysisError`, `ConversionError`, `FileCleanupError`.

### 3.6 Services

- **Auth** (`auth.py`): bcrypt password hashing, JWT tokens (HS256, 24h expiry). Token stored in httpOnly cookie. JWT_SECRET from env var.
- **Email Service** (`email_service.py`): Resend API integration, sends from `noreply@truepeak.space` with reply-to to label owner.
- **LLM Email** (`llm_email.py`): OpenRouter with `meta-llama/llama-3.1-8b-instruct:free`. Generates personalized rejection/approval emails with technical metrics. Falls back to hardcoded HTML templates on failure.

### 3.7 Cleanup Cron (`cleanup_cron.py`)

Runs daily at 3 AM UTC:
1. Hard deletes submissions with `deleted_at > 24h` (removes files + DB records)
2. Cleans HQ original files past label's `hq_retention_days` (keeps MP3)

### 3.8 Plan Limits

| Plan | Tracks/month | Emails/month | HQ Retention |
|------|-------------|--------------|--------------|
| Free | 10 | 0 | 0 days |
| Indie | 100 | 100 | 7 days |
| Pro | 1000 | 500 | 14 days |

### 3.9 Environment Variables

```
JWT_SECRET=your-secret-key-here
OPENROUTER_API_KEY=sk-or-v1-xxx
OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct:free
RESEND_API_KEY=re_xxx
DATA_DIR=./data
```

### 3.10 Docker

```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 curl cron
# Cron: daily cleanup at 3 AM UTC
RUN echo "0 3 * * * cd /app && python -m app.cleanup_cron >> /var/log/cleanup.log 2>&1" > /etc/cron.d/truepeak-cleanup
WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir .
COPY app/ ./app/
RUN mkdir -p /app/data/mp3s
EXPOSE 8000
CMD cron && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 3.11 Data Persistence

- `/app/data/database.db` — SQLite database
- `/app/data/mp3s/` — 320kbps MP3 previews
- `/app/data/originals/` — Original WAV/FLAC/AIFF files (for HQ download)
- `/app/data/logos/` — Label logo images (512x512 PNG)

---

## 4. Frontend (Next.js 16)

### 4.1 Stack

| Component | Version |
|-----------|---------|
| Next.js | 16.2.4 (App Router, Turbopack) |
| React | 19 |
| TypeScript | 5.8 |
| Tailwind CSS | 3.4.17 |
| shadcn/ui | New York style, zinc base |
| Zustand | 5.0 (state management) |
| Framer Motion | 12.0 (animations) |
| Lucide React | 0.500 (icons) |
| @hello-pangea/dnd | 18.0 (kanban drag-and-drop) |
| Stripe JS | 9.4 |
| Stripe SDK | 22.1 |
| PayPal SDK | client-side embedded |

### 4.3 Routes

#### Public
- `/` — Landing page (hero with demo simulation, how-it-works with step selector, features grid, pricing tiers, footer, WhatsApp bubble)
- `/s/[slug]` — Public submission page (drag-drop upload, producer info form, XHR upload with progress)
- `/pricing` — Alternate pricing page (Boutique $29, Label Pro $79 with Stripe checkout)
- `/login` — Auth login (identi