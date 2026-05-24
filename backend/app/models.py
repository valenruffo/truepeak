"""SQLModel database models for True Peak AI."""

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON
from sqlmodel import Field, Relationship, SQLModel


class Label(SQLModel, table=True):
    """Record label / studio entity that owns submissions and templates."""

    __tablename__ = "label"
    __table_args__ = (
        # Ensure one label per owner email
    )

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    name: str
    slug: str = Field(unique=True, index=True)
    owner_email: str = Field(unique=True, index=True)
    password_hash: str | None = None
    sonic_signature: dict[str, Any] = Field(
        sa_type=JSON,
        default_factory=lambda: {
            "bpm_min": 70,
            "bpm_max": 180,
            "lufs_target": -14.0,
            "lufs_tolerance": 1.0,
            "target_camelot_keys": [],
            "auto_reject_rules": {},
        },
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
    )
    logo_path: str | None = None
    plan: str = Field(default="free")  # "free" | "indie" | "pro"
    subscription_status: str = Field(default="active")  # "active" | "frozen" | "canceled"
    frozen_at: datetime | None = Field(default=None)
    churn_warning_sent: bool = Field(default=False)
    final_warning_sent: bool = Field(default=False)
    max_tracks_month: int = Field(default=10)
    max_emails_month: int = Field(default=0)
    hq_retention_days: int = Field(default=0)
    emails_sent_this_month: int = Field(default=0)
    emails_sent_month: int = Field(default=1)
    submission_title: str | None = None
    submission_description: str | None = None
    role: str = Field(default="label")  # "label" | "dj"
    polar_customer_id: str | None = None
    polar_subscription_id: str | None = None
    ask_instagram: bool = Field(default=False)
    ask_soundcloud: bool = Field(default=False)

    submissions: list["Submission"] = Relationship(back_populates="label")
    email_templates: list["EmailTemplate"] = Relationship(back_populates="label")


class Submission(SQLModel, table=True):
    """Audio track submission from a producer."""

    __tablename__ = "submission"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    label_id: str = Field(foreign_key="label.id", index=True)
    producer_name: str
    producer_email: str
    track_name: str
    bpm: float | None = None
    lufs: float | None = None
    duration: float | None = None
    phase_correlation: float | None = None
    musical_key: str | None = None
    true_peak: float | None = None
    crest_factor: float | None = None
    status: str = Field(default="inbox", index=True)  # inbox | shortlist | rejected | auto_rejected
    deleted_at: datetime | None = Field(default=None)
    human_email_sent: bool = Field(default=False)
    rejection_reason: str | None = None
    mp3_path: str | None = None
    original_path: str | None = None  # WAV/FLAC/AIFF original for download
    peaks: list[float] | None = Field(sa_type=JSON, default=None)  # Waveform peaks for WaveSurfer.js
    notes: str | None = None
    producer_instagram: str | None = Field(default=None)
    producer_soundcloud: str | None = Field(default=None)
    hq_downloaded: bool = Field(default=False)  # True once original file has been downloaded
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
    )

    label: Label = Relationship(back_populates="submissions")
    email_logs: list["EmailLog"] = Relationship(back_populates="submission")


class EmailTemplate(SQLModel, table=True):
    """Email template for automated notifications."""

    __tablename__ = "email_template"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    label_id: str = Field(foreign_key="label.id", index=True)
    name: str
    template_type: str = Field(index=True)  # rejection | approval | followup
    subject_template: str
    body_template: str

    label: Label = Relationship(back_populates="email_templates")
    email_logs: list["EmailLog"] = Relationship(back_populates="template")


class EmailLog(SQLModel, table=True):
    """Log of sent emails for audit and debugging."""

    __tablename__ = "email_log"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    submission_id: str = Field(foreign_key="submission.id", index=True)
    template_id: str | None = Field(foreign_key="email_template.id", nullable=True)
    sent_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
    )
    status: str  # sent | failed
    error: str | None = None

    submission: Submission = Relationship(back_populates="email_logs")
    template: EmailTemplate | None = Relationship(back_populates="email_logs")
