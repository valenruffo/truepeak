import unittest
import asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi import HTTPException
from sqlmodel import Session

from app.models import Submission, Label
from app.api.submissions import restore_submission, delete_submission
from app.services.r2 import delete_folder_from_r2
from app.cleanup_cron import cleanup_async

class TestTrashRestoreR2(unittest.TestCase):

    def test_restore_naive_deleted_at(self):
        async def run():
            submission = Submission(
                id="sub_test",
                label_id="label_test",
                producer_name="Test",
                producer_email="test@example.com",
                track_name="Test Track",
                status="inbox",
                deleted_at=datetime.now() # Naive datetime
            )
            mock_session = MagicMock(spec=Session)
            mock_session.get.return_value = submission
            auth = {"label_id": "label_test"}
            res = await restore_submission(
                submission_id="sub_test",
                auth=auth,
                session=mock_session
            )
            self.assertEqual(res.id, "sub_test")
            self.assertTrue(res.restored)
            self.assertIsNone(submission.deleted_at)
            mock_session.add.assert_called_once_with(submission)
            mock_session.commit.assert_called_once()
        asyncio.run(run())

    def test_restore_aware_deleted_at(self):
        async def run():
            submission = Submission(
                id="sub_test",
                label_id="label_test",
                producer_name="Test",
                producer_email="test@example.com",
                track_name="Test Track",
                status="inbox",
                deleted_at=datetime.now(timezone.utc) # Aware datetime
            )
            mock_session = MagicMock(spec=Session)
            mock_session.get.return_value = submission
            auth = {"label_id": "label_test"}
            res = await restore_submission(
                submission_id="sub_test",
                auth=auth,
                session=mock_session
            )
            self.assertEqual(res.id, "sub_test")
            self.assertTrue(res.restored)
            self.assertIsNone(submission.deleted_at)
            mock_session.add.assert_called_once_with(submission)
            mock_session.commit.assert_called_once()
        asyncio.run(run())

    def test_restore_expired_fails(self):
        async def run():
            submission = Submission(
                id="sub_test",
                label_id="label_test",
                producer_name="Test",
                producer_email="test@example.com",
                track_name="Test Track",
                status="inbox",
                deleted_at=datetime.now(timezone.utc) - timedelta(hours=25)
            )
            mock_session = MagicMock(spec=Session)
            mock_session.get.return_value = submission
            auth = {"label_id": "label_test"}
            with self.assertRaises(HTTPException) as ctx:
                await restore_submission(
                    submission_id="sub_test",
                    auth=auth,
                    session=mock_session
                )
            self.assertEqual(ctx.exception.status_code, 400)
            self.assertIn("Cannot restore", ctx.exception.detail)
        asyncio.run(run())

    @patch("app.services.r2._get_s3_client")
    @patch("app.services.r2.BUCKET_NAME", "test-bucket")
    def test_delete_folder_from_r2_mocked(self, mock_get_s3_client):
        async def run():
            mock_s3 = MagicMock()
            mock_get_s3_client.return_value = mock_s3
            mock_paginator = MagicMock()
            mock_s3.get_paginator.return_value = mock_paginator
            mock_pages = [
                {
                    "Contents": [
                        {"Key": "tracks/sub123/file1.mp3"},
                        {"Key": "tracks/sub123/file2.wav"}
                    ]
                },
                {
                    "Contents": [
                        {"Key": "tracks/sub123/nested/file3.json"}
                    ]
                }
            ]
            mock_paginator.paginate.return_value = mock_pages
            
            await delete_folder_from_r2("tracks/sub123/")
            
            mock_s3.get_paginator.assert_called_once_with("list_objects_v2")
            mock_paginator.paginate.assert_called_once_with(Bucket="test-bucket", Prefix="tracks/sub123/")
            mock_s3.delete_objects.assert_called_once_with(
                Bucket="test-bucket",
                Delete={
                    "Objects": [
                        {"Key": "tracks/sub123/file1.mp3"},
                        {"Key": "tracks/sub123/file2.wav"},
                        {"Key": "tracks/sub123/nested/file3.json"}
                    ]
                }
            )
        asyncio.run(run())

    @patch("app.services.r2.delete_folder_from_r2", new_callable=AsyncMock)
    def test_hard_delete_r2_integration(self, mock_delete_folder):
        async def run():
            submission = Submission(
                id="sub_test",
                label_id="label_test",
                producer_name="Test",
                producer_email="test@example.com",
                track_name="Test Track",
                status="inbox",
                deleted_at=datetime.now(timezone.utc)
            )
            mock_session = MagicMock(spec=Session)
            mock_session.get.return_value = submission
            auth = {"label_id": "label_test"}
            res = await delete_submission(
                submission_id="sub_test",
                force=True,
                auth=auth,
                session=mock_session
            )
            self.assertEqual(res.id, "sub_test")
            self.assertTrue(res.deleted)
            mock_delete_folder.assert_called_once_with("tracks/sub_test/")
            mock_session.delete.assert_called_once_with(submission)
            mock_session.commit.assert_called_once()
        asyncio.run(run())

    @patch("app.services.r2.delete_folder_from_r2", new_callable=AsyncMock)
    def test_hard_delete_r2_failure_safety(self, mock_delete_folder):
        async def run():
            mock_delete_folder.side_effect = RuntimeError("R2 deletion failed")
            submission = Submission(
                id="sub_test",
                label_id="label_test",
                producer_name="Test",
                producer_email="test@example.com",
                track_name="Test Track",
                status="inbox",
                deleted_at=datetime.now(timezone.utc)
            )
            mock_session = MagicMock(spec=Session)
            mock_session.get.return_value = submission
            auth = {"label_id": "label_test"}
            res = await delete_submission(
                submission_id="sub_test",
                force=True,
                auth=auth,
                session=mock_session
            )
            self.assertEqual(res.id, "sub_test")
            self.assertTrue(res.deleted)
            mock_delete_folder.assert_called_once_with("tracks/sub_test/")
            mock_session.delete.assert_called_once_with(submission)
            mock_session.commit.assert_called_once()
        asyncio.run(run())

    @patch("app.cleanup_cron.delete_folder_from_r2", new_callable=AsyncMock)
    @patch("app.cleanup_cron.Session")
    def test_cleanup_cron_r2_integration(self, mock_session_cls, mock_delete_folder):
        async def run():
            mock_session = MagicMock(spec=Session)
            mock_session_cls.return_value.__enter__.return_value = mock_session
            
            old_deleted_sub = Submission(
                id="sub_old_deleted",
                label_id="label_test",
                producer_name="Test",
                producer_email="test@example.com",
                track_name="Test Track",
                status="inbox",
                deleted_at=datetime.now(timezone.utc) - timedelta(hours=26)
            )
            dead_label = Label(
                id="label_dead",
                name="Dead Label",
                slug="dead-label",
                owner_email="dead@example.com",
                subscription_status="frozen",
                frozen_at=datetime.now(timezone.utc) - timedelta(days=35)
            )
            dead_sub = Submission(
                id="sub_dead",
                label_id="label_dead",
                producer_name="Dead",
                producer_email="dead@example.com",
                track_name="Dead Track",
                status="inbox"
            )
            mock_session.exec.side_effect = [
                MagicMock(all=lambda: [old_deleted_sub]),  # Rule 1
                MagicMock(all=lambda: []),                 # Rule 2
                MagicMock(all=lambda: []),                 # Rule 3
                MagicMock(all=lambda: []),                 # Rule 4
                MagicMock(all=lambda: [dead_label]),       # Rule 5 (dead labels)
                MagicMock(all=lambda: [dead_sub]),         # Rule 5 (subs for dead label)
            ]
            await cleanup_async()
            mock_delete_folder.assert_any_call("tracks/sub_old_deleted/")
            mock_delete_folder.assert_any_call("tracks/sub_dead/")
            self.assertEqual(mock_delete_folder.call_count, 2)
            mock_session.delete.assert_any_call(old_deleted_sub)
            mock_session.delete.assert_any_call(dead_sub)
        asyncio.run(run())

if __name__ == "__main__":
    unittest.main()
