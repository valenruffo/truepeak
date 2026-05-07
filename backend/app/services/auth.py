"""JWT-based authentication and password hashing for label owners."""

import os
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

# --- Password hashing ---

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24


def get_password_hash(password: str) -> str:
    """Hash a password using bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a bcrypt hash."""
    return pwd_context.verify(plain_password, hashed_password)


# --- JWT token management ---


def create_token(label_id: str, slug: str) -> str:
    """Create a JWT token for a label owner.

    Args:
        label_id: The unique identifier of the label.
        slug: The URL-friendly slug of the label.

    Returns:
        Encoded JWT token string.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "label_id": label_id,
        "slug": slug,
        "iat": now,
        "exp": now + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> dict[str, str]:
    """Verify and decode a JWT token.

    Args:
        token: The JWT token string to verify.

    Returns:
        Dictionary containing label_id and slug.

    Raises:
        JWTError: If the token is invalid or expired.
    """
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    return {
        "label_id": payload["label_id"],
        "slug": payload["slug"],
    }
