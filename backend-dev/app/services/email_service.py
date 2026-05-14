"""Resend API integration for sending emails."""

import os

import httpx
from pydantic import BaseModel

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_API_URL = "https://api.resend.com/emails"


class EmailSendError(Exception):
    """Raised when Resend API fails to send an email."""

    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)


class EmailSendResult(BaseModel):
    id: str
    status: str


async def send_email(
    to: str,
    subject: str,
    body: str,
    from_name: str = "True Peak AI",
    reply_to: str | None = None,
) -> EmailSendResult:
    """Send an email via Resend API.

    Args:
        to: Recipient email address.
        subject: Email subject line.
        body: Email body (HTML or plain text).
        from_name: Display name for the sender.
        reply_to: Email address for replies (Reply-To header).

    Returns:
        EmailSendResult with the Resend email ID and status.

    Raises:
        EmailSendError: If the Resend API call fails.
    """
    if not RESEND_API_KEY:
        raise EmailSendError("RESEND_API_KEY is not configured.", status_code=500)

    from_email = f"{from_name} <noreply@truepeak.space>"

    payload: dict = {
        "from": from_email,
        "to": [to],
        "subject": subject,
        "html": body,
    }
    if reply_to:
        payload["reply_to"] = reply_to

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            RESEND_API_URL,
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

        if response.status_code not in (200, 201):
            raise EmailSendError(
                message=f"Resend API error ({response.status_code}): {response.text}",
                status_code=response.status_code,
            )

        data = response.json()
        return EmailSendResult(
            id=data.get("id", ""),
            status=data.get("status", "unknown"),
        )
