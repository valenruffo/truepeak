"""Human A&R decision history for label demo submissions.

Human A&R decisions are the ONLY decision authority in this system: this
service records the history of those decisions and nothing more. It never
rejects, hides, or deprioritizes a demo automatically, never implies demo
quality or hit probability, and never writes Submission.status or any other
Submission column — it is read-only with respect to submissions.

Event semantics over the append-only ``label_ar_decisions`` history:

- Every accepted call appends one immutable row, except the exact-duplicate
  case below.
- Exact-duplicate suppression is per latest row: the latest row (ordered by
  ``decided_at`` then ``id``) for ``(label_id, submission_id)`` is compared
  to the incoming call, and only when BOTH ``decision`` AND ``decided_by``
  match is the call a re-affirmation rather than a new event — the existing
  record is returned with ``created=False`` and no row is appended. Any
  difference in decision or decided_by — or an empty history — appends a new
  row. ``note`` content does NOT participate in duplicate detection: a
  re-affirmation that only changes the note is still suppressed.
- "Latest wins" is derived by the caller: the current decision is the last
  element of :func:`list_label_ar_decisions`; there is no separate latest
  API on purpose.

Validation happens before the session is touched. ``note`` accepts any str
(including the empty string) or None, with no length cap, mirroring the
Submission.notes precedent; non-str non-None notes are rejected. Decisions
must be exactly ``'shortlist'`` or ``'rejected'`` — no normalization, no
case folding, and submission vocabulary states like ``'inbox'`` or
``'auto_rejected'`` are not decisions.

Session ownership: the caller owns the session. This module flushes (to
persist the row and let database constraints fire) but never commits or
rolls back, so surrounding caller transactions stay intact. Behavior here is
SQLite-portable; PostgreSQL RLS and grants are asserted structurally
elsewhere.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlmodel import Session, select

from app.ar_matching.storage_models import LabelArDecisionRow

_ALLOWED_DECISIONS = ("shortlist", "rejected")


@dataclass(frozen=True, slots=True)
class LabelArDecisionRecord:
    """Immutable snapshot of one recorded A&R decision event."""

    decision_id: str
    label_id: str
    submission_id: str
    decision: str
    decided_by: str
    decided_at: datetime
    note: str | None


@dataclass(frozen=True, slots=True)
class LabelArDecisionOutcome:
    """Result of recording a decision; ``created=False`` means suppressed."""

    record: LabelArDecisionRecord
    created: bool


def _require_canonical_uuid(value: object, field: str) -> str:
    if type(value) is not str:
        raise ValueError(f"{field} must be a canonical UUID string")
    try:
        parsed = UUID(value)
    except ValueError as exc:
        raise ValueError(f"{field} must be a canonical UUID string") from exc
    if str(parsed) != value:
        raise ValueError(f"{field} must be a canonical UUID string")
    return value


def _to_record(row: LabelArDecisionRow) -> LabelArDecisionRecord:
    return LabelArDecisionRecord(
        decision_id=row.id,
        label_id=row.label_id,
        submission_id=row.submission_id,
        decision=row.decision,
        decided_by=row.decided_by,
        decided_at=row.decided_at,
        note=row.note,
    )


def _history(session: Session, *, label_id: str, submission_id: str) -> list[LabelArDecisionRow]:
    return list(
        session.exec(
            select(LabelArDecisionRow)
            .where(LabelArDecisionRow.label_id == label_id)
            .where(LabelArDecisionRow.submission_id == submission_id)
            .order_by(LabelArDecisionRow.decided_at, LabelArDecisionRow.id)
        ).all()
    )


def record_label_ar_decision(
    session: Session,
    *,
    label_id: str,
    submission_id: str,
    decision: str,
    decided_by: str,
    note: str | None = None,
) -> LabelArDecisionOutcome:
    """Append one human A&R decision event, suppressing exact re-affirmations."""
    _require_canonical_uuid(label_id, "label_id")
    _require_canonical_uuid(submission_id, "submission_id")
    if type(decision) is not str or decision not in _ALLOWED_DECISIONS:
        raise ValueError("decision must be exactly 'shortlist' or 'rejected'")
    if type(decided_by) is not str or not decided_by.strip() or decided_by.strip() != decided_by:
        raise ValueError("decided_by must be a non-blank string without surrounding whitespace")
    if note is not None and type(note) is not str:
        raise ValueError("note must be a string or None")

    latest = _history(session, label_id=label_id, submission_id=submission_id)
    if latest:
        last = latest[-1]
        if last.decision == decision and last.decided_by == decided_by:
            return LabelArDecisionOutcome(record=_to_record(last), created=False)

    row = LabelArDecisionRow(
        label_id=label_id,
        submission_id=submission_id,
        decision=decision,
        decided_by=decided_by,
        decided_at=datetime.now(UTC),
        note=note,
    )
    session.add(row)
    session.flush()
    return LabelArDecisionOutcome(record=_to_record(row), created=True)


def list_label_ar_decisions(
    session: Session,
    *,
    label_id: str,
    submission_id: str,
) -> tuple[LabelArDecisionRecord, ...]:
    """Full decision history ordered by (decided_at, id); last element wins."""
    return tuple(
        _to_record(row) for row in _history(session, label_id=label_id, submission_id=submission_id)
    )


def list_label_decision_history(
    session: Session, *, label_id: str
) -> tuple[LabelArDecisionRecord, ...]:
    """Label-wide decision history across all submissions, ordered by (decided_at, id)."""
    rows = session.exec(
        select(LabelArDecisionRow)
        .where(LabelArDecisionRow.label_id == label_id)
        .order_by(LabelArDecisionRow.decided_at, LabelArDecisionRow.id)
    ).all()
    return tuple(_to_record(row) for row in rows)
