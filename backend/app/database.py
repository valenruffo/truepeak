"""Database engine and session configuration."""

import os
from typing import Generator

from sqlmodel import SQLModel, create_engine, Session

# Supabase PostgreSQL URL
DATABASE_URL = os.getenv("POSTGRES_URL", "postgresql+psycopg2://postgres:postgres@localhost:5432/postgres")

# Enable connection pooling for production
engine = create_engine(
    DATABASE_URL, 
    echo=False,
    pool_size=10,
    max_overflow=20
)

def init_db() -> None:
    """Create all database tables."""
    SQLModel.metadata.create_all(engine)

def get_session() -> Generator[Session, None, None]:
    """Yield a database session, ensuring proper cleanup."""
    with Session(engine) as session:
        yield session
