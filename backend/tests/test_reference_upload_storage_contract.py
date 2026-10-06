"""SQLite/source-contract tests for reservation and reference-storage identity.

These tests exercise portable row checks, not PostgreSQL migration execution,
RLS, concurrent DDL, or object-store behavior.
"""

from __future__ import annotations

import re
from itertools import combinations
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.ar_matching.storage_models import LabelReferenceTrack
from app.models import Label

_FIELDS = (
    "upload_idempotency_key",
    "upload_filename",
    "upload_size_bytes",
    "upload_limit_bytes",
    "staging_key",
)
_NEW_COLUMNS = (
    *_FIELDS,
    "staging_etag",
    "final_etag",
)
_NEW_CONSTRAINTS = (
    "uq_label_reference_tracks_label_upload_key",
    "ck_label_reference_tracks_upload_reservation_shape",
    "ck_label_reference_tracks_upload_size_bounds",
    "ck_label_reference_tracks_upload_text_nonempty",
    "ck_label_reference_tracks_upload_filename_suffix",
    "ck_label_reference_tracks_staging_key_identity",
    "ck_label_reference_tracks_staging_etag_reservation",
    "ck_label_reference_tracks_final_identity_pair",
    "ck_label_reference_tracks_processing_final_identity",
)


@pytest.fixture
def engine():
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(test_engine, "connect")
    def _enable_foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(
        test_engine, tables=[Label.__table__, LabelReferenceTrack.__table__]
    )
    yield test_engine
    SQLModel.metadata.drop_all(test_engine, tables=[LabelReferenceTrack.__table__, Label.__table__])
    test_engine.dispose()


def _new_label(session: Session, suffix: str) -> Label:
    token = str(uuid4())
    label = Label(
        id=token,
        name=f"Label {suffix}",
        slug=f"label-{suffix}-{token}",
        owner_email=f"{token}@example.test",
    )
    session.add(label)
    session.flush()
    return label


def _new_reference(
    label: Label,
    *,
    status: str = "uploaded",
    filename: str = "reference.AIF",
    **overrides,
) -> LabelReferenceTrack:
    reference_id = str(uuid4())
    if filename.lower().endswith((".aif", ".aiff")):
        extension = ".aiff"
    else:
        extension = filename[filename.rfind(".") :].lower()
    values = {
        "id": reference_id,
        "label_id": label.id,
        "title": "Reference",
        "status": status,
        "upload_idempotency_key": "request-token",
        "upload_filename": filename,
        "upload_size_bytes": 100,
        "upload_limit_bytes": 200,
        "staging_key": f"label-references/{label.id}/{reference_id}/staging/original{extension}",
    }
    values.update(overrides)
    return LabelReferenceTrack(**values)


def _finalize(reference: LabelReferenceTrack) -> None:
    reference.storage_key = f"label-references/{reference.label_id}/{reference.id}/original.aiff"
    reference.staging_etag = '"opaque-staging"'
    reference.final_etag = '"opaque-final"'


def _expect_integrity_failure(session: Session, row: LabelReferenceTrack) -> None:
    session.add(row)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_legacy_rows_keep_existing_status_and_storage_key_shapes(engine):
    statuses = ("uploaded", "processing", "ready", "failed")
    with Session(engine) as session:
        label = _new_label(session, "legacy")
        rows = [
            LabelReferenceTrack(
                label_id=label.id,
                title=f"Legacy {status}",
                status=status,
                storage_key=f"legacy/{status}.wav",
            )
            for status in statuses
        ]
        session.add_all(rows)
        session.commit()
        loaded = [session.get(LabelReferenceTrack, row.id) for row in rows]
        assert [row.status for row in loaded] == list(statuses)
        assert loaded[2].storage_key == "legacy/ready.wav"
        assert all(getattr(row, column) is None for row in loaded for column in _NEW_COLUMNS)
        assert all(row.processing_claim_token is None for row in loaded)


def test_multiple_null_tokens_and_same_token_across_labels_are_valid(engine):
    with Session(engine) as session:
        first_label = _new_label(session, "null-token")
        second_label = _new_label(session, "cross-label")
        legacy_rows = [
            LabelReferenceTrack(label_id=first_label.id, title=f"Legacy {index}")
            for index in range(3)
        ]
        first = _new_reference(first_label)
        second = _new_reference(second_label)
        first.upload_idempotency_key = second.upload_idempotency_key = "shared-token"
        session.add_all([*legacy_rows, first, second])
        session.commit()
        assert len([row for row in legacy_rows if row.upload_idempotency_key is None]) == 3


