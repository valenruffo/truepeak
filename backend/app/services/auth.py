"""JWT-based authentication for label owners."""

import os
from datetime import datetime, timedelta, timezone

import jwt
from jwt.exceptions import InvalidTokenError

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24


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
        jwt.ExpiredSignatureError: If the token has expired.
        jwt.InvalidTokenError: If the token is invalid.
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {
            "label_id": payload["label_id"],
            "slug": payload["slug"],
        }
    except InvalidTokenError as e:
        raise e
