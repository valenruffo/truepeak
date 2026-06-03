"""Resend API integration for sending emails and fixed templates."""

import os

import httpx
from pydantic import BaseModel

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_API_URL = "https://api.resend.com/emails"


# ── Fixed email templates ────────────────────────────────────────────────────

REJECTION_TEMPLATE = {
    "subject": "{{track_name}} — Resultado del análisis",
    "body": """<p>Hola {{producer_name}},</p>

<p>Gracias por enviar <b>{{track_name}}</b> a {{label_name}}.</p>

<p>Después de analizar tu track, no cumple con los requisitos técnicos que buscamos en este momento:</p>

<ul>
<li><b>BPM:</b> {{bpm}}</li>
<li><b>LUFS:</b> {{lufs}}</li>
<li><b>Fase:</b> {{phase_correlation}}</li>
<li><b>Tonalidad:</b> {{musical_key}}</li>
</ul>

<p>Esto no significa que el track sea malo — simplemente no matchea con lo que necesitamos ahora. Seguí mandando material.</p>

<p>Saludos,<br/>{{label_name}} via True Peak</p>""",
}

APPROVAL_TEMPLATE = {
    "subject": "¡{{track_name}} seleccionado por {{label_name}}!",
    "body": """<p>Hola {{producer_name}},</p>

<p>¡Buenas noticias! <b>{{track_name}}</b> pasó nuestro análisis técnico y fue seleccionado por {{label_name}}.</p>

<p>Métricas del track:</p>

<ul>
<li><b>BPM:</b> {{bpm}}</li>
<li><b>LUFS:</b> {{lufs}}</li>
<li><b>Fase:</b> {{phase_correlation}}</li>
<li><b>Tonalidad:</b> {{musical_key}}</li>
</ul>

<p>Te vamos a estar contactando pronto con los próximos pasos.</p>

<p>Saludos,<br/>{{label_name}} via True Peak</p>""",
}


def get_fixed_template(template_type: str) -> dict[str, str]:
    """Return a fixed email template for rejection or approval."""
    if template_type == "rejection":
        return REJECTION_TEMPLATE
    return APPROVAL_TEMPLATE


# ── Email sending ─────────────────────────────────────────────────────────────


class EmailSendError(Exception):
    """Raised when Resend API fails to send an email."""

    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)


class EmailSendResult(BaseModel):
    id: str
    status: str


def text_to_html(text: str) -> str:
    """Convert plain text to HTML paragraphs and line breaks."""
    if not text:
        return ""
    # If the text already has HTML tag-like structure, return as is
    if "<p>" in text or "<br" in text or "<html>" in text:
        return text
    # Convert double newlines to paragraph breaks, and single newlines to <br />
    paragraphs = text.split("\n\n")
    html_paragraphs = []
    for p in paragraphs:
        if p.strip():
            formatted_p = p.strip().replace("\n", "<br />")
            html_paragraphs.append(f"<p>{formatted_p}</p>")
    return "".join(html_paragraphs)


async def send_email(
    to: str,
    subject: str,
    body: str,
    from_name: str = "True Peak",
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
    html_body = text_to_html(body)

    payload: dict = {
        "from": from_email,
        "to": [to],
        "subject": subject,
        "html": html_body,
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
