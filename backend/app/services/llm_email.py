"""LLM-powered email draft generation for personalized rejection/approval emails."""

import os

from openai import AsyncOpenAI

from app.models import Label, Submission

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


class LLMEmailError(Exception):
    """Raised when LLM email generation fails."""

    pass


async def generate_email_draft(
    submission: Submission,
    template_type: str,
    label: Label,
) -> dict[str, str]:
    """Generate a personalized email draft using OpenAI.

    Builds a prompt with producer name, track name, technical metrics,
    and rejection reason (if applicable), then calls the LLM to generate
    a personalized email.

    Args:
        submission: The submission record with metrics.
        template_type: Type of email — "rejection" or "approval".
        label: The label entity for context.

    Returns:
        Dictionary with 'subject' and 'body' keys.

    Raises:
        LLMEmailError: If the LLM call fails (caller should fall back to template).
    """
    if not OPENAI_API_KEY:
        raise LLMEmailError("OPENAI_API_KEY is not configured.")

    # Build metrics summary
    metrics_parts = []
    if submission.bpm is not None:
        metrics_parts.append(f"BPM: {submission.bpm:.1f}")
    if submission.lufs is not None:
        metrics_parts.append(f"Integrated LUFS: {submission.lufs:.1f}")
    if submission.phase_correlation is not None:
        metrics_parts.append(f"Phase correlation: {submission.phase_correlation:.3f}")
    if submission.musical_key:
        metrics_parts.append(f"Musical key: {submission.musical_key}")

    metrics_text = "\n".join(metrics_parts) if metrics_parts else "No audio metrics available."

    # Build rejection context
    rejection_context = ""
    if template_type == "rejection" and submission.rejection_reason:
        rejection_context = f"\nRejection reason: {submission.rejection_reason}"

    # Build the prompt
    prompt = f"""You are writing an email on behalf of the record label "{label.name}".

Producer: {submission.producer_name}
Track: {submission.track_name}
Email type: {template_type}

Technical analysis:
{metrics_text}
{rejection_context}

Write a professional, respectful email. For rejections, be constructive and encouraging — mention the specific technical reason but frame it positively. For approvals, be enthusiastic and include next steps.

Return ONLY a JSON object with "subject" and "body" keys. The body should be HTML-formatted.

Example format:
{{
  "subject": "Your submission to {label.name}",
  "body": "<p>Hi {submission.producer_name},</p><p>...</p>"
}}
"""

    try:
        client = AsyncOpenAI(api_key=OPENAI_API_KEY)
        response = await client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are a professional A&R assistant for an electronic music label. Write concise, respectful emails.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=500,
        )

        content = response.choices[0].message.content
        if not content:
            raise LLMEmailError("LLM returned empty response.")

        # Parse JSON from response
        import json

        # Try to extract JSON from the response (handle markdown code blocks)
        json_str = content.strip()
        if json_str.startswith("```"):
            # Remove markdown code block markers
            lines = json_str.split("\n")
            json_str = "\n".join(lines[1:-1])

        result = json.loads(json_str)
        return {
            "subject": result.get("subject", f"Your submission to {label.name}"),
            "body": result.get("body", content),
        }

    except Exception as e:
        raise LLMEmailError(f"LLM email generation failed: {e}")


def get_fallback_template(
    submission: Submission,
    template_type: str,
    label: Label,
) -> dict[str, str]:
    """Return a basic template if LLM generation fails.

    Args:
        submission: The submission record.
        template_type: Type of email.
        label: The label entity.

    Returns:
        Dictionary with 'subject' and 'body' keys.
    """
    if template_type == "rejection":
        return {
            "subject": f"Your submission to {label.name} — {submission.track_name}",
            "body": (
                f"<p>Hi {submission.producer_name},</p>"
                f"<p>Thank you for submitting <strong>{submission.track_name}</strong> to {label.name}.</p>"
                f"<p>After careful review, we've decided not to move forward with this track at this time."
                f"{' Reason: ' + submission.rejection_reason if submission.rejection_reason else ''}</p>"
                f"<p>We appreciate your time and encourage you to keep creating. We'd love to hear future submissions.</p>"
                f"<p>Best regards,<br>{label.name} A&R Team</p>"
            ),
        }
    else:
        return {
            "subject": f"Great news! Your track has been approved by {label.name}",
            "body": (
                f"<p>Hi {submission.producer_name},</p>"
                f"<p>We're excited to let you know that <strong>{submission.track_name}</strong> has been approved by {label.name}!</p>"
                f"<p>Our team will be in touch shortly with next steps.</p>"
                f"<p>Congratulations and welcome aboard!</p>"
                f"<p>Best regards,<br>{label.name} A&R Team</p>"
            ),
        }
