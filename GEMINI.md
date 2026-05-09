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

### 4.2 Design System

- **Dark mode default** with light mode toggle
- **Colors:**
  - Dark: bg `#09090b`, surface `#111114`, accent `#10b981` (emerald), cyan `#06b6d4`, red `#ef4444`
  - Light: bg `#f5f5f4`, card `#ffffff`, border `#d6d3d1`
- **Fonts:** Space Grotesk (display), Inter (body), JetBrains Mono (mono)
- **CSS variables** for theming with `.light` class on `<html>`

### 4.3 Routes

#### Public
- `/` — Landing page (hero with demo simulation, how-it-works with step selector, features grid, pricing tiers, footer, WhatsApp bubble)
- `/s/[slug]` — Public submission page (drag-drop upload, producer info form, XHR upload with progress)
- `/pricing` — Alternate pricing page (Boutique $29, Label Pro $79 with Stripe checkout)
- `/login` — Auth login (identifier + password, sets localStorage slug/label_id/plan)
- `/register` — Auth registration (name, slug, email, password + confirm)
- `/terms-of-service`, `/privacy-policy`, `/refund-policy` — Legal pages

#### Dashboard (auth required)
- `/config` — Sonic signature config (BPM sliders, LUFS sliders, genre presets, scales, auto-reject toggles, logo upload with drag-drop)
- `/link` — Submission link management (copy URL, stats, editable title/description, preview)
- `/inbox` — Kanban board (inbox/shortlist/rejected columns, drag-and-drop, email modal, trash tab, system-filtered tab, infinite scroll)
- `/crm` — Email CRM (contact list, email composer, template selector, free plan blur lock)
- `/guide` — Step-by-step usage guide with glossary
- `/settings` — Plan management (PayPal subscription buttons, language toggle ES/EN, theme toggle, logout)

### 4.4 Key Components

- **PlayerContext** — Global audio player (HTMLAudioElement, blob-based streaming with auth, queue management, progress/volume/seek)
- **PlayerBar** — Fixed bottom bar in dashboard (prev/play/next, progress bar, volume, track info)
- **TwoClickDelete** — Confirmation-required delete button (3-second auto-cancel)
- **WhatsAppBubble** — Fixed floating WhatsApp link
- **DemoSimulation** — Animated landing page demo (cycling through mock tracks with spectrum bars, chroma grid, scan line)
- **SpectrumBars/Waveform** — Framer Motion audio visualizations
- **shadcn/ui** — Badge, Button, Card, Dialog, Input, Table, Toast

### 4.5 Internationalization (i18n)

- ES/EN bilingual via `LanguageProvider` context
- ~380+ translation keys covering all UI text
- Stored in localStorage as `lang`
- Keys organized by section: `nav.*`, `hero.*`, `how_it_works.*`, `features.*`, `pricing.*`, `inbox.*`, `crm.*`, `config.*`, `link.*`, `settings.*`, `demo.*`, `footer.*`, `whatsapp.*`

### 4.6 Auth Flow

- Login stores `slug`, `label_id`, `plan` in localStorage
- JWT stored in httpOnly cookie by backend
- Frontend sends `credentials: "include"` for cookie auth or `Authorization: Bearer {token}` header
- Token also stored in localStorage for API calls that need it

### 4.7 Payments

- **PayPal** subscriptions embedded in settings page:
  - Indie plan: `P-54C90346FG305414DNH7ILLI`
  - Pro plan: `P-7HL262224H175470NNH7IRJA`
  - Client ID: `BAAcn11PNIEN7F9LhCR70qkow9_ojjmfDUyz6U6pV8QaFIF5Mq-FWWI...`
- **LemonSqueezy** checkout link on landing page pricing
- **Stripe** checkout on `/pricing` page (calls `/api/stripe/create-checkout`)
- Plan cancellation is client-side only (sets localStorage plan to "free")

### 4.8 State Management

- **Zustand** store (`lib/store.ts`) — legacy types (not actively used in current UI)
- **PlayerContext** (`lib/PlayerContext.tsx`) — global audio player state
- **LanguageProvider** (`lib/i18n.tsx`) — i18n state
- **ThemeProvider** (`lib/theme.tsx`) — dark/light mode state
- **localStorage** — auth state (slug, label_id, plan, token, lang, theme)

### 4.9 API Client

