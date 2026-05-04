# True Peak AI

> B2B SaaS that automates demo filtering for electronic music labels via audio analysis.

Label owners configure **sonic signatures** (BPM range, LUFS target, phase correlation, musical key) and the system auto-evaluates every incoming WAV submission. Producers upload through anonymous public links — no account required.

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Python 3.12, FastAPI, SQLModel (SQLite), librosa, pyloudnorm, scipy, ffmpeg |
| **Frontend** | Next.js 16 (App Router), React 19, Tailwind CSS v4, shadcn/ui, Zustand, framer-motion |
| **Infrastructure** | Docker Compose, Oracle Cloud ARM64 |
| **Email** | Resend API + OpenAI/Gemini for LLM-assisted drafts |
| **Auth** | JWT in httpOnly cookies |

## Quick Start

```bash
# Clone and start everything
git clone <repo-url> && cd truepeak
cp backend/.env.example backend/.env  # edit with your keys
cp frontend/.env.example frontend/.env
docker compose -f infra/docker-compose.yml up -d
```

- Backend: http://localhost:8000
- Frontend: http://localhost:3000
- Health check: http://localhost:8000/api/health

## Local Development

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | Secret key for JWT token signing |
| `OPENAI_API_KEY` | No | For LLM-assisted email drafts |
| `RESEND_API_KEY` | No | For sending emails to producers |
| `DATA_DIR` | No | Path for database and MP3 storage (default: `./data`) |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | Backend URL (e.g., `http://localhost:8000`) |

## Project Structure

```
truepeak/
├── backend/
│   ├── app/
│   │   ├── api/           # Route handlers (upload, submissions, labels, email, health)
│   │   ├── audio/         # Audio engine (analyzer, converter, lifecycle)
│   │   ├── services/      # Business logic (auth, llm_email, email_service)
│   │   ├── main.py        # FastAPI app factory
│   │   ├── models.py      # SQLModel entities
│   │   └── database.py    # SQLite engine + session
│   ├── pyproject.toml     # Python dependencies
│   └── Dockerfile
├── frontend/
│   ├── app/
│   │   ├── (dashboard)/   # Authenticated routes (config, inbox, crm, link)
│   │   ├── s/[slug]/      # Public submission page
│   │   ├── layout.tsx     # Root layout
│   │   └── page.tsx       # Landing page
│   ├── components/
│   │   ├── ui/            # shadcn/ui primitives
│   │   ├── audio-viz/     # Spectrum bars, waveform, demo simulation
│   │   └── dashboard/     # Dashboard-specific components
│   ├── lib/               # API client, Zustand store, utilities
│   └── Dockerfile
├── infra/
│   └── docker-compose.yml # Oracle Cloud ARM deployment
└── README.md
```

## API Documentation

Once running, visit http://localhost:8000/docs for the interactive OpenAPI documentation.

### Key Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/health` | No | Health check (DB + ffmpeg status) |
| `POST` | `/api/upload` | No | Upload WAV for analysis |
| `GET` | `/api/submissions` | Yes | List submissions (filterable by status) |
| `PATCH` | `/api/submissions/{id}/status` | Yes | Approve/reject a submission |
| `GET` | `/api/labels/{slug}/config` | Yes | Get sonic signature config |
| `PUT` | `/api/labels/{slug}/config` | Yes | Update sonic signature config |
| `POST` | `/api/email/generate` | Yes | Generate LLM-assisted email draft |
| `POST` | `/api/email/send` | Yes | Send email via Resend API |
| `GET` | `/` | No | Root health check |

## Deployment (Oracle Cloud ARM)

### Prerequisites

- Oracle Cloud Always Free ARM instance (Ampere A1, 4 OCPU, 24GB RAM)
- Docker + Docker Compose installed
- Domain name (optional, for HTTPS)

### Steps

1. **Clone the repo** on the instance:
   ```bash
   git clone <repo-url> && cd truepeak
   ```

2. **Configure environment**:
   ```bash
   cp backend/.env.example backend/.env
   # Edit backend/.env with production values:
   #   JWT_SECRET=<strong-random-secret>
   #   OPENAI_API_KEY=<your-key>
   #   RESEND_API_KEY=<your-key>
   ```

3. **Start services**:
   ```bash
   docker compose -f infra/docker-compose.yml up -d --build
   ```

4. **Verify health**:
   ```bash
   curl http://localhost:8000/api/health
   # Expected: {"status":"ok","database":"connected","ffmpeg":"available"}
   ```

5. **(Optional) Add reverse proxy** with Caddy or Nginx for HTTPS.

### Data Persistence

The `./data` directory is volume-mapped to `/app/data` in the backend container. This contains:
- `database.db` — SQLite database (all records)
- `mp3s/` — 128kbps MP3 previews of approved submissions

**Never delete this directory** unless you intend to lose all data.

## Audio Pipeline — Zero-Storage Lifecycle

True Peak AI follows a **zero-storage** philosophy: original WAV files are **never persisted**.

```
Producer uploads WAV (POST /api/upload)
  → Saved temporarily to /tmp/{uuid}.wav
  → Analysis pipeline runs:
    → librosa: BPM + musical key (chroma)
    → pyloudnorm: integrated LUFS + true peak
    → scipy: phase correlation
  → Compare against label's sonic signature:
    → PASS → ffmpeg converts to 128kbps MP3 → save to /app/data/mp3s/
    → FAIL → no MP3 created, rejection reason recorded
  → Delete /tmp/{uuid}.wav (always)
  → Save submission record to SQLite
```

### Memory Management

On ARM64 instances with limited RAM, the pipeline explicitly frees numpy arrays after each analysis:

```python
del y, del sr, gc.collect()
```

This prevents memory accumulation during consecutive analyses.

### Fault Isolation

Audio processing errors return HTTP 400 with actionable messages (e.g., "Unsupported codec") and **never crash the server process**.

## License

Proprietary — All rights reserved.
