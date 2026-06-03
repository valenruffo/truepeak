"""Database engine and session configuration."""

import os
from typing import Generator

from sqlmodel import SQLModel, create_engine, Session

# Supabase PostgreSQL URL
DATABASE_URL = os.getenv("POSTGRES_URL")
if not DATABASE_URL:
    raise RuntimeError("POSTGRES_URL environment variable is required")

# Enable connection pooling for production
engine = create_engine(
    DATABASE_URL, 
    echo=False,
    pool_size=10,
    max_overflow=20
)

migrations = [
    "ALTER TABLE submission ADD COLUMN status_tecnico VARCHAR(50) DEFAULT 'optimo'",
    "ALTER TABLE submission ADD COLUMN alertas JSON DEFAULT '[]'"
]

def init_db() -> None:
    """Create all database tables."""
    SQLModel.metadata.create_all(engine)
    
    # Run idempotent raw SQL migrations for existing database columns
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    if inspector.has_table("submission"):
        columns = {col["name"] for col in inspector.get_columns("submission")}
        with Session(engine) as session:
            if "status_tecnico" not in columns:
                session.execute(text("ALTER TABLE submission ADD COLUMN status_tecnico VARCHAR(50) DEFAULT 'optimo'"))
            if "alertas" not in columns:
                session.execute(text("ALTER TABLE submission ADD COLUMN alertas JSON DEFAULT '[]'"))
            session.commit()

def get_session() -> Generator[Session, None, None]:
    """Yield a database session, ensuring proper cleanup."""
    with Session(engine) as session:
        yield session
