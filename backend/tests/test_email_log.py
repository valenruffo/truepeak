import asyncio
import unittest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
from sqlmodel import Session

from app.api.email import SendEmailRequest, get_email_logs, send_email_endpoint
from app.models import EmailLog, Label, Submission
from app.services.email_service import EmailSendError


class TestEmailLog(unittest.TestCase):
    @patch("app.api.email.send_email", new_callable=AsyncMock)
    def test_send_email_saves_subject_and_body_success(self, mock_send_email):
        async def run():
            # Mock send_email return value
            mock_result = MagicMock()
            mock_result.id = "msg_123"
            mock_result.status = "sent"
            mock_send_email.return_value = mock_result

            # Mock submission and DB session
            submission = Submission(
                id="sub_123",
                label_id="label_123",
                producer_name="Artist",
                producer_email="artist@example.com",
                track_name="Demo track",
                status="approved",
                human_email_sent=False,
            )
            mock_session = MagicMock(spec=Session)
            now_dt = datetime.now(UTC)

            def mock_get(model_cls, id_val):
                if model_cls == Submission:
                    return submission
                elif model_cls == Label:
                    return Label(
                        id="label_123",
                        name="Test Label",
                        slug="test-label",
                        owner_email="label@example.com",
                        max_emails_month=10,
                        emails_sent_this_month=0,
                        emails_sent_month=now_dt.month,
                    )
                return None

            mock_session.get.side_effect = mock_get

            body = SendEmailRequest(
                to="artist@example.com",
                subject="Your demo is approved!",
                body="Congratulations, your demo track was approved.",
                submission_id="sub_123",
            )

            auth = {"label_id": "label_123"}
            res = await send_email_endpoint(body=body, auth=auth, session=mock_session)

            self.assertEqual(res.id, "msg_123")
            self.assertEqual(res.status, "sent")

            # Check that an EmailLog was added to the session with subject and body
            added_objects = []
            for call in mock_session.add.call_args_list:
                added_objects.append(call[0][0])

            email_logs = [obj for obj in added_objects if isinstance(obj, EmailLog)]
            self.assertEqual(len(email_logs), 1)
            self.assertEqual(email_logs[0].subject, "Your demo is approved!")
            self.assertEqual(email_logs[0].body, "Congratulations, your demo track was approved.")
            self.assertEqual(email_logs[0].status, "sent")

            mock_session.commit.assert_called_once()

        asyncio.run(run())

    @patch("app.api.email.send_email", new_callable=AsyncMock)
    def test_send_email_saves_subject_and_body_failure(self, mock_send_email):
        async def run():
            # Mock send_email to raise EmailSendError
            mock_send_email.side_effect = EmailSendError(message="API key invalid", status_code=400)

            # Mock submission and DB session
            submission = Submission(
                id="sub_123",
                label_id="label_123",
                producer_name="Artist",
                producer_email="artist@example.com",
                track_name="Demo track",
                status="approved",
                human_email_sent=False,
            )
            mock_session = MagicMock(spec=Session)
            now_dt = datetime.now(UTC)

            def mock_get(model_cls, id_val):
                if model_cls == Submission:
                    return submission
                elif model_cls == Label:
                    return Label(
                        id="label_123",
                        name="Test Label",
                        slug="test-label",
                        owner_email="label@example.com",
                        max_emails_month=10,
                        emails_sent_this_month=0,
                        emails_sent_month=now_dt.month,
                    )
                return None

            mock_session.get.side_effect = mock_get

            body = SendEmailRequest(
                to="artist@example.com",
                subject="Your demo is approved!",
                body="Congratulations, your demo track was approved.",
                submission_id="sub_123",
            )

            auth = {"label_id": "label_123"}
            with self.assertRaises(HTTPException) as ctx:
                await send_email_endpoint(body=body, auth=auth, session=mock_session)

            self.assertEqual(ctx.exception.status_code, 400)

            # Check that a failed EmailLog was added to the session with subject and body
            added_objects = []
            for call in mock_session.add.call_args_list:
                added_objects.append(call[0][0])

            email_logs = [obj for obj in added_objects if isinstance(obj, EmailLog)]
            self.assertEqual(len(email_logs), 1)
            self.assertEqual(email_logs[0].subject, "Your demo is approved!")
            self.assertEqual(email_logs[0].body, "Congratulations, your demo track was approved.")
            self.assertEqual(email_logs[0].status, "failed")
            self.assertEqual(email_logs[0].error, "API key invalid")

            mock_session.commit.assert_called_once()

        asyncio.run(run())

    @patch("app.api.email.send_email", new_callable=AsyncMock)
    def test_send_email_saves_empty_subject_and_body_success(self, mock_send_email):
        async def run():
            # Mock send_email return value
            mock_result = MagicMock()
            mock_result.id = "msg_124"
            mock_result.status = "sent"
            mock_send_email.return_value = mock_result

            # Mock submission and DB session
            submission = Submission(
                id="sub_123",
                label_id="label_123",
                producer_name="Artist",
                producer_email="artist@example.com",
                track_name="Demo track",
                status="approved",
                human_email_sent=False,
            )
            mock_session = MagicMock(spec=Session)
            now_dt = datetime.now(UTC)

            def mock_get(model_cls, id_val):
                if model_cls == Submission:
                    return submission
                elif model_cls == Label:
                    return Label(
                        id="label_123",
                        name="Test Label",
                        slug="test-label",
                        owner_email="label@example.com",
                        max_emails_month=10,
                        emails_sent_this_month=0,
                        emails_sent_month=now_dt.month,
                    )
                return None

            mock_session.get.side_effect = mock_get

            body = SendEmailRequest(
                to="artist@example.com", subject="", body="", submission_id="sub_123"
            )

            auth = {"label_id": "label_123"}
            res = await send_email_endpoint(body=body, auth=auth, session=mock_session)

            self.assertEqual(res.id, "msg_124")
            self.assertEqual(res.status, "sent")

            # Check that an EmailLog was added to the session with empty strings
            added_objects = []
            for call in mock_session.add.call_args_list:
                added_objects.append(call[0][0])

            email_logs = [obj for obj in added_objects if isinstance(obj, EmailLog)]
            self.assertEqual(len(email_logs), 1)
            self.assertEqual(email_logs[0].subject, "")
            self.assertEqual(email_logs[0].body, "")
            self.assertEqual(email_logs[0].status, "sent")

            mock_session.commit.assert_called_once()

        asyncio.run(run())

    def test_get_email_logs_null_fields(self):
        async def run():
            # Mock submission
            submission = Submission(
                id="sub_123",
                label_id="label_123",
                producer_name="Artist",
                producer_email="artist@example.com",
                track_name="Demo track",
                status="approved",
                human_email_sent=True,
            )
            # Mock latest EmailLog with null subject and body
            email_log = EmailLog(
                id="log_124", submission_id="sub_123", status="sent", subject=None, body=None
            )
            mock_session = MagicMock(spec=Session)
            mock_session.get.return_value = submission

            # mock_session.exec for query
            mock_exec_result = MagicMock()
            mock_exec_result.first.return_value = email_log
            mock_session.exec.return_value = mock_exec_result

            auth = {"label_id": "label_123"}
            res = await get_email_logs(submission_id="sub_123", auth=auth, session=mock_session)

            self.assertIsNone(res.subject)
            self.assertIsNone(res.body)
            mock_session.get.assert_called_once_with(Submission, "sub_123")

        asyncio.run(run())

    def test_get_email_logs_success(self):
        async def run():
            # Mock submission
            submission = Submission(
                id="sub_123",
                label_id="label_123",
                producer_name="Artist",
                producer_email="artist@example.com",
                track_name="Demo track",
                status="approved",
                human_email_sent=True,
            )
            # Mock latest EmailLog
            email_log = EmailLog(
                id="log_123",
                submission_id="sub_123",
                status="sent",
                subject="Approved!",
                body="Your demo is approved.",
            )
            mock_session = MagicMock(spec=Session)
            mock_session.get.return_value = submission

            # mock_session.exec for query
            mock_exec_result = MagicMock()
            mock_exec_result.first.return_value = email_log
            mock_session.exec.return_value = mock_exec_result

            auth = {"label_id": "label_123"}
            res = await get_email_logs(submission_id="sub_123", auth=auth, session=mock_session)

            self.assertEqual(res.subject, "Approved!")
            self.assertEqual(res.body, "Your demo is approved.")
            mock_session.get.assert_called_once_with(Submission, "sub_123")

        asyncio.run(run())

    def test_get_email_logs_not_found(self):
        async def run():
            mock_session = MagicMock(spec=Session)
            mock_session.get.return_value = None

            auth = {"label_id": "label_123"}
            with self.assertRaises(HTTPException) as ctx:
                await get_email_logs(
                    submission_id="sub_nonexistent", auth=auth, session=mock_session
                )

            self.assertEqual(ctx.exception.status_code, 404)

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
