"""Daily cleanup cron job for True Peak AI.

Run via: python -m app.cleanup_cron
Or: docker exec infra-backend-1 python -m app.cleanup_cron

Performs:
1. Hard delete tracks with deleted_at > 24 hours (permanent removal)
2. Clean HQ files (WAV/FLAC/AIFF) past retention period, keep MP3
"""
import os
import sqlite3
from datetime import datetime, timezone, timedelta

DB_PATH = "/app/data/database.db"
HQ_DIR = "/app/data/uploads"


def cleanup():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    now = datetime.now(timezone.utc)
    deleted_files = 0
    deleted_rows = 0
    hq_cleaned = 0
    warnings_sent = 0
    purged_accounts = 0

    # ── Rule 1: Hard delete tracks with deleted_at > 24h ──
    cutoff = (now - timedelta(hours=24)).isoformat()
    old_deleted = conn.execute(
        "SELECT id, original_path, mp3_path FROM submission WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        (cutoff,),
    ).fetchall()

    for row in old_deleted:
        # Delete files from disk
        for path_field in (row["original_path"], row["mp3_path"]):
            if path_field and os.path.exists(path_field):
                try:
                    os.remove(path_field)
                    deleted_files += 1
                except OSError:
                    pass

        # Delete DB record
        conn.execute("DELETE FROM submission WHERE id = ?", (row["id"],))
        deleted_rows += 1

    if deleted_rows > 0:
        conn.commit()
        print(f"[CLEANUP] Hard deleted {deleted_rows} tracks, removed {deleted_files} files")

    # ── Rule 2: Clean HQ files (WAV/FLAC) past retention period, keep MP3 & DB record ──
    labels = conn.execute(
        "SELECT id, hq_retention_days FROM label WHERE hq_retention_days > 0"
    ).fetchall()

    for label in labels:
        retention = label["hq_retention_days"]
        cutoff_date = (now - timedelta(days=retention)).isoformat()

        old_submissions = conn.execute(
            """SELECT id, original_path FROM submission
               WHERE label_id = ? AND deleted_at IS NULL AND original_path IS NOT NULL AND created_at < ?""",
            (label["id"], cutoff_date),
        ).fetchall()

        for row in old_submissions:
            # Delete HQ file from disk
            if row["original_path"] and os.path.exists(row["original_path"]):
                try:
                    os.remove(row["original_path"])
                    deleted_files += 1
                except OSError:
                    pass
            
            # Clear original_path in DB, preserve MP3 and submission record
            conn.execute(
                "UPDATE submission SET original_path = NULL WHERE id = ?",
                (row["id"],),
            )
            hq_cleaned += 1

    if hq_cleaned > 0:
        conn.commit()
        print(f"[HQ] Removed HQ files for {hq_cleaned} expired tracks")

    # ── Rule 3: Dead Account Warning (15 Days) ──
    warning_cutoff = (now - timedelta(days=15)).isoformat()
    try:
        frozen_labels = conn.execute(
            """SELECT id, name, owner_email FROM label
               WHERE subscription_status = 'frozen' 
               AND frozen_at IS NOT NULL
               AND frozen_at < ? 
               AND churn_warning_sent = 0""",
            (warning_cutoff,),
        ).fetchall()

        for label in frozen_labels:
            try:
                import asyncio
                import sys
                from pathlib import Path
                
                # Make sure app path is in sys.path
                backend_dir = Path(__file__).parent.parent
                if str(backend_dir) not in sys.path:
                    sys.path.append(str(backend_dir))
                    
                from app.services.email_service import send_email

                subject = f"Aviso de inactividad de la cuenta - {label['name']}"
                body = f"""
                <p>Hola,</p>
                <p>Tu cuenta de True Peak AI (<b>{label['name']}</b>) lleva congelada más de 15 días.</p>
                <p>Actualmente estamos conservando tus previas (MP3) y tu historial de demos. Sin embargo, para mantener nuestra infraestructura optimizada, eliminaremos permanentemente tus archivos y registros si la cuenta permanece inactiva durante otros 15 días (cumpliendo 30 días en total).</p>
                <p>Si deseas mantener tus datos, por favor renueva tu plan iniciando sesión en el sistema.</p>
                <p>Saludos,<br/>El equipo de True Peak AI</p>
                """
                # Run the async email sender synchronously
                asyncio.run(send_email(
                    to=label["owner_email"],
                    subject=subject,
                    body=body
                ))
                
                conn.execute(
                    "UPDATE label SET churn_warning_sent = 1 WHERE id = ?",
                    (label["id"],)
                )
                warnings_sent += 1
                print(f"[CHURN] Sent 15-day warning to {label['owner_email']}")
            except Exception as e:
                print(f"[CHURN] Error sending warning to {label['owner_email']}: {e}")
                
        if warnings_sent > 0:
            conn.commit()
    except sqlite3.OperationalError:
        pass # Migration not run yet

    # ── Rule 4: Dead Account Purge (30 Days) ──
    purge_cutoff = (now - timedelta(days=30)).isoformat()
    try:
        dead_labels = conn.execute(
            """SELECT id FROM label
               WHERE subscription_status = 'frozen' 
               AND frozen_at IS NOT NULL
               AND frozen_at < ?""",
            (purge_cutoff,),
        ).fetchall()

        for label in dead_labels:
            subs = conn.execute(
                "SELECT id, original_path, mp3_path FROM submission WHERE label_id = ?",
                (label["id"],)
            ).fetchall()
            
            for row in subs:
                for path_field in (row["original_path"], row["mp3_path"]):
                    if path_field and os.path.exists(path_field):
                        try:
                            os.remove(path_field)
                            deleted_files += 1
                        except OSError:
                            pass
                conn.execute("DELETE FROM submission WHERE id = ?", (row["id"],))
            
            # Reset churn_warning_sent so if they ever unfreeze and freeze again it starts over
            # Actually, the user rule says: "limpia sus registros de tracks". 
            conn.execute(
                "UPDATE label SET churn_warning_sent = 0 WHERE id = ?",
                (label["id"],)
            )
            print(f"[PURGE] Purged all tracks for dead account: {label['id']}")
            purged_accounts += 1

        if purged_accounts > 0:
            conn.commit()
            print(f"[PURGE] Purged {purged_accounts} dead accounts")
    except sqlite3.OperationalError:
        pass # Migration not run yet

    conn.close()
    print("[DONE] Cleanup complete")

if __name__ == "__main__":
    cleanup()
