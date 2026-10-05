"""Standalone, additive SQLModel tables for label references and music embeddings.

Import this module explicitly when a caller needs the storage models. Existing
API and database startup paths do not register or use these tables.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlmodel import Field, SQLModel

from app.ar_matching.vector_type import Vector512


def _utc_now() -> datetime:
    return datetime.now(UTC)


class LabelReferenceTrack(SQLModel, table=True):
    """A label-owned reference recording; audio retention stays outside this model."""

    __tablename__ = "label_reference_tracks"
    __table_args__ = (
        UniqueConstraint("id", "label_id", name="uq_label_reference_tracks_id_label_id"),
        ForeignKeyConstraint(
            ["label_id"],
            ["label.id"],
            name="fk_label_reference_tracks_label",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "length(trim(title)) > 0",
            name="ck_label_reference_tracks_title_nonempty",
        ),
        CheckConstraint(
            "status IN ('uploaded', 'processing', 'ready', 'failed')",
            name="ck_label_reference_tracks_status",
        ),
        CheckConstraint(
            "duration_seconds IS NULL OR (duration_seconds >= 0 AND "
            "duration_seconds <= 1.7976931348623157e308)",
            name="ck_label_reference_tracks_duration",
        ),
        CheckConstraint(
            "storage_key IS NULL OR length(trim(storage_key)) > 0",
            name="ck_label_reference_tracks_storage_key",
        ),
        {"info": {"migration_managed": True}},
    )

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    label_id: str = Field(index=True)
    title: str
    artist: str | None = Field(default=None)
    storage_key: str | None = Field(default=None)
    duration_seconds: float | None = Field(default=None, sa_type=Float())
    status: str = Field(default="uploaded", sa_type=String())
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))


class MusicEmbedding(SQLModel, table=True):
    """One aggregate or segment vector owned by exactly one label reference/demo."""

    __tablename__ = "music_embeddings"
    __table_args__ = (
        ForeignKeyConstraint(
            ["label_id"],
            ["label.id"],
            name="fk_music_embeddings_label",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["reference_track_id", "label_id"],
            ["label_reference_tracks.id", "label_reference_tracks.label_id"],
            name="fk_music_embeddings_reference_track_label",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["submission_id", "label_id"],
            ["submission.id", "submission.label_id"],
            name="fk_music_embeddings_submission_label",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "(reference_track_id IS NOT NULL) <> (submission_id IS NOT NULL)",
            name="ck_music_embeddings_exactly_one_owner",
        ),
        CheckConstraint(
            "length(trim(provider)) > 0 AND length(trim(model)) > 0 AND "
            "length(trim(version)) > 0 AND length(trim(pipeline_version)) > 0",
            name="ck_music_embeddings_identity_nonempty",
        ),
        CheckConstraint("dimension = 512", name="ck_music_embeddings_dimension"),
        CheckConstraint(
            "segment_index >= -1 AND ((segment_index = -1 AND start_seconds IS NULL "
            "AND end_seconds IS NULL) OR (segment_index >= 0 AND start_seconds IS NOT NULL "
            "AND end_seconds IS NOT NULL AND start_seconds >= 0 AND "
            "start_seconds <= 1.7976931348623157e308 AND end_seconds > start_seconds AND "
            "end_seconds <= 1.7976931348623157e308))",
            name="ck_music_embeddings_segment_bounds",
        ),
        Index(
            "uq_music_embeddings_reference_identity",
            "label_id",
            "reference_track_id",
            "segment_index",
            "provider",
            "model",
            "version",
            "dimension",
            "pipeline_version",
            unique=True,
            postgresql_where=text("reference_track_id IS NOT NULL"),
            sqlite_where=text("reference_track_id IS NOT NULL"),
        ),
        Index(
            "uq_music_embeddings_submission_identity",
            "label_id",
            "submission_id",
            "segment_index",
            "provider",
            "model",
            "version",
            "dimension",
            "pipeline_version",
            unique=True,
            postgresql_where=text("submission_id IS NOT NULL"),
            sqlite_where=text("submission_id IS NOT NULL"),
        ),
        {"info": {"migration_managed": True}},
    )

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    label_id: str
    reference_track_id: str | None = Field(default=None, sa_type=String())
    submission_id: str | None = Field(default=None, sa_type=String())
    embedding: list[float] = Field(sa_type=Vector512())
    provider: str
    model: str
    version: str
    dimension: int = Field(sa_type=Integer())
    pipeline_version: str
    segment_index: int = Field(default=-1, sa_type=Integer())
    start_seconds: float | None = Field(default=None, sa_type=Float())
    end_seconds: float | None = Field(default=None, sa_type=Float())
    created_at: datetime = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))