- `lib/api.ts` — Typed API functions for upload, submissions, labels, email, login
- Uses `fetch` with `credentials: "include"` for cookie auth
- Upload uses `FormData` for multipart

---

## 5. Infrastructure

### 5.1 Docker Compose

```yaml
services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - JWT_SECRET=${JWT_SECRET:-change-me-in-production}
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-}
      - OPENROUTER_MODEL=${OPENROUTER_MODEL:-meta-llama/llama-3.1-8b-instruct:free}
      - RESEND_API_KEY=${RESEND_API_KEY:-}
      - DATA_DIR=/app/data
    volumes:
      - ./data:/app/data
    healthcheck:
      test: ["CMD", "curl", "-f", http://localhost:8000/]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    restart: unless-stopped
```

### 5.2 Deploy Script (`deploy.sh`)

```bash
#!/bin/bash
set -e
cd /home/ubuntu/truepeak
git pull || echo "⚠️  Git pull failed, continuing with local changes..."
docker compose down
docker compose build --no-cache
docker compose up -d
sleep 10
curl -f http://localhost:8000/ || exit 1
```

### 5.3 VPS Details

- **Provider:** Oracle Cloud
- **Instance:** Ampere A1 (ARM64), 4 OCPU, 24GB RAM
- **IP:** `164.152.194.196`
- **Port:** 8000 (FastAPI)
- **OS:** Ubuntu (implied by deploy.sh path `/home/ubuntu/`)

---

## 6. File Structure

```
truepeak-new/
├── .gitignore
├── vercel.json                    # Root Vercel config (builds frontend/)
├── deploy.sh                      # Backend deploy script
├── README.md
├── frontend/
│   ├── package.json
│   ├── next.config.ts             # API rewrites to VPS
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── postcss.config.mjs
│   ├── components.json            # shadcn config
│   ├── vercel.json                # Vercel rewrites
│   ├── app/
│   │   ├── layout.tsx             # Root layout (fonts, ThemeProvider, LanguageProvider)
│   │   ├── globals.css            # CSS variables, dark/light themes
│   │   ├── page.tsx               # Landing page
│   │   ├── (auth)/                # Login, register
│   │   ├── (dashboard)/           # config, link, inbox, crm, guide, settings
│   │   ├── pricing/
│   │   ├── s/[slug]/              # Public submission page
│   │   ├── terms-of-service/
│   │   ├── privacy-policy/
│   │   └── refund-policy/
│   ├── components/
│   │   ├── audio-viz/             # DemoSimulation, SpectrumBars, Waveform
│   │   ├── dashboard/             # AudioPlayer, SubmissionCard
│   │   ├── ui/                    # shadcn components
│   │   ├── TwoClickDelete.tsx
│   │   └── WhatsAppBubble.tsx
│   └── lib/
│       ├── api.ts                 # API client functions
│       ├── i18n.tsx               # LanguageProvider + translations
│       ├── PlayerContext.tsx      # Global audio player
│       ├── store.ts               # Zustand store (legacy types)
│       ├── theme.tsx              # ThemeProvider
│       └── utils.ts               # cn() utility
├── backend/
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── .env.example
│   ├── migrate_phase1.py
│   └── app/
│       ├── main.py                # FastAPI app entry point
│       ├── models.py              # SQLModel database models
│       ├── database.py            # SQLite engine + migrations
│       ├── cleanup_cron.py        # Daily cleanup job
│       ├── api/
│       │   ├── upload.py          # Audio upload endpoint
│       │   ├── submissions.py     # CRUD for submissions
│       │   ├── labels.py          # Label management + auth
│       │   ├── email.py           # Email send/generate/templates
│       │   └── health.py          # Health check
│       ├── services/
│       │   ├── auth.py            # JWT + bcrypt
│       │   ├── email_service.py   # Resend API
│       │   └── llm_email.py       # OpenRouter email generation
│       └── audio/
│           ├── analyzer.py        # BPM, LUFS, phase, key extraction
│           ├── converter.py       # FFmpeg WAV→MP3
│           ├── lifecycle.py       # Zero-storage pipeline orchestrator
│           └── exceptions.py      # Custom exceptions
└── infra/
    ├── docker-compose.yml
    └── .env
```

---

## 7. Key Technical Decisions

