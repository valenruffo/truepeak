import asyncio
import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path("/app")
if str(backend_dir) not in sys.path:
    sys.path.append(str(backend_dir))

from app.services.email_service import send_email

async def main():
    body = """
    <h2>Test de True Peak AI 🚀</h2>
    <p>Hola Valentino,</p>
    <p>Este es un email de prueba para confirmar que los envíos transaccionales con <b>Resend</b> están funcionando correctamente en el servidor de producción (VPS Oracle ARM64).</p>
    <p>El sistema utiliza <code>noreply@truepeak.space</code> como remitente y toma el correo de la cuenta del sello como <b>Reply-To</b>, así que si un productor responde a un aviso de rechazo o shortlisting, el mail le llega directo al dueño del sello.</p>
    <p><b>Emails activos en el sistema:</b></p>
    <ul>
        <li><b>Emails a Productores:</b> Avisos de Rechazo / Shortlist con métricas técnicas (BPM, LUFS). Se mandan desde el Kanban al procesar un demo.</li>
        <li><b>Aviso de Inactividad (Día 15):</b> Mail enviado a dueños de sellos en estado Frozen avisando la inminente purga de sus demos de alta calidad y MP3s.</li>
    </ul>
    <p>Saludos,<br>Antigravity 🤖</p>
    """
    try:
        res = await send_email(to="valentinoruffo2016@gmail.com", subject="Test de Correos Transaccionales - True Peak AI", body=body)
        print("Sent:", res)
    except Exception as e:
        print("Error:", e)

asyncio.run(main())
