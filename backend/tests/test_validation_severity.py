import asyncio
import math
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.audio.lifecycle import calculate_technical_status, process_submission


class TestValidationSeverity(unittest.TestCase):
    def test_calculate_technical_status_optimo(self):
        # Happy path - True Peak = -0.5 dB (amplitude = 10 ** (-0.5 / 20) = ~0.944), Crest Factor = 6.0, Phase = 0.8
        metrics = {
            "true_peak": 10 ** (-0.5 / 20.0),
            "crest_factor": 6.0,
            "phase_correlation": 0.8,
        }
        status, alertas = calculate_technical_status(metrics)
        self.assertEqual(status, "optimo")
        self.assertEqual(len(alertas), 0)

    def test_calculate_technical_status_warning_true_peak(self):
        # Warning path - True Peak = 0.5 dB, Crest Factor = 6.0, Phase = 0.8
        metrics = {
            "true_peak": 10 ** (0.5 / 20.0),
            "crest_factor": 6.0,
            "phase_correlation": 0.8,
        }
        status, alertas = calculate_technical_status(metrics)
        self.assertEqual(status, "warning")
        self.assertTrue(any("True Peak alto" in a for a in alertas))

    def test_calculate_technical_status_warning_crest_factor(self):
        # Warning path - True Peak = -1.0 dB, Crest Factor = 4.2, Phase = 0.8
        metrics = {
            "true_peak": 10 ** (-1.0 / 20.0),
            "crest_factor": 4.2,
            "phase_correlation": 0.8,
        }
        status, alertas = calculate_technical_status(metrics)
        self.assertEqual(status, "warning")
        self.assertTrue(any("Crest Factor" in a for a in alertas))

    def test_calculate_technical_status_critico_phase(self):
        # Critical path - Negative phase correlation
        metrics = {
            "true_peak": 10 ** (-1.0 / 20.0),
            "crest_factor": 6.0,
            "phase_correlation": -0.2,
        }
        status, alertas = calculate_technical_status(metrics)
        self.assertEqual(status, "critico")
        self.assertTrue(any("Falla de fase" in a for a in alertas))

    def test_calculate_technical_status_critico_true_peak(self):
        # Critical path - True Peak = 2.5 dB
        metrics = {
            "true_peak": 10 ** (2.5 / 20.0),
            "crest_factor": 6.0,
            "phase_correlation": 0.8,
        }
        status, alertas = calculate_technical_status(metrics)
        self.assertEqual(status, "critico")
        self.assertTrue(any("True Peak crítico" in a for a in alertas))

    def test_calculate_technical_status_critico_crest_factor(self):
        # Critical path - Crest Factor = 3.5
        metrics = {
            "true_peak": 10 ** (-1.0 / 20.0),
            "crest_factor": 3.5,
            "phase_correlation": 0.8,
        }
        status, alertas = calculate_technical_status(metrics)
        self.assertEqual(status, "critico")
        self.assertTrue(any("Crest Factor" in a for a in alertas))

    @patch("app.audio.lifecycle.analyze_audio", new_callable=AsyncMock)
    @patch("app.audio.lifecycle.convert_to_mp3")
    @patch("app.audio.lifecycle.upload_file_to_r2", new_callable=AsyncMock)
    @patch("app.audio.lifecycle.upload_bytes_to_r2", new_callable=AsyncMock)
    @patch("app.audio.lifecycle._safe_remove")
    def test_process_submission_warning_lifecycle(
        self, mock_remove, mock_upload_bytes, mock_upload_file, mock_convert, mock_analyze
    ):
        async def run():
            # Warning track -> True Peak warning
            mock_analyze.return_value = {
                "true_peak": 10 ** (0.5 / 20.0),
                "crest_factor": 6.0,
                "phase_correlation": 0.8,
                "bpm": 120,
                "lufs": -14.0,
                "peaks": [0.1, 0.2],
                "duration": 180.0,
            }
            sonic_sig = {
                "auto_reject_enabled": True,
            }
            res = await process_submission(
                file_path="dummy.wav",
                submission_id="sub_warn",
                label_id="label_1",
                sonic_signature=sonic_sig,
            )
            # Warning tracks proceed with normal upload
            self.assertEqual(res["status_tecnico"], "warning")
            self.assertEqual(res["status"], "inbox")
            mock_convert.assert_called_once()
            mock_upload_file.assert_any_call("/tmp/sub_warn.mp3", "tracks/sub_warn/preview.mp3", "audio/mpeg")

        asyncio.run(run())

    @patch("app.audio.lifecycle.analyze_audio", new_callable=AsyncMock)
    @patch("app.audio.lifecycle.convert_to_mp3")
    @patch("app.audio.lifecycle.upload_file_to_r2", new_callable=AsyncMock)
    @patch("app.audio.lifecycle.upload_bytes_to_r2", new_callable=AsyncMock)
    @patch("app.audio.lifecycle._safe_remove")
    def test_process_submission_critico_auto_reject_active(
        self, mock_remove, mock_upload_bytes, mock_upload_file, mock_convert, mock_analyze
    ):
        async def run():
            # Critical track + auto_reject_enabled=True -> Block upload and set status = "auto_rejected"
            mock_analyze.return_value = {
                "true_peak": 10 ** (2.5 / 20.0),
                "crest_factor": 6.0,
                "phase_correlation": 0.8,
                "bpm": 120,
                "lufs": -14.0,
                "peaks": [0.1, 0.2],
                "duration": 180.0,
            }
            sonic_sig = {
                "auto_reject_enabled": True,
            }
            res = await process_submission(
                file_path="dummy.wav",
                submission_id="sub_crit_ar",
                label_id="label_1",
                sonic_signature=sonic_sig,
            )
            self.assertEqual(res["status_tecnico"], "critico")
            self.assertEqual(res["status"], "auto_rejected")
            mock_convert.assert_not_called()
            mock_upload_file.assert_not_called()

        asyncio.run(run())

    @patch("app.audio.lifecycle.analyze_audio", new_callable=AsyncMock)
    @patch("app.audio.lifecycle.convert_to_mp3")
    @patch("app.audio.lifecycle.upload_file_to_r2", new_callable=AsyncMock)
    @patch("app.audio.lifecycle.upload_bytes_to_r2", new_callable=AsyncMock)
    @patch("app.audio.lifecycle._safe_remove")
    def test_process_submission_critico_auto_reject_disabled(
        self, mock_remove, mock_upload_bytes, mock_upload_file, mock_convert, mock_analyze
    ):
        async def run():
            # Critical track + auto_reject_enabled=False -> Upload and set status = "critico"
            mock_analyze.return_value = {
                "true_peak": 10 ** (2.5 / 20.0),
                "crest_factor": 6.0,
                "phase_correlation": 0.8,
                "bpm": 120,
                "lufs": -14.0,
                "peaks": [0.1, 0.2],
                "duration": 180.0,
            }
            sonic_sig = {
                "auto_reject_enabled": False,
            }
            res = await process_submission(
                file_path="dummy.wav",
                submission_id="sub_crit_no_ar",
                label_id="label_1",
                sonic_signature=sonic_sig,
            )
            self.assertEqual(res["status_tecnico"], "critico")
            self.assertEqual(res["status"], "critico")
            mock_convert.assert_called_once()
            mock_upload_file.assert_any_call("/tmp/sub_crit_no_ar.mp3", "tracks/sub_crit_no_ar/preview.mp3", "audio/mpeg")

        asyncio.run(run())

    def test_list_submissions_includes_critico(self):
        # Test that querying status="inbox" returns both 'inbox' and 'critico' statuses.
        from app.api.submissions import list_submissions
        from app.models import Submission
        from sqlmodel import Session
        import datetime

        mock_session = MagicMock(spec=Session)
        
        # Mock some submissions returned by the query
        sub_inbox = Submission(
            id="sub_inbox",
            label_id="label_1",
            producer_name="Producer 1",
            producer_email="prod1@test.com",
            track_name="Track 1",
            status="inbox",
            created_at=datetime.datetime.now(datetime.UTC),
        )
        sub_critico = Submission(
            id="sub_crit",
            label_id="label_1",
            producer_name="Producer 2",
            producer_email="prod2@test.com",
            track_name="Track 2",
            status="critico",
            status_tecnico="critico",
            alertas=["Falla de fase"],
            created_at=datetime.datetime.now(datetime.UTC),
        )

        mock_session.exec.return_value.all.return_value = [sub_inbox, sub_critico]

        async def run():
            auth = {"label_id": "label_1"}
            res = await list_submissions(
                status="inbox",
                auth=auth,
                session=mock_session,
            )
            self.assertEqual(len(res), 2)
            self.assertEqual(res[0].id, "sub_inbox")
            self.assertEqual(res[1].id, "sub_crit")
            self.assertEqual(res[1].status, "critico")
            self.assertEqual(res[1].status_tecnico, "critico")
            self.assertEqual(res[1].alertas, ["Falla de fase"])

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
