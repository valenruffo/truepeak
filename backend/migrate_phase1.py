#!/usr/bin/env python3
"""Phase 1 migration script — Models & Database.

Run against the existing SQLite database to add new columns and migrate data.

Usage:
    python /tmp/migrate_phase1.py /path/to/data/database.db

Or set DATA_DIR env var:
    DATA_DIR=/path/to/data python /tmp/migrate_phase1.py
"""

import os
import sys
from pathlib import Path

import sqlite3


def get_db_path() -> str:
    """Resolve database path from arg or env var."""
    if len(sys.argv) > 1:
        return sys.argv[1]
    data_dir = os.getenv("DATA_DIR", str(Path(__file__).parent.parent / "data"))
    return f"{data_dir}/database.db"


def migrate(db_path: str) -> None:
    """Apply Phase 1 migrations."""
    if not Path(db_path).exists():
        print(f"[WARN] Database not found at {db_path} — skipping migration.")
        return

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # --- Get existing columns ---
    cur.execute("PRAGMA table_info(label)")
    label_cols = {row[1] for row in cur.fetchall()}

    cur.execute("PRAGMA table_info(submission)")
    submission_cols = {row[1] for row in cur.fetchall()}

    # --- Add Label columns ---
    label_migrations = [
        ("max_tracks_month", "ALTER TABLE label ADD COLUMN max_tracks_month INTEGER DEFAULT 10"),
        ("max_emails_month", "ALTER TABLE label ADD COLUMN max_emails_month INTEGER DEFAULT 0"),
        ("hq_retention_days", "ALTER TABLE label ADD COLUMN hq_retention_days INTEGER DEFAULT 0"),
        ("emails_sent_this_month", "ALTER TABLE label ADD COLUMN emails_sent_this_month INTEGER DEFAULT 0"),
        ("emails_sent_month", "ALTER TABLE label ADD COLUMN emails_sent_month INTEGER DEFAULT 1"),
    ]

    for col_name, sql in label_migrations:
        if col_name not in label_cols:
            print(f"[LABEL] Adding column: {col_name}")
            cur.execute(sql)
        else:
            print(f"[LABEL] Column already exists: {col_name}")

    # --- Add Submission columns ---
    submission_migrations = [
        ("deleted_at", "ALTER TABLE submission ADD COLUMN deleted_at DATETIME"),
        ("human_email_sent", "ALTER TABLE submission ADD COLUMN human_email_sent BOOLEAN DEFAULT 0"),
    ]

    for col_name, sql in submission_migrations:
        if col_name not in submission_cols:
            print(f"[SUBMISSION] Adding column: {col_name}")
            cur.execute(sql)
        else:
            print(f"[SUBMISSION] Column already exists: {col_name}")

    conn.commit()

    # --- Migrate existing label plan limits ---
    if "plan" in label_cols:
        print("[LABEL] Setting plan limits based on current plan values...")
        # Free plan
        cur.execute(
            "UPDATE label SET "
            "max_tracks_month = 10, max_emails_month = 0, hq_retention_days = 0 "
            "WHERE plan = 'free' OR plan IS NULL"
        )
        # Indie plan
        cur.execute(
            "UPDATE label SET "
            "max_tracks_month = 100, max_emails_month = 100, hq_retention_days = 7 "
            "WHERE plan = 'indie'"
        )
        # Pro plan
        cur.execute(
            "UPDATE label SET "
            "max_tracks_month = 1000, max_emails_month = 500, hq_retention_days = 14 "
            "WHERE plan = 'pro'"
        )
        conn.commit()
        print(f"[LABEL] Updated {cur.rowcount} label(s) with plan limits.")

    # --- Migrate existing submission statuses ---
    if "status" in submission_cols:
        print("[SUBMISSION] Migrating status values...")
        # "pending" → "inbox"
        cur.execute("UPDATE submission SET status = 'inbox' WHERE status = 'pending'")
        pending_count = cur.rowcount
        # "approved" → "shortlist" (human said yes)
        cur.execute("UPDATE submission SET status = 'shortlist' WHERE status = 'approved'")
        approved_count = cur.rowcount
        conn.commit()
        print(f"[SUBMISSION] pending→inbox: {pending_count}, approved→shortlist: {approved_count}")

    conn.close()
    print("[DONE] Phase 1 migration complete.")


if __name__ == "__main__":
    db_path = get_db_path()
    print(f"Phase 1 Migration — Database: {db_path}")
    migrate(db_path)
