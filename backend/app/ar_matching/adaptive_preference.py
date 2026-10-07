"""Conservative adaptive preference learning from HUMAN A&R decisions (T06-D3).

**HUMAN DECISIONS ONLY.** This module learns one label-level preference
direction from the append-only ``label_ar_decisions`` history that humans
recorded — nothing else. The mandate reading of the closed vocabulary is
exact: ``shortlist`` contributes the POSITIVE direction and ``rejected``
contributes a conservative (damped) NEGATIVE direction. There is no neutral
vocabulary element and none is invented here.

**WHAT THIS IS NOT.** Raw cosine similarity scores anywhere in the system are
NEVER mutated by this module. The preference computed here is a separate,
documented value consumed only by the T07/T08 adaptive modes. It never feeds
auto-reject, auto-hide, or deprioritization of any submission, never implies
demo quality or hit probability, and never writes any table — the session is
read-only end to end and the caller owns the transaction.

**EVERY CONSTANT IS AN ADJUSTABLE PARAMETER, NOT PRODUCT POLICY.**
``half_life_days``, ``positive_weight``, ``negative_weight``, and
``cold_start_minimum`` are plain keyword arguments with defaults; no constant
here encodes a product decision.

Locked math (do not re-derive): decision rows for ``label_id`` are read
directly from ``LabelArDecisionRow`` (read-only SELECT on the row model; the
``ar_decisions`` service module is never imported). The latest decision per
``submission_id`` wins, ordered by ``decided_at`` then row ``id`` (last is
latest). Each latest-decided submission contributes its sub-arm aggregate
``MusicEmbedding`` (``submission_id IS NOT NULL``, ``reference_track_id IS
NULL``, ``segment_index == -1``, exact provider/model/version/dimension/
``pipeline_version``), wrapped through ``TrackEmbedding`` so stored vectors
renormalize through the shared unit-normalization fixed point. The weighted
sum is ``s = sum(sign * weight * exp(-ln2 * age_days / half_life_days) * x)``
over contributing submissions, with ``sign = +1`` for shortlist and
``sign = -negative_weight`` for rejected (conservative dampening), and
``age_days = max(0, (now - decided_at).total_seconds() / 86400)`` where naive
SQLite read-back of ``decided_at`` is repaired with ``replace(tzinfo=UTC)``
and future ``decided_at`` clamps age to zero. The preference is ``s`` divided
by its Euclidean norm (unit). A norm at or below 1e-12 (including zero
contributions) yields ``CANCELLED`` with preference ``None`` — it never
raises.

Counting semantics: ``positive_count``/``negative_count`` count the LATEST
decision kind per decided submission across ALL decided submissions,
including ones skipped for lacking a matching sub-arm aggregate.
``skipped_count`` counts decided submissions without a matching aggregate;
skips are counted but never gated. ``contributing_count`` counts decided
submissions whose aggregate was embedded (positives plus negatives that
actually contributed a vector). The cold-start gate applies to
``contributing_count`` only: below ``cold_start_minimum`` the state is
``COLD_START`` with preference ``None``.

Validation happens before the session is touched and uses the plain
``ValueError`` family consistent with catalog_fit_cache/catalog_fit_scores.
Behavior is SQLite-portable; PostgreSQL RLS and grants are asserted
structurally elsewhere.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlmodel import Session, select

from app.ar_matching.similarity import cosine_similarity
from app.ar_matching.storage_models import LabelArDecisionRow, MusicEmbedding
from app.audio.embedding.schemas import EmbeddingMetadata, TrackEmbedding

_CANCELLATION_NORM_TOLERANCE = 1e-12
_SECONDS_PER_DAY = 86400.0


class LabelPreferenceState(StrEnum):
    """Terminal learning states for one label's adaptive preference."""

    COLD_START = "cold_start"
    READY = "ready"
    CANCELLED = "cancelled"


@dataclass(frozen=True, slots=True)
class LabelPreferenceResult:
    """Immutable outcome of one adaptive-preference computation."""

    state: LabelPreferenceState
    preference: tuple[float, ...] | None
    positive_count: int
    negative_count: int
    skipped_count: int
    contributing_count: int


def _require_canonical_label_id(value: object) -> str:
    if type(value) is str:
        try:
            if str(UUID(value)) == value:
                return value
        except ValueError:
            pass
    raise ValueError("label_id must be a canonical UUID string")


def _require_positive_finite(value: object, field: str) -> float:
    if isinstance(value, (bool, str, bytes, complex)):
        raise ValueError(f"{field} must be a finite number greater than zero")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError(f"{field} must be a finite number greater than zero") from error
    if not math.isfinite(number) or number <= 0.0:
        raise ValueError(f"{field} must be a finite number greater than zero")
    return number


def _require_now(value: object) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("now must be None or a timezone-aware datetime")
    return value


def _as_utc(value: datetime) -> datetime:
    """Repair naive SQLite datetime read-back by attaching UTC."""
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=UTC)
    return value


def _vector_norm(vector: tuple[float, ...]) -> float:
    """Scale-safe Euclidean norm (extreme magnitudes never overflow)."""
    scale = max(abs(value) for value in vector)
    if scale == 0.0:
        return 0.0
    return math.hypot(*(value / scale for value in vector)) * scale