def test_same_label_cannot_reuse_nonnull_idempotency_token(engine):
    with Session(engine) as session:
        label = _new_label(session, "duplicate-token")
        first = _new_reference(label)
        session.add(first)
        session.commit()
        duplicate = _new_reference(label)
        duplicate.upload_idempotency_key = first.upload_idempotency_key
        _expect_integrity_failure(session, duplicate)


def test_reservation_tuple_accepts_only_all_five_or_none(engine):
    with Session(engine) as session:
        label = _new_label(session, "tuple-shape")
        session.commit()
        subsets = [
            subset for size in range(len(_FIELDS) + 1) for subset in combinations(_FIELDS, size)
        ]
        for index, subset in enumerate(subsets):
            selected = set(subset)
            row = _new_reference(label, title=f"Tuple {index}")
            for name in _FIELDS:
                if name not in selected:
                    setattr(row, name, None)
            if len(selected) in (0, len(_FIELDS)):
                session.add(row)
                session.commit()
            else:
                _expect_integrity_failure(session, row)


def test_staging_etag_requires_complete_reservation(engine):
    with Session(engine) as session:
        label = _new_label(session, "stage-etag")
        row = LabelReferenceTrack(
            label_id=label.id,
            title="No reservation",
            staging_etag='"opaque"',
        )
        _expect_integrity_failure(session, row)


@pytest.mark.parametrize("suffix", [".wav", ".FLAC", ".aiff", ".AIF"])
def test_supported_filename_suffixes_bind_canonical_staging_key(engine, suffix):
    with Session(engine) as session:
        label = _new_label(session, f"suffix-{suffix.strip('.').lower()}")
        filename = f"mix{suffix}"
        canonical = ".aiff" if suffix.lower() == ".aif" else suffix.lower()
        row = _new_reference(label, filename=filename)
        assert row.staging_key.endswith(f"/staging/original{canonical}")
        session.add(row)
        session.commit()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("upload_idempotency_key", "  "),
        ("upload_filename", "  "),
        ("staging_etag", "  "),
        ("final_etag", "  "),
    ],
)
def test_present_upload_identity_text_must_be_nonempty(engine, field, value):
    with Session(engine) as session:
        label = _new_label(session, f"blank-{field}")
        row = _new_reference(label)
        _finalize(row)
        setattr(row, field, value)
        _expect_integrity_failure(session, row)


@pytest.mark.parametrize("filename", ["mix.mp3", "mix.wav.tmp", ".wav", "mix."])
def test_unsupported_or_stemless_filename_suffix_is_rejected(engine, filename):
    with Session(engine) as session:
        label = _new_label(session, "bad-suffix")
        row = _new_reference(label, filename=filename)
        _expect_integrity_failure(session, row)


@pytest.mark.parametrize(
    ("size", "limit"),
    [
        (0, 100),
        (-1, 100),
        (101, 100),
        (1, 209_715_201),
        (1, 0),
        (1, -1),
        (1.5, 100),
        (1, 100.5),
    ],
)
def test_upload_sizes_must_be_positive_integral_ordered_and_capped(engine, size, limit):
    with Session(engine) as session:
        label = _new_label(session, "bad-size")
        row = _new_reference(label, upload_size_bytes=size, upload_limit_bytes=limit)
        _expect_integrity_failure(session, row)


def test_upload_size_accepts_the_exact_global_ceiling(engine):
    with Session(engine) as session:
        label = _new_label(session, "size-ceiling")
        row = _new_reference(
            label,
            upload_size_bytes=209_715_200,
            upload_limit_bytes=209_715_200,
        )
        session.add(row)
        session.commit()


def test_foreign_label_and_noncanonical_or_cross_owner_keys_are_rejected(engine):
    with Session(engine) as session:
        label = _new_label(session, "key-owner")
        other_label = _new_label(session, "other-key-owner")
        session.commit()
        missing_label_row = _new_reference(label, label_id=str(uuid4()))
        _expect_integrity_failure(session, missing_label_row)

        wrong_stage_label = _new_reference(label)
        wrong_stage_label.staging_key = (
            f"label-references/{other_label.id}/{wrong_stage_label.id}/staging/original.aiff"
        )
        _expect_integrity_failure(session, wrong_stage_label)

        wrong_stage_id = _new_reference(label)
        wrong_stage_id.staging_key = f"label-references/{label.id}/{uuid4()}/staging/original.aiff"
        _expect_integrity_failure(session, wrong_stage_id)


