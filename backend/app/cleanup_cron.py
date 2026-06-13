"""Daily cleanup cron job for True Peak.

Run via: python -m app.cleanup_cron
Or: docker exec infra-backend-1 python -m app.cleanup_cron

Performs:
1. Hard delete tracks with deleted_at > 24 hours (permanent removal from DB and R2)
2. Clean HQ files (WAV/FLAC/AIFF) past retention period, keep MP3
3. Dead Account Warning (15 Days)
4. Dead Account Final Warning (29 Days)
5. Dead Account Purge (30 Days)
"""
import os
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from sqlmodel import Session, select

from app.database import engine
from app.models import Label, Submission
from app.services.email_service import send_email
from app.services.r2 import delete_file_from_r2, delete_folder_from_r2

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def cleanup_async():
    now = datetime.now(timezone.utc)
    deleted_files = 0
    deleted_rows = 0
    hq_cleaned = 0
    warnings_sent = 0
    final_warnings_sent = 0
    purged_accounts = 0

    with Session(engine) as session:
        # Run expiration, warning, and deletion processing for all labels
        from app.services.expiration import check_and_process_expirations
        labels = session.exec(select(Label)).all()
        for label in labels:
            try:
                await check_and_process_expirations(label.id, session)
            except Exception as e:
                logger.error(f"Error processing expirations for label {label.id}: {e}")

        # ── Rule 3: Dead Account Warning (15 Days) ──
        warning_cutoff = now - timedelta(days=15)
        statement = select(Label).where(
            Label.subscription_status == "frozen",
            Label.frozen_at != None,
            Label.frozen_at < warning_cutoff,
            Label.churn_warning_sent == False
        )
        frozen_labels = session.exec(statement).all()

        for label in frozen_labels:
            try:
                subject = f"Aviso de inactividad de la cuenta - {label.name}"
                body = f"""
                <p>Hola,</p>
                <p>Tu cuenta de True Peak (<b>{label.name}</b>) lleva congelada más de 15 días.</p>
                <p>Actualmente estamos conservando tus previas (MP3) y tu historial de demos. Sin embargo, eliminaremos permanentemente tus archivos y registros si la cuenta permanece inactiva durante otros 15 días (cumpliendo 30 días en total).</p>
                <p>Si deseas mantener tus datos, por favor renueva tu plan iniciando sesión en el sistema.</p>
                <p>Saludos,<br/>El equipo de True Peak</p>
                """
                await send_email(to=label.owner_email, subject=subject, body=body)
                label.churn_warning_sent = True
                session.add(label)
                warnings_sent += 1
                logger.info(f"[CHURN] Sent 15-day warning to {label.owner_email}")
            except Exception as e:
                logger.error(f"[CHURN] Error sending warning to {label.owner_email}: {e}")

        if warnings_sent > 0:
            session.commit()

        # ── Rule 4: Dead Account Final Warning (29 Days / 24h before purge) ──
        final_warning_cutoff = now - timedelta(days=29)
        statement = select(Label).where(
            Label.subscription_status == "frozen",
            Label.frozen_at != None,
            Label.frozen_at < final_warning_cutoff,
            Label.final_warning_sent == False
        )
        final_frozen_labels = session.exec(statement).all()

        for label in final_frozen_labels:
            try:
                subject = f"ÚLTIMO AVISO: Eliminación de datos inminente - {label.name}"
                body = f"""
                <p>Hola,</p>
                <p>Este es el <b>último aviso</b> de True Peak para la cuenta <b>{label.name}</b>.</p>
                <p>Tu cuenta lleva congelada 29 días. En exactamente <b>24 horas</b>, todos tus historiales de demos, tracks y configuraciones serán <b>eliminados permanentemente y sin posibilidad de recuperación</b>.</p>
                <p>Si deseas evitar la pérdida total de tus datos, por favor renueva tu plan <b>hoy mismo</b>.</p>
                <p>Saludos,<br/>El equipo de True Peak</p>
                """
                await send_email(to=label.owner_email, subject=subject, body=body)
                label.final_warning_sent = True
                session.add(label)
                final_warnings_sent += 1
                logger.info(f"[CHURN-FINAL] Sent 24h final warning to {label.owner_email}")
            except Exception as e:
                logger.error(f"[CHURN-FINAL] Error sending final warning to {label.owner_email}: {e}")

        if final_warnings_sent > 0:
            session.commit()

        # ── Rule 5: Dead Account Purge (30 Days) ──
        purge_cutoff = now - timedelta(days=30)
        statement = select(Label).where(
            Label.subscription_status == "frozen",
            Label.frozen_at != None,
            Label.frozen_at < purge_cutoff
        )
        dead_labels = session.exec(statement).all()

        for label in dead_labels:
            subs = session.exec(select(Submission).where(Submission.label_id == label.id)).all()
            for sub in subs:
                try:
                    await delete_folder_from_r2(f"tracks/{sub.id}/")
                except Exception as e:
                    logger.error(f"Failed to delete folder tracks/{sub.id}/ from R2 during purge: {e}")
                session.delete(sub)
            
            # Reset flags in case they somehow reactivate (though really the account is purged)
            label.churn_warning_sent = False
            label.final_warning_sent = False
            session.add(label)
            purged_accounts += 1
            logger.info(f"[PURGE] Purged all tracks for dead account: {label.id}")

        if purged_accounts > 0:
            session.commit()
            logger.info(f"[PURGE] Purged {purged_accounts} dead accounts")

    logger.info("[DONE] Cleanup complete")

def cleanup():
    asyncio.run(cleanup_async())

if __name__ == "__main__":
    cleanup()
