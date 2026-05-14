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

    # ── Rule 2: Move tracks past retention period to trash ──
    labels = conn.execute(
        "SELECT id, hq_retention_days FROM label WHERE hq_retention_days > 0"
    ).fetchall()

    for label in labels:
        retention = label["hq_retention_days"]
        cutoff_date = (now - timedelta(days=retention)).isoformat()

        old_submissions = conn.execute(
            """SELECT id FROM submission
               WHERE label_id = ? AND deleted_at IS NULL AND created_at < ?""",
            (label["id"], cutoff_date),
        ).fetchall()

        for row in old_submissions:
            # Soft delete the submission (moves it to the trash tab)
            # The files will be permanently deleted 24h later by Rule 1
            conn.execute(
                "UPDATE submission SET deleted_at = ? WHERE id = ?",
                (now.isoformat(), row["id"]),
            )
            hq_cleaned += 1

    if hq_cleaned > 0:
        conn.commit()
        print(f"[HQ] Sent {hq_cleaned} expired tracks to trash")

    conn.close()
    print("[DONE] Cleanup complete")


if __name__ == "__main__":
    cleanup()
