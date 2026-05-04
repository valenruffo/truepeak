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


def init_db() -> None:
    """Create all database tables."""
    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    """Yield a database session, ensuring proper cleanup."""
    with Session(engine) as session:
        yield session
