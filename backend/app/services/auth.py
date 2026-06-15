"""Supabase JWT-based authentication for backend."""

import os
import logging
import time
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


def sync_plan_to_supabase(
    user_id: str,
    plan: str,
    subscription_status: str,
    max_tracks_month: int,
    max_retries: int = 3,
) -> bool:
    """Propagate plan + subscription_status + max_tracks_month to Supabase Auth user_metadata.

    Writes the admin-visible plan to ``user_metadata`` (not ``app_metadata``) so the frontend
    can read it directly from the Supabase session. Failures are logged but do not raise:
    the caller should treat the response as partial success when this returns False.
    """
    if not SUPABASE_SERVICE_ROLE_KEY or not SUPABASE_URL:
        logger.warning(
            "Supabase credentials missing. Skipping sync_plan_to_supabase for user_id=%s",
            user_id,
        )
        return False

    payload = {
        "user_metadata": {
            "plan": plan,
            "subscription_status": subscription_status,
            "max_tracks_month": max_tracks_month,
        }
    }
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    url = f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}"

    backoff = 0.5
    for attempt in range(1, max_retries + 1):
        try:
            with httpx.Client() as client:
                response = client.put(url, json=payload, headers=headers, timeout=5.0)

            if 200 <= response.status_code < 300:
                logger.info(
                    "Synced plan=%s status=%s to Supabase for user_id=%s",
                    plan,
                    subscription_status,
                    user_id,
                )
                return True

            if response.status_code == 429 and attempt < max_retries:
                logger.warning(
                    "Supabase Admin API rate-limited (attempt %d/%d) for user_id=%s; backing off %.2fs",
                    attempt,
                    max_retries,
                    user_id,
                    backoff,
                )
                time.sleep(backoff)
                backoff *= 2
                continue

            logger.error(
                "Failed to sync plan to Supabase for user_id=%s: %s %s",
                user_id,
                response.status_code,
                response.text,
            )
            return False
        except httpx.HTTPError as e:
            if attempt < max_retries:
                logger.warning(
                    "HTTP error syncing plan to Supabase (attempt %d/%d) for user_id=%s: %s",
                    attempt,
                    max_retries,
                    user_id,
                    str(e),
                )
                time.sleep(backoff)
                backoff *= 2
                continue
            logger.error(
                "HTTP error syncing plan to Supabase for user_id=%s after %d retries: %s",
                user_id,
                max_retries,
                str(e),
            )
            return False
    return False
