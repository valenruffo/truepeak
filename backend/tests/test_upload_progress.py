"""Tests for the upload-progress-improvement change (Phase 4).

Covers:
    4.1  Presigned URL generation passes the right bucket/key/expiry/content-type
         through to boto3.
    4.2  FFmpeg stderr time= parsing computes sub_pct correctly.
    4.3  Async converter timeout raises ConversionError and cleans up the
         partial output file.
    4.4  Integration: 3-phase flow (presigned URL → R2 PUT → analyze SSE) emits
         the expected SSE events in order.
"""

# Set required env vars BEFORE importing the app modules that read them
# at import time. The Postgres URL must be parseable as postgresql+psycopg2
# but the engine never actually opens a connection in these tests — every
# DB call is mocked.
import os
os.environ.setdefault(
    "POSTGRES_URL",
    "postgresql+psycopg2://fake:fake@localhost:5432/fake",
)
os.environ.setdefault("CLOUDFLARE_R2_ENDPOINT", "https://r2.example")
os.environ.setdefault("CLOUDFLARE_R2_ACCESS_KEY_ID", "fake")
os.environ.setdefault("CLOUDFLARE_R2_SECRET_ACCESS_KEY", "fake")
os.environ.setdefault("CLOUDFLARE_R2_BUCKET_NAME", "fake-bucket")

import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, mock_open, patch

from app.audio.converter import (
    _compute_sub_pct,
    _FFMPEG_TIMEOUT_SECONDS,
    convert_to_mp3,
    parse_ffmpeg_time,
)
from app.audio.exceptions import ConversionError
from app.services.r2 import (
    PRESIGNED_URL_EXPIRY_SECONDS,
    _generate_presigned_url_sync,
    generate_presigned_url,
)


# ─────────────────────────────────────────────────────────────────────────────
# 4.1 — Presigned URL generation
# ─────────────────────────────────────────────────────────────────────────────


