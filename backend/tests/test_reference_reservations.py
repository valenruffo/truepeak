"""Source-level unit tests for tenant-scoped reference upload reservations.

The SQLite fixture models the additive label/reference tables only. Integrity
race cases use deterministic seams; they do not claim PostgreSQL concurrency.
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError, replace
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.ar_matching import reference_reservations as reservations
from app.ar_matching.reference_reservations import (
    ReferenceLabelNotFoundError,
    ReferenceReservationConflictError,
    ReferenceReservationSessionError,
    ReferenceReservationValidationError,
    reserve_reference_upload,
)
from app.ar_matching.reference_validation import validate_reference_upload
from app.ar_matching.storage_models import LabelReferenceTrack
from app.models import Label, Notification

_LABEL_ID = "abcdefab-cdef-4abc-8def-abcdefabcdef"
_OTHER_LABEL_ID = "fedcbafe-dcba-4fed-8cba-fedcbafedcba"
_TOKEN = "01234567-89ab-4cde-8f01-23456789abcd"
_MISSING_LABEL_ID = "98765432-10fe-4dcb-8fed-9876543210fe"


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
        test_engine,
        tables=[Label.__table__, Notification.__table__, LabelReferenceTrack.__table__],
    )
    with Session(test_engine) as session:
        session.add_all(
            [
                Label(
                    id=label_id,
                    name=f"Label {index}",
                    slug=f"label-{index}-{uuid4()}",
                    owner_email=f"{uuid4()}@example.test",
                )
                for index, label_id in enumerate((_LABEL_ID, _OTHER_LABEL_ID))
            ]
        )
        session.commit()

    yield test_engine
    SQLModel.metadata.drop_all(
        test_engine,
        tables=[LabelReferenceTrack.__table__, Notification.__table__, Label.__table__],
    )
    test_engine.dispose()


def _upload(*, filename: str = "reference.AIF", size: int = 128, limit: int = 1_024):
    return validate_reference_upload(filename, size, max_size_bytes=limit)


def _reserve(
    session: Session,
    label_id: str = _LABEL_ID,
    *,
    token: str = _TOKEN,
    title: str = "  Reference title  ",
    artist: str | None = "  Reference artist  ",
    filename: str = "reference.AIF",
    size: int = 128,
    limit: int = 1_024,
):
    return reserve_reference_upload(
        session,
        label_id=label_id,
        idempotency_key=token,
        title=title,
        artist=artist,
        upload=_upload(filename=filename, size=size, limit=limit),
    )


def _rows(session: Session) -> list[LabelReferenceTrack]:
    return list(session.execute(select(LabelReferenceTrack)).scalars())


def test_first_reservation_persists_canonical_identity_and_returns_snapshot(engine):
    with Session(engine) as session:
        result = _reserve(session)

    assert result.status == "uploaded"
    assert result.reused is False
    assert result.metadata.title == "Reference title"
    assert result.metadata.artist == "Reference artist"
    assert result.metadata.filename == "reference.AIF"
    assert result.metadata.canonical_extension == ".aiff"
    assert result.metadata.canonical_mime == "audio/aiff"
    assert result.metadata.size_bytes == 128
    assert result.metadata.effective_limit_bytes == 1_024
    assert result.staging_key == (f"label-references/{_LABEL_ID}/{result.id}/staging/original.aiff")
    assert not hasattr(result, "presigned_url")

    with Session(engine) as session:
        [row] = _rows(session)
        assert row.id == result.id
        assert row.label_id == _LABEL_ID
        assert row.upload_idempotency_key == _TOKEN
        assert row.upload_filename == "reference.AIF"
        assert row.upload_size_bytes == 128
        assert row.upload_limit_bytes == 1_024
        assert row.staging_key == result.staging_key
        assert row.status == "uploaded" and row.is_active is True
        assert row.staging_etag is None
        assert row.final_etag is None and row.storage_key is None

    with pytest.raises(FrozenInstanceError):
        result.status = "ready"


def test_normalized_same_payload_reuses_single_reservation(engine):
    with Session(engine) as session:
        first = _reserve(session)
    with Session(engine) as session:
        second = _reserve(
            session,
            title="Reference title",
            artist="Reference artist",
        )

    assert second.reused is True
    assert second.id == first.id
    assert second.staging_key == first.staging_key
    with Session(engine) as session:
        assert len(_rows(session)) == 1


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "Different title"},
        {"artist": "Different artist"},
        {"filename": "different.wav"},
        {"size": 129},
        {"limit": 2_048},
    ],
    ids=["title", "artist", "filename", "size", "limit"],
)
def test_same_token_with_different_payload_conflicts_without_overwrite(engine, changes):
    with Session(engine) as session:
        original = _reserve(session)
    with Session(engine) as session:
        pytest.raises(ReferenceReservationConflictError, lambda: _reserve(session, **changes))

    with Session(engine) as session:
        [row] = _rows(session)
        assert row.id == original.id
        assert row.title == "Reference title"
        assert row.artist == "Reference artist"
        assert row.upload_filename == "reference.AIF"
        assert row.upload_size_bytes == 128
        assert row.upload_limit_bytes == 1_024


def test_same_token_is_scoped_to_each_label(engine):
    with Session(engine) as session:
        first = _reserve(session, _LABEL_ID)
    with Session(engine) as session:
        second = _reserve(session, _OTHER_LABEL_ID)

    assert first.id != second.id
    assert first.staging_key.startswith(f"label-references/{_LABEL_ID}/")
    assert second.staging_key.startswith(f"label-references/{_OTHER_LABEL_ID}/")
    with Session(engine) as session:
        assert len(_rows(session)) == 2


def test_missing_owner_and_noncanonical_uuids_are_rejected_before_insert(engine):
    with Session(engine) as session:
        pytest.raises(ReferenceLabelNotFoundError, _reserve, session, _MISSING_LABEL_ID)
    assert _LABEL_ID.upper() != _LABEL_ID
    assert _TOKEN.upper() != _TOKEN
    for label_id, token in (
        ("not-a-uuid", _TOKEN),
        (_LABEL_ID.upper(), _TOKEN),
        (_LABEL_ID.replace("-", ""), _TOKEN),
        ("{" + _LABEL_ID + "}", _TOKEN),
        (_LABEL_ID, "not-a-uuid"),
        (_LABEL_ID, _TOKEN.upper()),
    ):
        with Session(engine) as session:
            pytest.raises(
                ReferenceReservationValidationError,
                lambda label_id=label_id, token=token: _reserve(session, label_id, token=token),
            )

    with Session(engine) as session:
        assert _rows(session) == []


@pytest.mark.parametrize(
    ("title", "artist"),
    [("  ", None), ("Song", 4), (True, None), ("Song", True)],
)
def test_invalid_title_or_artist_is_rejected_before_insert(engine, title, artist):
    with Session(engine) as session:
        pytest.raises(
            ReferenceReservationValidationError,
            lambda: _reserve(session, title=title, artist=artist),
        )
    with Session(engine) as session:
        assert _rows(session) == []


@pytest.mark.parametrize(
    "forged",
    [replace(_upload(), canonical_extension=".wav"), replace(_upload(), size_bytes=True)],
    ids=["extension", "boolean-size"],
)
def test_forged_validated_upload_metadata_is_rejected(engine, forged):
    with Session(engine) as session:
        pytest.raises(
            ReferenceReservationValidationError,
            lambda: reserve_reference_upload(
                session,
                label_id=_LABEL_ID,
                idempotency_key=_TOKEN,
                title="Valid title",
                artist=None,
                upload=forged,
            ),
        )
    with Session(engine) as session:
        assert _rows(session) == []


def test_inactive_reservation_conflicts_and_is_not_resurrected(engine):
    with Session(engine) as session:
        original = _reserve(session)
    with Session(engine) as session:
        row = session.get(LabelReferenceTrack, original.id)
        row.is_active = False
        session.commit()
    with Session(engine) as session:
        pytest.raises(ReferenceReservationConflictError, _reserve, session)

    with Session(engine) as session:
        [row] = _rows(session)
        assert row.id == original.id and row.is_active is False
        assert row.status == "uploaded"


@pytest.mark.parametrize("status", ["processing", "ready"])
def test_existing_processing_or_ready_row_is_returned_without_claiming_new_upload(engine, status):
    with Session(engine) as session:
        original = _reserve(session)
    with Session(engine) as session:
        row = session.get(LabelReferenceTrack, original.id)
        row.status = status
        row.staging_etag = '"staging"'
        row.final_etag = '"final"'
        row.storage_key = f"label-references/{_LABEL_ID}/{row.id}/original.aiff"
        session.commit()
    with Session(engine) as session:
        existing = _reserve(session)

    assert existing.reused is True
    assert existing.status == status
    assert existing.id == original.id
    assert existing.staging_key == original.staging_key
    assert not hasattr(existing, "upload_url")


def test_caller_session_state_is_rejected_without_rollback_or_mutation(engine):
    with Session(engine) as session:
        pending = Label(
            id=str(uuid4()),
            name="Pending",
            slug=f"pending-{uuid4()}",
            owner_email=f"{uuid4()}@example.test",
        )
        session.add(pending)
        pytest.raises(ReferenceReservationSessionError, _reserve, session)
        assert pending in session.new

    with Session(engine) as session:
        session.begin()
        pytest.raises(ReferenceReservationSessionError, _reserve, session)
        assert session.in_transaction()
        session.rollback()

    with Session(engine) as session:
        label = session.get(Label, _LABEL_ID)
        label.name = "Caller change"
        pytest.raises(ReferenceReservationSessionError, _reserve, session)
        assert label in session.dirty
        assert label.name == "Caller change"
        session.rollback()

    with Session(engine) as session:
        label = session.get(Label, _LABEL_ID)
        session.delete(label)
        pytest.raises(ReferenceReservationSessionError, _reserve, session)
        assert label in session.deleted
        session.rollback()


def _competing_row(label_id: str, token: str) -> LabelReferenceTrack:
    reference_id = str(uuid4())
    return LabelReferenceTrack(
        id=reference_id,
        label_id=label_id,
        title="Reference title",
        artist="Reference artist",
        upload_idempotency_key=token,
        upload_filename="reference.AIF",
        upload_size_bytes=128,
        upload_limit_bytes=1_024,
        staging_key=(f"label-references/{label_id}/{reference_id}/staging/original.aiff"),
        status="uploaded",
        is_active=True,
        created_at=datetime.now(UTC),
    )


def test_unique_insert_race_reuses_matching_scoped_row_with_deterministic_seams(
    engine, monkeypatch
):
    competitor = _competing_row(_LABEL_ID, _TOKEN)
    lookup_count = 0

    def lookup(_session, _label_id, _token):
        nonlocal lookup_count
        lookup_count += 1
        return None if lookup_count == 1 else competitor

    injected = IntegrityError("INSERT", {}, Exception("injected unique conflict"))

    def fail_flush(_session, _row):
        raise injected

    monkeypatch.setattr(reservations, "_find_reservation", lookup)
    monkeypatch.setattr(reservations, "_flush_reservation", fail_flush)
    with Session(engine) as session:
        result = _reserve(session)

    assert result.id == competitor.id
    assert result.reused is True
    assert result.staging_key == competitor.staging_key
    assert lookup_count == 2


def test_unrelated_integrity_error_is_reraised_when_retry_finds_no_row(engine, monkeypatch):
    injected = IntegrityError("INSERT", {}, Exception("injected unrelated constraint"))
    monkeypatch.setattr(reservations, "_find_reservation", lambda *_args: None)

    def fail_flush(_session, _row):
        raise injected

    monkeypatch.setattr(reservations, "_flush_reservation", fail_flush)
    with Session(engine) as session:
        raised = pytest.raises(IntegrityError, _reserve, session)

    assert raised.value is injected
