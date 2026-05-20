"""Database engine and session configuration."""

import os
from pathlib import Path
from typing import Generator

from sqlmodel import SQLModel, create_engine, Session, text

DATA_DIR = os.getenv("DATA_DIR", str(Path(__file__).parent.parent.parent / "data"))
DATABASE_URL = f"sqlite:///{DATA_DIR}/database.db"

# Fallback to relative path for local dev if DATA_DIR not set and parent/data doesn't exist
if not Path(DATA_DIR).exists():
    DATABASE_URL = "sqlite:///./data/database.db"

connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)


def _apply_migrations(session: Session) -> None:
    """Apply ALTER TABLE migrations for new columns (idempotent)."""
    migrations = [
        # Feature 2: submission notes
        "ALTER TABLE submission ADD COLUMN notes TEXT",
        # Feature 3: label submission texts
        "ALTER TABLE label ADD COLUMN submission_title TEXT",
        "ALTER TABLE label ADD COLUMN submission_description TEXT",
        # Phase 1: Label plan limits
        "ALTER TABLE label ADD COLUMN max_tracks_month INTEGER DEFAULT 10",
        "ALTER TABLE label ADD COLUMN max_emails_month INTEGER DEFAULT 0",
        "ALTER TABLE label ADD COLUMN hq_retention_days INTEGER DEFAULT 0",
        "ALTER TABLE label ADD COLUMN emails_sent_this_month INTEGER DEFAULT 0",
        "ALTER TABLE label ADD COLUMN emails_sent_month INTEGER DEFAULT 1",
        # Phase 1: Submission soft delete + email tracking
        "ALTER TABLE submission ADD COLUMN deleted_at DATETIME",
        "ALTER TABLE submission ADD COLUMN human_email_sent BOOLEAN DEFAULT 0",
        # Phase 2: Audio metrics
        "ALTER TABLE submission ADD COLUMN true_peak FLOAT",
        "ALTER TABLE submission ADD COLUMN crest_factor FLOAT",
        # Role onboarding
        "ALTER TABLE label ADD COLUMN role TEXT DEFAULT 'label'",
        # Polar ID tracking
        "ALTER TABLE label ADD COLUMN polar_customer_id TEXT",
        "ALTER TABLE label ADD COLUMN polar_subscription_id TEXT",
        # Waveform peaks column
        "ALTER TABLE submission ADD COLUMN peaks TEXT",
        # Social links and switches
        "ALTER TABLE label ADD COLUMN ask_instagram BOOLEAN DEFAULT 0",
        "ALTER TABLE label ADD COLUMN ask_soundcloud BOOLEAN DEFAULT 0",
        "ALTER TABLE submission ADD COLUMN producer_instagram TEXT",
        "ALTER TABLE submission ADD COLUMN producer_soundcloud TEXT",
        # HQ download tracking
        "ALTER TABLE submission ADD COLUMN hq_downloaded BOOLEAN DEFAULT 0",
    ]
    for sql in migrations:
        try:
            session.exec(text(sql))  # type: ignore[arg-type]
            session.commit()
        except Exception:
            session.rollback()  # Column already exists — skip


