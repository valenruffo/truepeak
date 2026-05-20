"""LLM-powered email draft generation for personalized rejection/approval emails."""

import os

from openai import AsyncOpenAI

from app.models import Label, Submission

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.1-8b-instruct:free")


class LLMEmailError(Exception):
    """Raised when LLM email generation fails."""

    pass


async def generate_email_draft(
    submission: Submission,
    template_type: str,
    label: Label,
) -> dict[str, str]:
    """Generate a personalized email draft using OpenRouter.

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
    if not OPENROUTER_API_KEY:
        raise LLMEmailError("OPENROUTER_API_KEY is not configured.")

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

Write a professional, respectful email.
- For rejections, be constructive and encouraging — mention the specific technical reason but frame it positively.
- For approvals, be enthusiastic and include next steps.

LANGUAGE RULE:
- Detect the language of the inputs (rejection reason, label name, etc.). If they are in Spanish, the email MUST be written entirely in Spanish.
- Since this is an Argentine record label, use natural Argentine Spanish (voseo, e.g., "Hola", "cómo estás", "queríamos contarte", "te mandamos un abrazo", etc.). Do NOT use "tú" or mix Spanish and English.
- If the inputs are in English, write the email entirely in English.

FORMAT RULE:
- The email body MUST be plain text. Do NOT include any HTML tags like <p>, <strong>, <br>, etc.
- Use normal newlines (\n) for line breaks and double newlines (\n\n) for paragraph breaks.

Return ONLY a JSON object with "subject" and "body" keys.

Example format:
{{
  "subject": "Tu demo para {label.name}",
  "body": "Hola {submission.producer_name},\n\nMuchas gracias por enviarnos tu track..."
}}
"""

    try:
        client = AsyncOpenAI(
            api_key=OPENROUTER_API_KEY,
            base_url="https://openrouter.ai/api/v1",
        )
        response = await client.chat.completions.create(
            model=OPENROUTER_MODEL,
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
            "subject": f"Tu demo para {label.name} — {submission.track_name}",
            "body": (
                f"Hola {submission.producer_name},\n\n"
                f"Muchas gracias por enviar tu track \"{submission.track_name}\" a {label.name}.\n\n"
                f"Después de escucharlo detalladamente, decidimos no avanzar con el lanzamiento en este momento."
                f"{' Detalle técnico: ' + submission.rejection_reason if submission.rejection_reason else ''}\n\n"
                f"Valoramos tu tiempo y te alentamos a seguir produciendo. Nos encantaría escuchar tus futuros trabajos.\n\n"
                f"Saludos,\nEl equipo de {label.name}"
            ),
        }
    else:
        return {
            "subject": f"¡Buenas noticias! Tu track fue aprobado por {label.name}",
            "body": (
                f"Hola {submission.producer_name},\n\n"
                f"¡Queríamos contarte que tu track \"{submission.track_name}\" fue aprobado por {label.name}!\n\n"
                f"Nos vamos a poner en contacto con vos muy pronto para coordinar los próximos pasos.\n\n"
                f"¡Felicitaciones!\n\n"
                f"Saludos,\nEl equipo de {label.name}"
            ),
        }
