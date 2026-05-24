"""Supabase JWT-based authentication for backend."""

import os
from jose import JWTError, jwt

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")

def verify_token(token: str) -> dict[str, str]:
    """Verify and decode a Supabase JWT token.
    
    Args:
        token: The JWT token string to verify.
        
    Returns:
        Dictionary containing label_id (from sub).
        
    Raises:
        JWTError: If the token is invalid or expired.
    """
    if not SUPABASE_JWT_SECRET:
        raise JWTError("SUPABASE_JWT_SECRET is not configured.")
        
    payload = jwt.decode(
        token, 
        SUPABASE_JWT_SECRET, 
        algorithms=["HS256"], 
        options={"verify_aud": False}
    )
    
    return {
        "label_id": payload.get("sub"), # Supabase user ID mapped to label.id
        "email": payload.get("email"),
    }