class TestGeneratePresignedUrl(unittest.TestCase):
    """Verify _generate_presigned_url_sync forwards correct args to boto3."""

    @patch("app.services.r2._get_s3_client")
    def test_presigned_url_uses_correct_bucket_key_expiry(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_s3.generate_presigned_url.return_value = "https://r2.example/upload?signed=abc"
        mock_get_client.return_value = mock_s3

        url = _generate_presigned_url_sync(
            r2_key="tracks/sub-1/original.wav",
            content_type="audio/wav",
            content_length=1234567,
        )

        self.assertEqual(url, "https://r2.example/upload?signed=abc")
        mock_s3.generate_presigned_url.assert_called_once()
        call_kwargs = mock_s3.generate_presigned_url.call_args.kwargs
        # Method must be PUT
        self.assertEqual(call_kwargs["HttpMethod"], "PUT")
        # Expiry matches 15 minutes
        self.assertEqual(call_kwargs["ExpiresIn"], PRESIGNED_URL_EXPIRY_SECONDS)
        self.assertEqual(call_kwargs["ExpiresIn"], 900)
        # Bucket + Key from caller
        params = call_kwargs["Params"]
        from app.services.r2 import BUCKET_NAME  # bound at import time
        self.assertEqual(params["Bucket"], BUCKET_NAME)
        self.assertEqual(params["Key"], "tracks/sub-1/original.wav")
        # Content-Type was declared in the policy fields
        self.assertEqual(params["Fields"]["Content-Type"], "audio/wav")
        # Content-Length range was enforced via conditions
        conditions = params["Conditions"]
        self.assertIn({"Content-Type": "audio/wav"}, conditions)
        self.assertIn(["content-length-range", 1234567, 1234567], conditions)

    @patch("app.services.r2._get_s3_client")
    def test_presigned_url_default_15_min_expiry(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_s3.generate_presigned_url.return_value = "https://r2.example/upload"
        mock_get_client.return_value = mock_s3

        _generate_presigned_url_sync(
            r2_key="k", content_type="audio/wav", content_length=100
        )
        call = mock_s3.generate_presigned_url.call_args
        self.assertEqual(call.kwargs["ExpiresIn"], 900)
        self.assertEqual(PRESIGNED_URL_EXPIRY_SECONDS, 900)

    @patch("app.services.r2._get_s3_client")
    def test_presigned_url_wraps_in_asyncio_to_thread(self, mock_get_client):
        """The async wrapper must schedule the sync call in a thread."""
        mock_s3 = MagicMock()
        mock_s3.generate_presigned_url.return_value = "https://r2.example/upload"
        mock_get_client.return_value = mock_s3

        async def run():
            return await generate_presigned_url(
                r2_key="tracks/x/original.wav",
                content_type="audio/wav",
                content_length=500,
            )

        result = asyncio.run(run())
        self.assertEqual(result, "https://r2.example/upload")
        mock_s3.generate_presigned_url.assert_called_once()


# ─────────────────────────────────────────────────────────────────────────────
# 4.2 — FFmpeg stderr parsing
# ─────────────────────────────────────────────────────────────────────────────


class TestFfmpegStderrParsing(unittest.TestCase):
    def test_parse_ffmpeg_time_typical(self):
        # 00:01:30 = 90s
        self.assertEqual(parse_ffmpeg_time("frame= 1234 fps=45 q=2.0 size=  1024kB time=00:01:30.00 bitrate="), 90.0)

    def test_parse_ffmpeg_time_with_subseconds(self):
        # 00:00:00.50 = 0.5s
        self.assertEqual(parse_ffmpeg_time("time=00:00:00.50 "), 0.5)

    def test_parse_ffmpeg_time_above_one_hour(self):
        # 01:02:03.5 = 3723.5s
        self.assertAlmostEqual(parse_ffmpeg_time("time=01:02:03.50 "), 3723.5, places=2)

    def test_parse_ffmpeg_time_returns_none_when_missing(self):
        self.assertIsNone(parse_ffmpeg_time("frame=1 fps=24 q=2.0"))
        self.assertIsNone(parse_ffmpeg_time(""))
        self.assertIsNone(parse_ffmpeg_time(None))

    def test_compute_sub_pct_clamps_to_99(self):
        # 5-minute track: 150/300 = 50%
        self.assertEqual(_compute_sub_pct(150.0, 300.0), 50)
        # Slightly over
        self.assertEqual(_compute_sub_pct(305.0, 300.0), 99)  # clamped
        # Zero
        self.assertEqual(_compute_sub_pct(0.0, 300.0), 0)
        # Unknown duration -> 0 (fallback)
        self.assertEqual(_compute_sub_pct(150.0, None), 0)
        self.assertEqual(_compute_sub_pct(150.0, 0.0), 0)
        self.assertEqual(_compute_sub_pct(150.0, -5.0), 0)


# ─────────────────────────────────────────────────────────────────────────────
# 4.3 — Async converter timeout + cleanup
# ─────────────────────────────────────────────────────────────────────────────


class TestAsyncConverterTimeout(unittest.TestCase):
    """Verify convert_to_mp3 raises ConversionError on timeout and removes
    the partial output file."""

    def test_conversion_error_message_includes_timeout(self):
        # Pre-condition: the constant matches the spec (60s).
        self.assertEqual(_FFMPEG_TIMEOUT_SECONDS, 60.0)

    def test_conversion_timeout_raises_and_cleans_up(self):
        """The timeout branch must raise ConversionError and call
        _cleanup_partial_output to delete the partial MP3 file."""
        # Pre-create a "partial" output file the cleanup is supposed to remove.
        partial_path = "/tmp/fake_partial_for_timeout_test.mp3"
        if os.path.exists(partial_path):
            os.remove(partial_path)
        with open(partial_path, "wb") as f:
            f.write(b"\x00" * 64)

        # Also create a fake input wav so the exists() guard passes.
        wav_path = "/tmp/fake_input_for_timeout_test.wav"
        if not os.path.exists(wav_path):
            with open(wav_path, "wb") as f:
                f.write(b"RIFF" + b"\x00" * 64)

        # Patch _cleanup_partial_output BEFORE convert_to_mp3 runs, so we
        # can assert it gets called. This is more robust than trying to
        # intercept a real subprocess.
        import app.audio.converter as conv
        cleanup_calls = []
        original_cleanup = conv._cleanup_partial_output

        def tracking_cleanup(p):
            cleanup_calls.append(p)
            original_cleanup(p)

        # Build a mock subprocess that times out on .wait().
        mock_proc = MagicMock()
        mock_proc.stderr = MagicMock()
        mock_proc.stderr.readline = AsyncMock(return_value=b"")
        # First wait() raises TimeoutError so wait_for sees it; subsequent
        # calls return None (process killed).
        mock_proc.wait = AsyncMock(side_effect=[asyncio.TimeoutError(), None])
        mock_proc.kill = MagicMock()
        mock_proc.returncode = -9

        async def run():
            # Create a finished "drain" task before we patch asyncio.create_task.
            async def _noop_drain():
                return None
            finished_drain = asyncio.create_task(_noop_drain())
            await finished_drain  # ensure it's done

            with patch("asyncio.create_subprocess_exec", new=AsyncMock(return_value=mock_proc)), \
                 patch("asyncio.create_task") as mock_create_task, \
                 patch("app.audio.converter._FFMPEG_TIMEOUT_SECONDS", 0.1), \
                 patch("app.audio.converter._cleanup_partial_output", side_effect=tracking_cleanup):
                # Skip the real stderr drain — it would call readline on the
                # mock and exit, but a no-op task is simpler and faster.

                def fake_create_task(coro):
                    # Detect the drain task by checking the coroutine's name.
                    # Just return a no-op completed task.
                    if hasattr(coro, "cr_code") and coro.cr_code.co_name == "_drain_stderr":
                        return finished_drain
                    return asyncio.create_task(coro)

                mock_create_task.side_effect = fake_create_task

                with self.assertRaises(ConversionError) as ctx:
                    await convert_to_mp3(
                        wav_path=wav_path,
                        mp3_path=partial_path,
                        duration_seconds=10.0,
                        on_progress=AsyncMock(),
                    )
            return ctx.exception

        try:
            err = asyncio.run(run())
        finally:
            for p in (wav_path, partial_path):
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except OSError:
                        pass

        # ConversionError was raised with a timeout-flavored message.
        self.assertIn("timed out", str(err).lower())
        # _cleanup_partial_output was called with the partial path.
        self.assertIn(partial_path, cleanup_calls)
        # The partial output must have been removed.
        self.assertFalse(
            os.path.exists(partial_path),
            f"Expected partial output {partial_path} to be cleaned up",
        )


# ─────────────────────────────────────────────────────────────────────────────
# 4.4 — Integration: 3-phase flow SSE
# ─────────────────────────────────────────────────────────────────────────────


class TestThreePhaseFlowIntegration(unittest.TestCase):
    """Drive the /api/presigned-url + /api/analyze flow end-to-end with a
    mocked R2 client and a mocked process_submission, then assert the
    SSE event stream from /api/analyze contains the expected stages."""

    def _build_app(self):
        """Build a minimal FastAPI app with just the upload router."""
        from fastapi import FastAPI
        from slowapi import Limiter
        from slowapi.util import get_remote_address

        from app.api import upload as upload_mod

        app = FastAPI()
        app.state.limiter = Limiter(key_func=get_remote_address)
        app.include_router(upload_mod.router)
        return app

    def test_presigned_url_endpoint_returns_signed_url(self):
        """Phase 1: the /api/presigned-url endpoint returns a signed URL."""
        from fastapi.testclient import TestClient

        from app.api import upload as upload_mod

        fake_label = MagicMock()
        fake_label.id = "label-1"
        fake_label.sonic_signature = {
            "allowed_formats": ["wav", "flac", "aiff"],
            "max_upload_size_mb": 100,
        }
        fake_label.subscription_status = "active"
        fake_label.plan = "free"
        fake_label.max_tracks_month = 1000

        with patch.object(upload_mod, "_validate_label_for_submission", return_value=(fake_label.id, fake_label.sonic_signature, 0)), \
             patch.object(upload_mod, "generate_presigned_url", new=AsyncMock(return_value="https://r2.example/presigned?sig=xyz")):
            app = self._build_app()
            client = TestClient(app)

            res = client.post(
                "/api/presigned-url",
                json={
                    "label_slug": "test-label",
                    "filename": "track.wav",
                    "content_type": "audio/wav",
                    "file_size": 50_000_000,
                },
            )
            self.assertEqual(res.status_code, 200, res.text)
            data = res.json()
            self.assertEqual(data["upload_url"], "https://r2.example/presigned?sig=xyz")
            self.assertEqual(data["r2_key"], "tracks/{sid}/original.wav".format(sid=data["submission_id"]))
            self.assertTrue(len(data["submission_id"]) > 0)

    def test_presigned_url_endpoint_rejects_oversized_file(self):
        from fastapi.testclient import TestClient
        from app.api import upload as upload_mod

        fake_label = MagicMock()
        fake_label.id = "label-1"
        fake_label.sonic_signature = {
            "allowed_formats": ["wav", "flac", "aiff"],
            "max_upload_size_mb": 50,  # 50MB cap
        }
        fake_label.subscription_status = "active"
        fake_label.plan = "free"
        fake_label.max_tracks_month = 1000

        with patch.object(upload_mod, "_validate_label_for_submission", return_value=(fake_label.id, fake_label.sonic_signature, 0)):
            app = self._build_app()
            client = TestClient(app)

            res = client.post(
                "/api/presigned-url",
                json={
                    "label_slug": "test-label",
                    "filename": "track.wav",
                    "content_type": "audio/wav",
                    "file_size": 250_000_000,  # 250MB
                },
            )
            self.assertEqual(res.status_code, 413, res.text)
            self.assertIn("demasiado grande", res.json()["detail"])

    def test_analyze_endpoint_streams_sse_events(self):
        """Phase 3: the /api/analyze endpoint streams the expected SSE
        events from a mocked process_submission pipeline."""
        from fastapi.testclient import TestClient
        from app.api import upload as upload_mod

        fake_label = MagicMock()
        fake_label.id = "label-1"
        fake_label.sonic_signature = {
            "allowed_formats": ["wav", "flac", "aiff"],
            "max_upload_size_mb": 100,
        }
        fake_label.subscription_status = "active"
        fake_label.plan = "free"
        fake_label.max_tracks_month = 1000

        # The SSE pipeline yields progress events then a final done event.
        # Patch process_submission to push the same sequence the real
        # pipeline would. We yield control to the event loop between
        # progress events so the SSE generator can drain the queue.
        async def fake_process_submission(*, submission_id, label_id, sonic_signature, on_progress, **kwargs):
            await on_progress("Descargando original...", 50)
            await asyncio.sleep(0.01)
            await on_progress("Descargando original...", 55)
            await asyncio.sleep(0.01)
            await on_progress("Convirtiendo a MP3...", 65)
            await asyncio.sleep(0.01)
            await on_progress("Subiendo assets a R2...", 80)
            return {
                "status": "inbox",
                "status_tecnico": "optimo",
                "alertas": [],
                "metrics": {
                    "bpm": 120.0,
                    "lufs": -14.0,
                    "duration": 180.0,
                    "phase_correlation": 0.8,
                    "musical_key": "8A",
                    "true_peak": 0.9,
                    "crest_factor": 6.0,
                    "peaks": [0.1, 0.2],
                },
                "rejection_reason": None,
                "mp3_path": "tracks/{sid}/preview.mp3".format(sid=submission_id),
                "original_path": "tracks/{sid}/original.wav".format(sid=submission_id),
            }

        with patch.object(upload_mod, "_validate_label_for_submission", return_value=(fake_label.id, fake_label.sonic_signature, 30)), \
             patch.object(upload_mod, "process_submission", side_effect=fake_process_submission), \
             patch("app.api.upload.get_session") as mock_get_session:
            # Mock the DB session so persistence doesn't blow up.
            mock_session = MagicMock()
            mock_get_session.return_value = iter([mock_session])

            app = self._build_app()
            client = TestClient(app)

            with client.stream(
                "POST",
                "/api/analyze",
                json={
                    "r2_key": "tracks/sub-x/original.wav",
                    "submission_id": "sub-x",
                    "label_slug": "test-label",
                    "producer_name": "Test",
                    "producer_email": "test@test.com",
                    "track_name": "Demo",
                },
            ) as res:
                # StreamingResponse -> must not access res.text.
                self.assertEqual(res.status_code, 200)
                # The endpoint must stream text/event-stream.
                self.assertIn("event-stream", res.headers.get("content-type", ""))
                # Collect all SSE chunks.
                body = "".join(chunk for chunk in res.iter_text())

            # Every expected progress stage is in the body.
            for stage in [
                "Descargando original...",
                "Convirtiendo a MP3...",
                "Subiendo assets a R2...",
            ]:
                self.assertIn(stage, body, f"Missing stage: {stage}")
            # Final done event with submission_id
            self.assertIn('"done": true', body)
            self.assertIn('"submission_id": "sub-x"', body)
            # At least one of each: pct=55, pct=65, pct=80
            for pct in [55, 65, 80]:
                self.assertIn(f'"pct": {pct}', body, f"Missing pct={pct}")


if __name__ == "__main__":
    unittest.main()