def test_staging_and_final_keys_must_be_exact_canonical_identities(engine):
    with Session(engine) as session:
        label = _new_label(session, "exact-keys")
        session.commit()
        staging_as_final = _new_reference(label)
        _finalize(staging_as_final)
        staging_as_final.storage_key = staging_as_final.staging_key
        _expect_integrity_failure(session, staging_as_final)

        wrong_final_extension = _new_reference(label, filename="mix.aif")
        _finalize(wrong_final_extension)
        wrong_final_extension.storage_key = (
            f"label-references/{label.id}/{wrong_final_extension.id}/original.aif"
        )
        _expect_integrity_failure(session, wrong_final_extension)

        wrong_stage_extension = _new_reference(label, filename="mix.aif")
        wrong_stage_extension.staging_key = (
            f"label-references/{label.id}/{wrong_stage_extension.id}/staging/original.aif"
        )
        _expect_integrity_failure(session, wrong_stage_extension)

        valid = _new_reference(label, filename="mix.aif", status="uploaded")
        _finalize(valid)
        session.add(valid)
        session.commit()


@pytest.mark.parametrize("status", ["processing", "ready"])
def test_processing_and_ready_require_complete_final_identity(engine, status):
    with Session(engine) as session:
        label = _new_label(session, f"incomplete-{status}")
        _expect_integrity_failure(session, _new_reference(label, status=status))


@pytest.mark.parametrize("status", ["processing", "ready", "failed"])
def test_complete_final_identity_is_valid_in_processing_ready_and_failed(engine, status):
    with Session(engine) as session:
        label = _new_label(session, f"final-{status}")
        row = _new_reference(label, status=status)
        _finalize(row)
        session.add(row)
        session.commit()


def test_final_identity_etag_and_storage_key_must_be_paired_and_staged(engine):
    with Session(engine) as session:
        label = _new_label(session, "partial-final")
        session.commit()
        only_storage_key = _new_reference(label)
        only_storage_key.storage_key = (
            f"label-references/{label.id}/{only_storage_key.id}/original.aiff"
        )
        _expect_integrity_failure(session, only_storage_key)

        only_final_etag = _new_reference(label)
        only_final_etag.final_etag = '"opaque"'
        _expect_integrity_failure(session, only_final_etag)

        final_without_staging_etag = _new_reference(label)
        _finalize(final_without_staging_etag)
        final_without_staging_etag.staging_etag = None
        _expect_integrity_failure(session, final_without_staging_etag)


def test_database_constraints_also_guard_updates(engine):
    with Session(engine) as session:
        label = _new_label(session, "update-check")
        row = _new_reference(label, status="ready")
        _finalize(row)
        session.add(row)
        session.commit()
        row.final_etag = None
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()


