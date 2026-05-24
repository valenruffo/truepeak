"""Supabase JWT-based authentication for backend."""

import os
import httpx
from jose import JWTError

SUPABASE_URL = "https://dhnxyumxznhvpofujzwq.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobnh5dW14em5odnBvZnVqendxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5NDYsImV4cCI6MjA5NTEzNzk0Nn0.jmVNxrvMMiy7Z-GeUsH-T152U7m7OgbDJepkKuvGb-w"

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