1. **Zero-storage audio pipeline** — Original WAV files are deleted immediately after analysis; only MP3 previews persist
2. **SQLite** — Single-file database, no separate DB server needed
3. **No session store** — JWT in httpOnly cookies, stateless auth
4. **Client-side auth state** — localStorage for slug/label_id/plan (not ideal for security but works for MVP)
5. **XHR for uploads** — Uses XMLHttpRequest for upload progress tracking instead of fetch
6. **Blob-based audio streaming** — Downloads MP3 as blob with auth, creates object URL for playback
7. **Genre presets** — 9 genre presets (Progressive House, Techno, DnB, etc.) for quick sonic signature setup
8. **Krumhansl-Schmuckler algorithm** — Musical key detection from chroma features
9. **24-hour trash window** — Soft-deleted items auto-purged by cron after 24 hours
10. **Free plan HQ limit** — Max 10 approved tracks with stored files simultaneously
11. **ARM64 memory management** — Explicit `del y, del sr, gc.collect()` in audio analyzer to prevent memory leaks on Ampere instances
12. **Idempotent SQLite migrations** — ALTER TABLE with try/except for column existence
13. **Dual auth token extraction** — Cookie, Authorization header, or X-Label-Token header
14. **Rate limiting** — slowapi on register (3/min) and login (5/min)
15. **LLM email fallback** — OpenRouter → hardcoded HTML template on failure

---

## 8. Notable Gotchas

- **Next.js API proxy limit:** Vercel serverless functions have a 10MB request body limit. Uploads >10MB must go directly to the backend API URL (bypass proxy). The frontend handles this by using `NEXT_PUBLIC_API_URL` for direct uploads.
- **Tailwind v4 migration:** `--color-background` → `--color-bg` and `--color-foreground` → `--color-text` renamed in Tailwind v4. Current project uses Tailwind v3.4.
- **useSearchParams() requires Suspense:** Any page using `useSearchParams()` must wrap the component in a `<Suspense>` boundary or Next.js build will fail.
- **i18n type safety:** All translation keys must exist in BOTH `es` and `en` dictionaries, or TypeScript build fails.
- **SQLite ALTER TABLE:** SQLite can only ADD columns, not drop or modify. New columns must be added via idempotent migration scripts.
- **CORS with credentials:** `allow_credentials=True` requires explicit origins (no `*`).
- **FFmpeg required:** Backend Docker image must include ffmpeg for MP3 conversion.
- **libsndfile1 required:** librosa needs this system package for audio file loading.
- **PayPal plan IDs:** Hardcoded in settings page. Must be updated when creating new PayPal subscription plans.
- **Email quota tracking:** `emails_sent_this_month` resets when `emails_sent_month` doesn't match current month.

---

## 9. Build & Deploy Commands

### Frontend (local dev)
```bash
cd frontend && npm install && npm run dev
```

### Frontend (build for Vercel)
```bash
cd frontend && npm run build
```

### Backend (local dev)
```bash
cd backend && pip install . && uvicorn app.main:app --reload --port 8000
```

### Backend (Docker deploy)
```bash
cd infra && docker compose down && docker compose build --no-cache && docker compose up -d
```

### Full deploy (VPS)
```bash
./deploy.sh
```

---

## 10. External Services

| Service | Purpose | Config |
|---------|---------|--------|
| Oracle Cloud | Backend hosting | 164.152.194.196, Ampere A1 ARM64 |
| Vercel | Frontend hosting | truepeak.space |
| Resend | Email delivery | noreply@truepeak.space |
| OpenRouter | LLM email generation | meta-llama/llama-3.1-8b-instruct:free |
| PayPal | Subscription payments | Client-side SDK |
| LemonSqueezy | Checkout link | truepeak.lemonsqueezy.com |
| Stripe | Alternative checkout | /api/stripe/create-checkout |
| WhatsApp | Support contact | +5491135167226 |

---

## 11. Testing

- **Backend:** pytest + pytest-asyncio configured in pyproject.toml (no tests written yet)
- **Frontend:** No test framework configured
- **Linting:** ruff configured for Python (select: E, F, I, N, W, UP, B, SIM)

---

## 12. Current State & Known Issues

- Build passes (TypeScript + Next.js static generation)
- All 15 routes generate successfully
- PayPal buttons embedded in settings page for Indie/Pro plans
- Free plan shows upgrade CTAs and PayPal buttons in features table
- CRM page has blur overlay for free plan users
- Kanban inbox with drag-and-drop, email modal, trash tab
- i18n covers all UI surfaces (ES/EN)
- Light mode toggle with CSS variables
- Global audio player with blob-based streaming
