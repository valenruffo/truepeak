"""Offline guard and helper tests for the operator R2 smoke harness script.

No network, cloud SDK calls, or worker CAS coverage here: only pure parsing,
preflight refusals, receipt-derived cleanup keys, fixture bounds, cleanup
attribution, exit-code mapping, and the no-secret summary formatter.
"""

from __future__ import annotations

import importlib.util
import io
import sys
from pathlib import Path
from uuid import uuid4

import pytest
import soundfile as sf

from app.ar_matching.reference_processing_claims import (
    ReferenceProcessingClaimReceipt,
)
from app.ar_matching.reference_validation import ValidatedReferenceUpload

_SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "reference_worker_r2_smoke.py"
_SPEC = importlib.util.spec_from_file_location("reference_worker_r2_smoke", _SCRIPT_PATH)
assert _SPEC is not None and _SPEC.loader is not None
smoke = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = smoke
_SPEC.loader.exec_module(smoke)


def _environ():
    return {
        "LABEL_REFERENCE_R2_BUCKET_NAME": "truepeak-label-references",
        "LABEL_REFERENCE_R2_PRIVATE_ACCESS_CONFIRMED": "true",
        "CLOUDFLARE_R2_BUCKET_NAME": "truepeak-assets",
        "CLOUDFLARE_R2_ENDPOINT": "https://smoke.invalid",
        "CLOUDFLARE_R2_ACCESS_KEY_ID": "smoke-access-key-id",
        "CLOUDFLARE_R2_SECRET_ACCESS_KEY": "smoke-secret-access-key",
    }


def _receipt():
    label = str(uuid4())
    reference = str(uuid4())
    upload = ValidatedReferenceUpload(
        filename="smoke-reference.wav",
        canonical_extension=".wav",
        canonical_mime="audio/wav",
        size_bytes=192_044,
        effective_limit_bytes=256 * 1024,
    )
    return ReferenceProcessingClaimReceipt(
        label_id=label,
        reference_id=reference,
        title="R2 smoke reference",
        artist=None,
        upload=upload,
        staging_key=f"label-references/{label}/{reference}/staging/original.wav",
        staging_etag='"smoke-stage-etag"',
        final_key=f"label-references/{label}/{reference}/original.wav",
        final_etag='"smoke-final-etag"',
        processing_claim_token="smoke-token",
    )


def test_parse_refuses_missing_attestation():
    environ = _environ()
    del environ["LABEL_REFERENCE_R2_PRIVATE_ACCESS_CONFIRMED"]
    with pytest.raises(smoke.SmokeRefusalError):
        smoke.parse_smoke_config(environ, "truepeak-label-references")


def test_parse_refuses_unconfirmed_attestation():
    environ = _environ() | {"LABEL_REFERENCE_R2_PRIVATE_ACCESS_CONFIRMED": "false"}
    with pytest.raises(smoke.SmokeRefusalError):
        smoke.parse_smoke_config(environ, "truepeak-label-references")


def test_parse_refuses_shared_bucket_name():
    environ = _environ() | {"CLOUDFLARE_R2_BUCKET_NAME": "truepeak-label-references"}
    with pytest.raises(smoke.SmokeRefusalError):
        smoke.parse_smoke_config(environ, "truepeak-label-references")


def test_parse_accepts_attestation_one_and_maps_environ():
    environ = _environ() | {"LABEL_REFERENCE_R2_PRIVATE_ACCESS_CONFIRMED": "1"}
    config = smoke.parse_smoke_config(environ, "truepeak-label-references")
    assert config["LABEL_REFERENCE_R2_BUCKET_NAME"] == "truepeak-label-references"
    assert config["CLOUDFLARE_R2_BUCKET_NAME"] == "truepeak-assets"
    assert config["CLOUDFLARE_R2_ACCESS_KEY_ID"] == "smoke-access-key-id"
    assert set(config) == set(environ)


def test_receipt_contract_derives_exact_cleanup_keys():
    receipt = _receipt()
    staging, final = smoke.cleanup_keys_from_receipt(receipt)
    assert (staging, final) == (receipt.staging_key, receipt.final_key)
    assert staging != final


def test_wav_fixture_is_small_mono_nonsilent():
    wav = smoke.build_wav_fixture()
    assert 0 < len(wav) <= 256 * 1024
    info = sf.info(io.BytesIO(wav))
    assert info.frames == 96_000 and info.channels == 1 and info.samplerate == 48_000
    audio, _rate = sf.read(io.BytesIO(wav))
    assert float(abs(audio).max()) > 0.0


def test_plan_cleanup_deletes_only_recorded_keys():
    receipt = _receipt()
    staging, final = smoke.cleanup_keys_from_receipt(receipt)
    recorded = (
        (staging, receipt.staging_etag),
        (final, receipt.final_etag),
    )
    plan = smoke.plan_cleanup(recorded, pipeline_succeeded=True, identities_match=True)
    assert plan.deletes == (
        (staging, receipt.staging_etag),
        (final, receipt.final_etag),
    )
    assert plan.retained_keys == ()


def test_plan_cleanup_retains_on_failure():
    plan = smoke.plan_cleanup(
        (("kept/key", '"etag"'),), pipeline_succeeded=False, identities_match=True
    )
    assert plan.deletes == () and plan.retained_keys == ("kept/key",)
    assert plan.retained_reason


def test_plan_cleanup_retains_on_identity_drift():
    plan = smoke.plan_cleanup(
        (("drifted/key", None),), pipeline_succeeded=True, identities_match=False
    )
    assert plan.deletes == () and plan.retained_keys == ("drifted/key",)
    assert plan.retained_reason


def test_exit_codes_map_operator_outcomes():
    assert smoke.exit_code_for(succeeded=True, cleaned=True) == 0
    assert smoke.exit_code_for(succeeded=True, cleaned=False) == 3
    assert smoke.exit_code_for(succeeded=False, cleaned=False) == 4


def test_summary_formatter_never_prints_secrets():
    config = smoke.parse_smoke_config(_environ(), "truepeak-label-references")
    text = smoke.format_summary(
        config,
        staging_key="staging/key",
        final_key="final/key",
        succeeded=True,
        cleaned=True,
    )
    assert "staging/key" in text and "truepeak-assets" in text
    assert "smoke-access-key-id" not in text and "smoke-secret-access-key" not in text
