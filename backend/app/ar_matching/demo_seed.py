"""DEMO-ONLY synthetic data writer for the catalog-fit demo arm (T05-D).

**This module is NOT the production write path.** It exists solely to seed
synthetic demo data so the catalog-fit demo query arm has eligible rows.

- The sole production producer of reference-arm embeddings remains
  ``app.ar_matching.reference_processing_publications`` (the reference arm).
- This module is the submission/demo arm's FIRST writer: it creates the one
  synthetic aggregate ``MusicEmbedding`` owned by the demo ``Submission``.
- Every vector written here is a SYNTHETIC deterministic unit vector with no
  audio, no OpenL3 run, and no inference provenance of any kind. NEVER claim
  real OpenL3 or inference provenance for rows written by this module.

Idempotency is SELECT-before-insert keyed on the deterministic label id: the
second call returns ``created=False`` with the SAME ids, writes nothing, and
never errors or partially writes on the skip path. Ids are uuid5 values from
the fixed module-level ``_DEMO_NAMESPACE`` over stable names, so repeated
seeding across processes yields identical ids.

Sessions are caller-owned (T05-C2 precedent): this module flushes inside the
caller's transaction and NEVER commits or rolls back. All ``created_at``
values are explicit tz-aware UTC datetimes taken once per call; because the
eligibility fingerprint folds in the max embedding ``created_at``, re-seeding
the same eligibility with a different call's timestamp would change the
fingerprint -- the idempotent skip path avoids that churn entirely.

Validation uses the plain ValueError family consistent with
catalog_fit_cache/catalog_fit_scores: ``reference_count`` must be an int
(bool excluded) >= 5, ``metadata`` must be exactly ``EmbeddingMetadata``, and
``pipeline_version`` must be a non-blank string. References use the
legacy-NULL identity branch (all upload/staging/final identity columns NULL)
so ``ready`` status passes the final-identity CHECKs. No compute/persist
composition, no provider or inference imports.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid5

from sqlmodel import Session, select

from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding
from app.audio.embedding.schemas import EmbeddingMetadata
from app.models import Label, Submission

_DEMO_NAMESPACE = UUID("3f2a1c9e-5b7d-4e8f-9c6a-1d0b2e4f6a8c")
_MIN_REFERENCE_COUNT = 5
_DEMO_DIMENSION = 512

_LABEL_STABLE_NAME = "demo-label"
_SUBMISSION_STABLE_NAME = "demo-submission"
_DEMO_LABEL_NAME = "Demo Label"
_DEMO_LABEL_SLUG = "demo-label"
_DEMO_LABEL_OWNER_EMAIL = "demo-label@demo.truepeak.test"
_DEMO_PRODUCER_NAME = "Demo Producer"
_DEMO_PRODUCER_EMAIL = "demo-producer@demo.truepeak.test"
_DEMO_TRACK_NAME = "Demo Submission Track"


@dataclass(frozen=True, slots=True)
class DemoSeedResult:
    """Deterministic ids for the seeded demo rows and whether rows were written."""

    label_id: str
    submission_id: str
    reference_ids: tuple[str, ...]
    created: bool


def _demo_id(stable_name: str) -> str:
    return str(uuid5(_DEMO_NAMESPACE, stable_name))


def _demo_unit_vector(stable_name: str) -> list[float]:
    """Deterministic SYNTHETIC 512-d unit vector; never inference output."""
    digest = uuid5(_DEMO_NAMESPACE, f"demo-direction-{stable_name}").int
    x = (digest % 997) + 1.0
    y = ((digest // 997) % 991) + 1.0
    norm = math.hypot(x, y)
    return [x / norm, y / norm, *([0.0] * (_DEMO_DIMENSION - 2))]


def _validate_scope(metadata: object, pipeline_version: object, reference_count: object) -> None:
    """Validate the full call scope before any session access."""
    if type(metadata) is not EmbeddingMetadata:
        raise ValueError("metadata must be EmbeddingMetadata")
    if not isinstance(pipeline_version, str) or not pipeline_version.strip():
        raise ValueError("pipeline_version must be a non-empty string")
    if type(reference_count) is not int or reference_count < _MIN_REFERENCE_COUNT:
        raise ValueError(f"reference_count must be an integer >= {_MIN_REFERENCE_COUNT}")


def seed_demo_catalog_data(
    session: Session,
    *,
    metadata: EmbeddingMetadata,
    pipeline_version: str,
    reference_count: int = 5,
) -> DemoSeedResult:
    """Seed the synthetic demo catalog rows inside the caller's transaction.

    Flushes only; never commits or rolls back. Returns ``created=False`` with
    the same deterministic ids when the demo label already exists.
    """
    _validate_scope(metadata, pipeline_version, reference_count)

    label_id = _demo_id(_LABEL_STABLE_NAME)
    submission_id = _demo_id(_SUBMISSION_STABLE_NAME)
    reference_ids = tuple(_demo_id(f"demo-reference-{index}") for index in range(reference_count))
    result = DemoSeedResult(
        label_id=label_id,
        submission_id=submission_id,
        reference_ids=reference_ids,
        created=True,
    )

    if session.exec(select(Label).where(Label.id == label_id)).first() is not None:
        return DemoSeedResult(
            label_id=result.label_id,
            submission_id=result.submission_id,
            reference_ids=result.reference_ids,
            created=False,
        )

    now = datetime.now(UTC)
    session.add(
        Label(
            id=label_id,
            name=_DEMO_LABEL_NAME,
            slug=_DEMO_LABEL_SLUG,
            owner_email=_DEMO_LABEL_OWNER_EMAIL,
            subscription_status="active",
            created_at=now,
            updated_at=now,
        )
    )
    session.flush()
    for index, reference_id in enumerate(reference_ids):
        session.add(
            LabelReferenceTrack(
                id=reference_id,
                label_id=label_id,
                title=f"Demo Reference {index + 1}",
                artist=None,
                status="ready",
                is_active=True,
                created_at=now,
                updated_at=now,
            )
        )
    session.add(
        Submission(
            id=submission_id,
            label_id=label_id,
            producer_name=_DEMO_PRODUCER_NAME,
            producer_email=_DEMO_PRODUCER_EMAIL,
            track_name=_DEMO_TRACK_NAME,
            created_at=now,
        )
    )
    # MusicEmbedding declares no Relationship to its parent tables, so the
    # unit of work cannot infer insert order from the FKs; flush the parents
    # explicitly before the embedding rows.
    session.flush()
    identity = {
        "provider": metadata.provider,
        "model": metadata.model,
        "version": metadata.version,
        "dimension": metadata.dimension,
        "pipeline_version": pipeline_version,
    }
    for index, reference_id in enumerate(reference_ids):
        session.add(
            MusicEmbedding(
                label_id=label_id,
                reference_track_id=reference_id,
                submission_id=None,
                embedding=_demo_unit_vector(f"demo-reference-{index}"),
                segment_index=-1,
                created_at=now,
                **identity,
            )
        )
    session.add(
        MusicEmbedding(
            label_id=label_id,
            reference_track_id=None,
            submission_id=submission_id,
            embedding=_demo_unit_vector(_SUBMISSION_STABLE_NAME),
            segment_index=-1,
            created_at=now,
            **identity,
        )
    )
    session.flush()
    return result