def compute_label_preference(
    session: Session,
    *,
    label_id: str,
    metadata: EmbeddingMetadata,
    pipeline_version: str,
    now: datetime | None = None,
    half_life_days: float = 30.0,
    positive_weight: float = 1.0,
    negative_weight: float = 0.25,
    cold_start_minimum: int = 3,
) -> LabelPreferenceResult:
    """Compute one label's conservative preference from HUMAN decisions only.

    Shortlist = positive direction; rejected = conservative-negative direction
    (damped by ``negative_weight``); the vocabulary is closed with no neutral.
    See the module docstring for the locked math and counting semantics: the
    preference is a separate documented value for the T07/T08 modes, raw
    cosine scores are never mutated, and nothing here auto-rejects, hides, or
    deprioritizes a submission.
    """
    owner = _require_canonical_label_id(label_id)
    if type(metadata) is not EmbeddingMetadata:
        raise ValueError("metadata must be EmbeddingMetadata")
    if not isinstance(pipeline_version, str) or not pipeline_version.strip():
        raise ValueError("pipeline_version must be a non-empty string")
    resolved_now = _require_now(now)
    validated_half_life = _require_positive_finite(half_life_days, "half_life_days")
    validated_positive = _require_positive_finite(positive_weight, "positive_weight")
    validated_negative = _require_positive_finite(negative_weight, "negative_weight")
    if type(cold_start_minimum) is not int or cold_start_minimum < 1:
        raise ValueError("cold_start_minimum must be an integer >= 1")

    decision_rows = session.exec(
        select(LabelArDecisionRow)
        .where(LabelArDecisionRow.label_id == owner)
        .order_by(LabelArDecisionRow.decided_at, LabelArDecisionRow.id)
    ).all()
    latest_by_submission: dict[str, LabelArDecisionRow] = {}
    for row in decision_rows:
        latest_by_submission[row.submission_id] = row

    aggregate_rows = session.exec(
        select(MusicEmbedding)
        .where(MusicEmbedding.label_id == owner)
        .where(MusicEmbedding.submission_id.is_not(None))
        .where(MusicEmbedding.reference_track_id.is_(None))
        .where(MusicEmbedding.segment_index == -1)
        .where(MusicEmbedding.provider == metadata.provider)
        .where(MusicEmbedding.model == metadata.model)
        .where(MusicEmbedding.version == metadata.version)
        .where(MusicEmbedding.dimension == metadata.dimension)
        .where(MusicEmbedding.pipeline_version == pipeline_version)
    ).all()
    aggregate_by_submission = {row.submission_id: row for row in aggregate_rows}

    reference_time = resolved_now if resolved_now is not None else datetime.now(UTC)
    decay_constant = math.log(2.0) / validated_half_life
    accumulated = [0.0] * metadata.dimension
    positive_count = 0
    negative_count = 0
    skipped_count = 0
    contributing_count = 0

    for submission_id, decision_row in latest_by_submission.items():
        shortlisted = decision_row.decision == "shortlist"
        if shortlisted:
            positive_count += 1
        else:
            negative_count += 1
        aggregate_row = aggregate_by_submission.get(submission_id)
        if aggregate_row is None:
            skipped_count += 1
            continue
        track = TrackEmbedding(
            metadata=metadata,
            vector=tuple(float(value) for value in aggregate_row.embedding),
            created_at=_as_utc(aggregate_row.created_at),
        )
        decided_at = _as_utc(decision_row.decided_at)
        age_days = max(0.0, (reference_time - decided_at).total_seconds() / _SECONDS_PER_DAY)
        decay = math.exp(-decay_constant * age_days)
        magnitude = decay * (validated_positive if shortlisted else -validated_negative)
        accumulated = [
            total + magnitude * value
            for total, value in zip(accumulated, track.vector, strict=True)
        ]
        contributing_count += 1

    norm = _vector_norm(tuple(accumulated))
    if contributing_count < cold_start_minimum:
        state = LabelPreferenceState.COLD_START
    elif norm <= _CANCELLATION_NORM_TOLERANCE:
        state = LabelPreferenceState.CANCELLED
    else:
        state = LabelPreferenceState.READY
    preference = (
        tuple(value / norm for value in accumulated)
        if state is LabelPreferenceState.READY
        else None
    )
    return LabelPreferenceResult(
        state=state,
        preference=preference,
        positive_count=positive_count,
        negative_count=negative_count,
        skipped_count=skipped_count,
        contributing_count=contributing_count,
    )


def preference_similarity(
    preference: tuple[float, ...],
    query_vector: tuple[float, ...] | list[float],
) -> float:
    """Raw cosine similarity between the unit preference and a query vector.

    Application of the preference is raw cosine similarity, never a quality
    or hit-probability judgment. Validation delegates entirely to
    :func:`similarity.cosine_similarity` semantics; only the preference's
    container type is checked here.
    """
    if not isinstance(preference, (tuple, list)):
        raise ValueError("preference must be a tuple or list of finite floats")
    return cosine_similarity(preference, query_vector)