def _seed_demo_user(session: Session) -> None:
    """Seeds a realistic demo user with 20 tracks and templates if it doesn't exist."""
    from uuid import uuid4
    from sqlmodel import select
    from app.models import Label, Submission, EmailTemplate
    from app.services.auth import get_password_hash
    import random

    demo_slug = "apex"
    label = session.exec(select(Label).where(Label.slug == demo_slug)).first()
    if label:
        return  # Already seeded

    # Create the demo label
    label_id = str(uuid4())
    
    # Generate silent MP3 if it doesn't exist
    mp3_dir = Path(DATA_DIR) / "mp3s"
    mp3_dir.mkdir(parents=True, exist_ok=True)
    silent_mp3_path = mp3_dir / "demo_silent.mp3"
    if not silent_mp3_path.exists():
        import subprocess
        try:
            subprocess.run([
                "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:c=2",
                "-t", "30", "-acodec", "libmp3lame", str(silent_mp3_path)
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            print(f"Error generating silent MP3 for seed: {e}")

    label = Label(
        id=label_id,
        name="Apex Recordings",
        slug=demo_slug,
        owner_email="demo@apexrecordings.com",
        password_hash=get_password_hash("apex123"),
        plan="pro",
        max_tracks_month=1000,
        max_emails_month=500,
        hq_retention_days=14,
        logo_path=None,
        submission_title="Apex Recordings — Demo Submission Portal",
        submission_description="We are looking for Deep House, Progressive House, and Melodic Techno. Make sure your track is technically clean and matches our BPM range (122 - 128).",
        ask_instagram=True,
        ask_soundcloud=True,
        sonic_signature={
            "bpm_min": 122,
            "bpm_max": 128,
            "lufs_target": -9.0,
            "lufs_tolerance": 2.0,
            "target_camelot_keys": [],
            "preferred_scales": ["A Minor", "C Major", "G Minor", "E Minor"],
            "duration_enabled": True,
            "duration_max": 540,
            "auto_reject_rules": {
                "phase": True,
                "tempo": True,
                "reject_clipping": True,
                "reject_low_dynamic_range": True
            },
            "allowed_formats": ["wav", "flac", "aiff"],
            "max_upload_size_mb": 100
        }
    )
    session.add(label)

    # Add default email templates
    template_types = [
        ("rejection", "Demo Feedback - Apex Recordings", "Hi {{producer_name}},\n\nThank you for submitting {{track_name}}. Unfortunately, it doesn't fit our current schedule or sonic signature requirements.\n\nKeep producing and feel free to send future work!\n\nBest regards,\nA&R Team\nApex Recordings"),
        ("approval", "Demo Accepted! - Apex Recordings", "Hi {{producer_name}},\n\nWe really liked {{track_name}}! We would love to shortlist it for our upcoming compilations / releases.\n\nWe will get back to you shortly with more details.\n\nBest regards,\nA&R Team\nApex Recordings"),
        ("followup", "Demo Follow-up - Apex Recordings", "Hi {{producer_name}},\n\nRegarding {{track_name}}, we wanted to check if this track is still available for signing. Let us know!\n\nBest regards,\nA&R Team\nApex Recordings")
    ]
    for t_type, subject, body in template_types:
        tpl = EmailTemplate(
            id=str(uuid4()),
            label_id=label_id,
            name=f"Default {t_type.capitalize()}",
            template_type=t_type,
            subject_template=subject,
            body_template=body
        )
        session.add(tpl)

    # Helper to generate mock peaks
    def gen_peaks():
        return [round(random.uniform(0.05, 0.95), 4) for _ in range(100)]

    # Helper to create submissions
    submissions_data = [
        # status = inbox
        ("Kamilo Sanclemente", "kamilo@sanclemente.com", "Quantum Horizon", 123.0, -9.2, 450.0, 0.8, "A Minor", -9.0, 0.12, "inbox", "@kamilosanclemente", "kamilosanclemente"),
        ("Stan Kolev", "stan@kolevmusic.com", "Inner Peace", 122.0, -8.8, 480.0, 0.75, "G Minor", -8.5, 0.15, "inbox", "@stankolev", "stankolev"),
        ("Guy J", "guy@lostmiracle.com", "Lost in Echoes", 125.0, -10.1, 510.0, 0.9, "E Minor", -9.8, 0.11, "inbox", "@guyj", "guyj"),
        ("Jeremy Olander", "jeremy@vivrant.nu", "Transit", 124.0, -9.5, 460.0, 0.85, "D Minor", -9.2, 0.13, "inbox", "@jeremyolander", "jeremyolander"),
        ("Miss Monique", "miss@monique.com", "Raining in Tbilisi", 126.0, -8.9, 420.0, 0.7, "F Major", -8.4, 0.16, "inbox", "@missmonique", "missmonique"),
        ("Volen Sentir", "volen@sentir.com", "Neja", 122.0, -10.5, 490.0, 0.88, "C Major", -10.0, 0.10, "inbox", "@volensentir", "volensentir"),
        ("Sébastien Léger", "sebastien@leger.com", "Lost Miracle", 123.0, -9.8, 470.0, 0.82, "G Major", -9.5, 0.14, "inbox", "@sebastienleger", "sebastienleger"),
        ("Eelke Kleijn", "eelke@kleijn.nl", "Distance", 124.0, -9.0, 440.0, 0.79, "A Minor", -8.8, 0.13, "inbox", "@eelkekleijn", "eelkekleijn"),

        # status = shortlist
        ("Hernan Cattaneo", "hernan@cattaneo.com", "Wind Chimes", 122.0, -9.1, 530.0, 0.84, "A Minor", -8.9, 0.12, "shortlist", "@hernancattaneo", "hernancattaneo"),
        ("Nick Warren", "nick@warren.com", "Subliminal Groove", 123.0, -9.4, 500.0, 0.81, "D Minor", -9.1, 0.13, "shortlist", "@nickwarren", "nickwarren"),
        ("Patrice Bäumel", "patrice@baumel.com", "Neosphere", 126.0, -8.5, 430.0, 0.76, "G Minor", -8.2, 0.15, "shortlist", "@patricebaumel", "patricebaumel"),
        ("John Digweed", "john@digweed.com", "Gridlock", 125.0, -9.6, 520.0, 0.87, "E Minor", -9.3, 0.11, "shortlist", "@johndigweed", "johndigweed"),
        ("Sasha", "sasha@sasha.com", "Out of Time", 124.0, -10.0, 540.0, 0.91, "B Minor", -9.7, 0.10, "shortlist", "@sasha", "sasha"),

        # status = rejected
        ("David Guetta", "david@guetta.com", "Future Rave Electro", 128.0, -5.2, 180.0, 0.65, "C Major", -4.8, 0.22, "rejected", "@davidguetta", "davidguetta"),
        ("Martin Garrix", "martin@garrix.com", "Mainstage Anthem", 128.0, -4.8, 210.0, 0.68, "G Minor", -4.5, 0.24, "rejected", "@martingarrix", "martingarrix"),
        ("Tiësto", "tiesto@tiesto.com", "Loud Bassline", 126.0, -4.5, 230.0, 0.7, "E Minor", -4.1, 0.25, "rejected", "@tiesto", "tiesto"),
        ("Hardwell", "hardwell@hardwell.com", "Big Room Beat", 128.0, -5.0, 240.0, 0.6, "A Minor", -4.6, 0.21, "rejected", "@hardwell", "hardwell"),

        # status = auto_rejected
        ("Amateur DJ", "amateur@dj.com", "Phase Issue Track", 124.0, -9.0, 420.0, -0.85, "A Minor", -8.8, 0.12, "auto_rejected", "@amateurdj", "amateurdj"),
        ("Hard Techno Producer", "hard@techno.com", "Too Loud Jam", 145.0, -3.2, 360.0, 0.72, "F Minor", -2.8, 0.20, "auto_rejected", "@hardtechno", "hardtechno"),
        ("Ambient Maker", "ambient@maker.com", "Chill Out Intro", 90.0, -18.5, 600.0, 0.88, "C Major", -18.0, 0.08, "auto_rejected", "@ambientmaker", "ambientmaker")
    ]

    rejection_reasons = {
        "Phase Issue Track": "Fase invertida: Correlación de fase negativa (-0.85). Se cancelaría el audio en sistemas de club mono.",
        "Too Loud Jam": "Fuera de tempo y volumen excesivo: BPM de 145 (rango permitido: 122-128) y volumen de -3.2 LUFS (límite permitido: -9.0 ± 2.0).",
        "Chill Out Intro": "Fuera de tempo y bajo volumen: BPM de 90 (rango permitido: 122-128) y volumen de -18.5 LUFS (límite permitido: -9.0 ± 2.0)."
    }

    for prod_name, prod_email, track_name, bpm, lufs, duration, phase, key, true_peak, crest, status, ig, sc in submissions_data:
        sub = Submission(
            id=str(uuid4()),
            label_id=label_id,
            producer_name=prod_name,
            producer_email=prod_email,
            track_name=track_name,
            bpm=bpm,
            lufs=lufs,
            duration=duration,
            phase_correlation=phase,
            musical_key=key,
            true_peak=true_peak,
            crest_factor=crest,
            status=status,
            rejection_reason=rejection_reasons.get(track_name),
            mp3_path=str(silent_mp3_path) if silent_mp3_path.exists() else None,
            original_path=None,
            peaks=gen_peaks(),
            producer_instagram=ig,
            producer_soundcloud=sc
        )
        session.add(sub)

    session.commit()


def init_db() -> None:
    """Create all database tables and apply migrations."""
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        _apply_migrations(session)
        _seed_demo_user(session)


def get_session() -> Generator[Session, None, None]:
    """Yield a database session, ensuring proper cleanup."""
    with Session(engine) as session:
        yield session
