"""Supabase JWT-based authentication for backend."""

import os
import logging
import httpx
from jose import JWTError

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

logger = logging.getLogger(__name__)

def verify_token(token: str) -> dict[str, str]:
    """Verify a Supabase JWT token by calling the Supabase Auth API.
    
    Args:
        token: The JWT token string to verify.
        
    Returns:
        Dictionary containing label_id (from sub) and email.
        
    Raises:
        JWTError: If the token is invalid or expired.
    """
    try:
        response = httpx.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {token}"
            },
            timeout=5.0
        )
        if response.status_code != 200:
            raise JWTError("Invalid or expired token.")
            
        user_data = response.json()
        return {
            "label_id": user_data.get("id"),
            "email": user_data.get("email"),
        }
    except httpx.RequestError as e:
        raise JWTError(f"Error connecting to Auth provider: {str(e)}")


def sync_user_to_supabase(
    user_id: str,
    plan: str | None = None,
    suspended: bool | None = None,
    raise_on_error: bool = False
) -> None:
    """Synchronize user subscription plan and/or suspension status to Supabase Auth."""
    if not SUPABASE_SERVICE_ROLE_KEY:
        if raise_on_error:
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY is not configured.")
        logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing. Skipping sync_user_to_supabase.")
        return

    payload = {}
    if plan is not None:
        payload["app_metadata"] = {"plan": plan}
    if suspended is not None:
        payload["ban_duration"] = "876600h" if suspended else "none"

    if not payload:
        return

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json"
    }

    try:
        with httpx.Client() as client:
            response = client.put(
                f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
                json=payload,
                headers=headers,
                timeout=5.0
            )
            if raise_on_error:
                response.raise_for_status()
            elif response.status_code >= 400:
                logger.error(f"Failed to sync user to Supabase: {response.status_code} {response.text}")
    except httpx.HTTPError as e:
        if raise_on_error:
            raise
        logger.error(f"HTTP error syncing user to Supabase: {str(e)}")
