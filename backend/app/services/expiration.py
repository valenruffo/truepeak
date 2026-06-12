"""Service to check, notify, and process expired submissions."""

import logging
from datetime import UTC, datetime, timedelta
from sqlmodel import Session, select

from app.models import Label, Notification, Submission
from app.services.r2 import delete_folder_from_r2

logger = logging.getLogger(__name__)


async def check_and_process_expirations(label_id: str, session: Session):
    """Check all submissions for a label.

    Handles warning notifications, auto soft-deletion on expiration, and hard-deletion after
    retention or trash limits.
    """
    label = session.get(Label, label_id)
    if not label or label.hq_retention_days == 0:
        return

    now = datetime.now(UTC)
    retention_delta = timedelta(days=label.hq_retention_days)

    # 1. Check active submissions
    active_subs = session.exec(
        select(Submission).where(
            Submission.label_id == label_id,
            Submission.deleted_at.is_(None),
        )
    ).all()

    for sub in active_subs:
        created_at = sub.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)

        expires_at = created_at + retention_delta
        time_left = expires_at - now

        if time_left <= timedelta(0):
            # Expired: soft delete and notify
            sub.deleted_at = now
            session.add(sub)

            unique_key = f"expired_trash_{sub.id}"
            existing_notif = session.exec(
                select(Notification).where(Notification.unique_key == unique_key)
            ).first()
            if not existing_notif:
                notif = Notification(
                    label_id=label_id,
                    title="Demo expirada y movida a papelera",
                    message=f"El track '{sub.track_name}' de {sub.producer_name} ha expirado y se ha movido a la papelera. Será eliminado definitivamente en 30 minutos.",
                    unique_key=unique_key,
                )
                session.add(notif)
                logger.info(f"[EXPIRATION] Soft-deleted expired track: {sub.id}")

        elif time_left <= timedelta(hours=1):
            unique_key = f"expire_1h_{sub.id}"
            existing_notif = session.exec(
                select(Notification).where(Notification.unique_key == unique_key)
            ).first()
            if not existing_notif:
                notif = Notification(
                    label_id=label_id,
                    title="Demo expira pronto (1 hora)",
                    message=f"El track '{sub.track_name}' de {sub.producer_name} expirará pronto (menos de 1 hora).",
                    unique_key=unique_key,
                )
                session.add(notif)

        elif time_left <= timedelta(hours=5):
            unique_key = f"expire_5h_{sub.id}"
            existing_notif = session.exec(
                select(Notification).where(Notification.unique_key == unique_key)
            ).first()
            if not existing_notif:
                notif = Notification(
                    label_id=label_id,
                    title="Demo expira pronto (5 horas)",
                    message=f"El track '{sub.track_name}' de {sub.producer_name} expirará pronto (menos de 5 horas).",
                    unique_key=unique_key,
                )
                session.add(notif)

        elif time_left <= timedelta(hours=24):
            unique_key = f"expire_24h_{sub.id}"
            existing_notif = session.exec(
                select(Notification).where(Notification.unique_key == unique_key)
            ).first()
            if not existing_notif:
                notif = Notification(
                    label_id=label_id,
                    title="Demo expira pronto (24 horas)",
                    message=f"El track '{sub.track_name}' de {sub.producer_name} expirará pronto (menos de 24 horas).",
                    unique_key=unique_key,
                )
                session.add(notif)

    # 2. Check soft-deleted submissions
    deleted_subs = session.exec(
        select(Submission).where(
            Submission.label_id == label_id,
            Submission.deleted_at.is_not(None),
        )
    ).all()

    for sub in deleted_subs:
        created_at = sub.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)

        deleted_at = sub.deleted_at
        if deleted_at.tzinfo is None:
            deleted_at = deleted_at.replace(tzinfo=UTC)

        # Check if it was soft-deleted due to expiration (or deleted after expiration time)
        expiration_time = created_at + retention_delta
        is_expired = deleted_at >= expiration_time

        if is_expired:
            # Expired: hard delete after 30 minutes in trash
            if now > deleted_at + timedelta(minutes=30):
                try:
                    await delete_folder_from_r2(f"tracks/{sub.id}/")
                except Exception as e:
                    logger.error(
                        f"Failed to delete folder tracks/{sub.id}/ from R2 during expiration hard-delete: {e}"
                    )
                session.delete(sub)
                logger.info(f"[EXPIRATION] Hard-deleted expired track: {sub.id}")

                unique_key = f"hard_deleted_{sub.id}"
                existing_notif = session.exec(
                    select(Notification).where(Notification.unique_key == unique_key)
                ).first()
                if not existing_notif:
                    notif = Notification(
                        label_id=label_id,
                        title="Demo eliminada permanentemente",
                        message=f"El track '{sub.track_name}' de {sub.producer_name} ha sido eliminado definitivamente.",
                        unique_key=unique_key,
                    )
                    session.add(notif)
        else:
            # Manually deleted: hard delete after 24 hours
            if now > deleted_at + timedelta(hours=24):
                try:
                    await delete_folder_from_r2(f"tracks/{sub.id}/")
                except Exception as e:
                    logger.error(
                        f"Failed to delete folder tracks/{sub.id}/ from R2 during manual hard-delete: {e}"
                    )
                session.delete(sub)
                logger.info(f"[EXPIRATION] Hard-deleted manually deleted track: {sub.id}")

    session.commit()