def test_migration_source_matches_model_and_is_manual_additive_contract():
    migration_path = Path(__file__).parents[1] / "migrations" / "010_reference_upload_identity.sql"
    sql = migration_path.read_text(encoding="utf-8").lower()
    model_columns = set(LabelReferenceTrack.__table__.columns.keys())
    model_constraints = {
        constraint.name for constraint in LabelReferenceTrack.__table__.constraints
    }
    assert set(_NEW_COLUMNS) <= model_columns
    assert set(_NEW_CONSTRAINTS) <= model_constraints
    assert all(len(name) <= 63 for name in _NEW_CONSTRAINTS)
    sql_types = {
        "upload_idempotency_key": ("varchar", str),
        "upload_filename": ("varchar", str),
        "upload_size_bytes": ("integer", int),
        "upload_limit_bytes": ("integer", int),
        "staging_key": ("varchar", str),
        "staging_etag": ("varchar", str),
        "final_etag": ("varchar", str),
    }
    for column, (sql_type, _python_type) in sql_types.items():
        assert re.search(rf"add\s+column\s+{column}\s+{sql_type}\b", sql)
        assert LabelReferenceTrack.__table__.c[column].nullable
        assert LabelReferenceTrack.__table__.c[column].type.python_type is _python_type
    for constraint in _NEW_CONSTRAINTS:
        assert constraint in sql

    executable = "\n".join(
        line for line in sql.splitlines() if line.strip() and not line.lstrip().startswith("--")
    )
    assert executable.lstrip().startswith("begin;")
    assert executable.rstrip().endswith("commit;")
    assert "lock table public.label_reference_tracks in access exclusive mode" in sql
    assert "to_regclass('public.label_reference_tracks')" in sql
    assert "pg_attribute" in sql and "attisdropped" in sql and "format_type" in sql
    assert "already has upload identity columns" in sql
    assert "conflicting" in sql
    assert not re.search(
        r"\b(?:add\s+(?:column|constraint)|create\s+(?:table|index))\s+if\s+not\s+exists\b",
        sql,
    )
    assert not re.search(
        r"\b(drop|grant|revoke|create\s+table|create\s+policy|enable\s+row\s+level\s+security|update\s+public\.label_reference_tracks)\b",
        executable,
    )
    assert "migration 009" in sql and "deployed state is unknown" in sql
    assert "stop-on-error" in sql and "etag" in sql and "opaque" in sql
    assert "rollback" in sql and "never delete stored data" in sql
    assert "label-references/" in sql
    assert "/staging/original" in sql and "/original" in sql
    assert "like" not in sql
    assert "substr(upload_filename, length(upload_filename) - 3, 4)" in sql
    assert "substr(upload_filename, length(upload_filename) - 4, 5)" in sql
    assert "when length(upload_filename) > 4 then case" in sql
    assert "when length(upload_filename) > 5 then case" in sql
    assert "= '.aif' then '.aiff'" in sql


def test_processing_claim_token_is_nullable_and_persists_opaque_value(engine):
    column = LabelReferenceTrack.__table__.c.processing_claim_token
    assert column.nullable
    assert column.type.python_type is str
    assert column.default is None

    with Session(engine) as session:
        label = _new_label(session, "claim-token")
        row = _new_reference(label, processing_claim_token=" opaque worker token ")
        session.add(row)
        session.commit()
        loaded = session.get(LabelReferenceTrack, row.id)
        assert loaded.processing_claim_token == " opaque worker token "


@pytest.mark.parametrize("value", ["", "   "])
def test_blank_processing_claim_tokens_are_rejected_by_database(engine, value):
    with Session(engine) as session:
        label = _new_label(session, "blank-claim-token")
        row = _new_reference(label, processing_claim_token=value)
        _expect_integrity_failure(session, row)


def test_processing_claim_migration_matches_nullable_model_contract():
    migration = Path(__file__).parents[1] / "migrations" / "011_reference_processing_claim.sql"
    sql = migration.read_text(encoding="utf-8").lower()
    column = LabelReferenceTrack.__table__.c.processing_claim_token
    constraint = next(
        item
        for item in LabelReferenceTrack.__table__.constraints
        if item.name == "ck_label_reference_tracks_processing_claim_token_nonempty"
    )
    assert column.nullable and column.type.python_type is str and column.default is None
    assert str(constraint.sqltext) == (
        "processing_claim_token IS NULL OR length(trim(processing_claim_token)) > 0"
    )
    assert re.search(r"add\s+column\s+processing_claim_token\s+text\b", sql)
    assert not re.search(r"add\s+column\s+processing_claim_token\s+text\s+not\s+null\b", sql)
    assert re.search(
        r"add\s+constraint\s+ck_label_reference_tracks_processing_claim_token_nonempty"
        r"\s+check\s*\(\s*processing_claim_token\s+is\s+null\s+or\s+"
        r"length\(trim\(processing_claim_token\)\)\s*>\s*0\s*\)",
        sql,
    )
    assert "deployed state is unknown" in sql and "acl/rls" in sql and "concurrency" in sql
    executable = "\n".join(
        line for line in sql.splitlines() if line.strip() and not line.lstrip().startswith("--")
    )
    assert executable.lstrip().startswith("begin;") and executable.rstrip().endswith("commit;")
    assert "to_regclass('public.label_reference_tracks')" in sql
    assert "attisdropped" in sql and "status" in sql
    assert not re.search(r"\bdefault\b|\bupdate\b|\binsert\b|\bdelete\b|\bdrop\b", executable)
    assert not re.search(r"\badd\s+(?:column|constraint)\s+if\s+not\s+exists\b", sql)
