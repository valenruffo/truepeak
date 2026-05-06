"""Database engine and session configuration."""

import os
from pathlib import Path
from typing import Generator

from sqlmodel import SQLModel, create_engine, Session

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
    ]
    for sql in migrations:
        try:
            session.exec(sql)  # type: ignore[arg-type]
            session.commit()
        except Exception:
            session.rollback()  # Column already exists — skip


def init_db() -> None:
    """Create all database tables and apply migrations."""
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        _apply_migrations(session)


def get_session() -> Generator[Session, None, None]:
    """Yield a database session, ensuring proper cleanup."""
    with Session(engine) as session:
        yield session
