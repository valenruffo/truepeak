import os
import unittest
from datetime import UTC, datetime
from unittest.mock import patch, MagicMock
import httpx
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine, select, func
from sqlalchemy.pool import StaticPool

# Set up test environment variables
os.environ["ADMIN_PASSWORD"] = "test-admin-secret"
os.environ["NEXT_PUBLIC_APP_MODE"] = "beta"

from app.models import WaitlistEntry, AppConfig, Label
from app.main import app
from app.database import get_session

# Set up clean in-memory database for testing
engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

def override_get_session():
    with Session(engine) as session:
        yield session

client = TestClient(app)

class TestWaitlistAndConfig(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SQLModel.metadata.create_all(engine)
        app.dependency_overrides[get_session] = override_get_session

    @classmethod
    def tearDownClass(cls):
        SQLModel.metadata.drop_all(engine)
        app.dependency_overrides.pop(get_session, None)

    def setUp(self):
        self.session = next(override_get_session())

    def tearDown(self):
        self.session.rollback()
        for label in self.session.exec(select(Label)).all():
            self.session.delete(label)
        for config in self.session.exec(select(AppConfig)).all():
            self.session.delete(config)
        for entry in self.session.exec(select(WaitlistEntry)).all():
            self.session.delete(entry)
        self.session.commit()
        self.session.close()

    def test_models_exist_and_attributes(self):
        # Verify WaitlistEntry can be created and stored
        entry = WaitlistEntry(email="test@example.com", source="test-suite")
        self.session.add(entry)
        self.session.commit()
        self.session.refresh(entry)
        self.assertIsNotNone(entry.id)
        self.assertEqual(entry.email, "test@example.com")
        self.assertEqual(entry.source, "test-suite")
        self.assertIsInstance(entry.created_at, datetime)

        # Verify AppConfig can be created and stored
        config = AppConfig(key="app_mode", value="prod")
        self.session.add(config)
        self.session.commit()
        self.session.refresh(config)
        self.assertEqual(config.key, "app_mode")
        self.assertEqual(config.value, "prod")

    def test_get_app_mode_default_fallback(self):
        # 1. Default fallback when no DB config and env is set to 'beta'
        response = client.get("/api/config/app-mode")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"mode": "beta"})

    def test_get_app_mode_db_override(self):
        # 2. Add mode in DB, verify it overrides env var
        mode_config = AppConfig(key="app_mode", value="prod")
        self.session.add(mode_config)
        self.session.commit()

        response = client.get("/api/config/app-mode")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"mode": "prod"})

    def test_put_app_mode_auth(self):
        # 3. PUT mode check auth - wrong password
        response = client.put("/api/config/app-mode", json={"mode": "prod"}, headers={"X-Admin-Password": "wrong"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), {"detail": "Unauthorized"})

        # Missing password header
        response = client.put("/api/config/app-mode", json={"mode": "prod"})
        self.assertEqual(response.status_code, 401)

    def test_put_app_mode_success(self):
        # 4. PUT mode success
        response = client.put(
            "/api/config/app-mode", 
            json={"mode": "prod"}, 
            headers={"X-Admin-Password": "test-admin-secret"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "mode": "prod"})

        # Check DB updated
        db_config = self.session.exec(select(AppConfig).where(AppConfig.key == "app_mode")).first()
        self.assertIsNotNone(db_config)
        self.assertEqual(db_config.value, "prod")

    def test_post_waitlist_success(self):
        # 5. POST to waitlist valid email
        response = client.post("/api/waitlist", json={"email": "newuser@example.com", "company": ""})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

        # Check in DB
        entry = self.session.exec(select(WaitlistEntry).where(WaitlistEntry.email == "newuser@example.com")).first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.email, "newuser@example.com")
        self.assertEqual(entry.source, "landing")

    def test_post_waitlist_invalid_email(self):
        # 6. POST to waitlist invalid email
        response = client.post("/api/waitlist", json={"email": "not-an-email", "company": ""})
        self.assertEqual(response.status_code, 422)

    def test_post_waitlist_honeypot(self):
        # 7. POST to waitlist honeypot triggered
        response = client.post("/api/waitlist", json={"email": "bot@spam.com", "company": "Spam Corp"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

        # Check NOT in DB
        entry = self.session.exec(select(WaitlistEntry).where(WaitlistEntry.email == "bot@spam.com")).first()
        self.assertIsNone(entry)

    def test_post_waitlist_duplicate_email(self):
        # 8. POST duplicate email should succeed and not duplicate
        client.post("/api/waitlist", json={"email": "dup@example.com", "company": ""})
        response = client.post("/api/waitlist", json={"email": "dup@example.com", "company": ""})
        self.assertEqual(response.status_code, 200)

        # Check count in DB is 1
        count = self.session.exec(select(func.count(WaitlistEntry.id)).where(WaitlistEntry.email == "dup@example.com")).one()
        self.assertEqual(count, 1)

    def test_get_admin_waitlist_auth(self):
        # 9. GET waitlist list wrong password
        response = client.get("/api/admin/waitlist", headers={"X-Admin-Password": "wrong"})
        self.assertEqual(response.status_code, 401)

    def test_get_admin_waitlist_success(self):
        # 10. GET waitlist success
        for i in range(5):
            entry = WaitlistEntry(email=f"user{i}@example.com")
            self.session.add(entry)
        self.session.commit()

        response = client.get("/api/admin/waitlist", headers={"X-Admin-Password": "test-admin-secret"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 5)
        self.assertEqual(len(data["entries"]), 5)

    def test_get_admin_waitlist_export(self):
        # 11. GET waitlist export CSV
        entry = WaitlistEntry(email="export@example.com")
        self.session.add(entry)
        self.session.commit()

        response = client.get("/api/admin/waitlist/export", headers={"X-Admin-Password": "test-admin-secret"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "text/csv; charset=utf-8")
        self.assertIn("email,created_at", response.text)
        self.assertIn("export@example.com", response.text)

    def test_get_admin_users_auth(self):
        # GET admin users check auth - wrong password
        response = client.get("/api/admin/users", headers={"X-Admin-Password": "wrong"})
        self.assertEqual(response.status_code, 401)

    def test_get_admin_users_success(self):
        # Setup label users
        label1 = Label(id="lbl-1", name="Label 1", slug="label-1", owner_email="label1@test.com", plan="free", subscription_status="active", max_tracks_month=10, max_emails_month=0, hq_retention_days=0)
        label2 = Label(id="lbl-2", name="Label 2", slug="label-2", owner_email="label2@test.com", plan="pro", subscription_status="frozen", max_tracks_month=1000, max_emails_month=500, hq_retention_days=14)
        
        self.session.add(label1)
        self.session.add(label2)
        self.session.commit()

        response = client.get("/api/admin/users", headers={"X-Admin-Password": "test-admin-secret"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        self.assertEqual(len(data), 2)
        user_slugs = [u["slug"] for u in data]
        self.assertIn("label-1", user_slugs)
        self.assertIn("label-2", user_slugs)
        
        # Verify fields
        user2 = [u for u in data if u["id"] == "lbl-2"][0]
        self.assertEqual(user2["name"], "Label 2")
        self.assertEqual(user2["slug"], "label-2")
        self.assertEqual(user2["email"], "label2@test.com")
        self.assertEqual(user2["plan"], "pro")
        self.assertEqual(user2["status"], "frozen")
        self.assertEqual(user2["track_limit"], 1000)
        self.assertEqual(user2["email_limit"], 500)
        self.assertEqual(user2["hq_retention_days"], 14)
        self.assertEqual(user2["role"], "label_owner")

    def test_update_user_status_auth(self):
        response = client.put("/api/admin/users/lbl-1/status", json={"plan": "indie"}, headers={"X-Admin-Password": "wrong"})
        self.assertEqual(response.status_code, 401)

    @patch("app.api.waitlist.sync_user_to_supabase")
    def test_update_user_status_success(self, mock_sync):
        label = Label(id="lbl-3", name="Label 3", slug="label-3", owner_email="label3@test.com", plan="free", subscription_status="active")
        self.session.add(label)
        self.session.commit()

        # Update plan to pro, which should set tracks to 1000, emails to 500, retention to 14
        response = client.put(
            "/api/admin/users/lbl-3/status",
            json={"plan": "pro", "subscription_status": "frozen"},
            headers={"X-Admin-Password": "test-admin-secret"}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["plan"], "pro")
        self.assertEqual(data["subscription_status"], "frozen")
        self.assertIsNotNone(data["frozen_at"])
        self.assertEqual(data["track_limit"], 1000)
        self.assertEqual(data["email_limit"], 500)
        self.assertEqual(data["hq_retention_days"], 14)

        # Re-fetch from database to verify
        self.session.expire_all()
        db_label = self.session.exec(select(Label).where(Label.id == "lbl-3")).first()
        self.assertEqual(db_label.plan, "pro")
        self.assertEqual(db_label.subscription_status, "frozen")
        self.assertIsNotNone(db_label.frozen_at)
        self.assertEqual(db_label.max_tracks_month, 1000)
        self.assertEqual(db_label.max_emails_month, 500)
        self.assertEqual(db_label.hq_retention_days, 14)

        # Unfreeze
        response = client.put(
            "/api/admin/users/lbl-3/status",
            json={"subscription_status": "active"},
            headers={"X-Admin-Password": "test-admin-secret"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["frozen_at"])

        # Check DB
        self.session.expire_all()
        db_label = self.session.exec(select(Label).where(Label.id == "lbl-3")).first()
        self.assertIsNone(db_label.frozen_at)
        self.assertEqual(db_label.subscription_status, "active")

        # Verify sync was called correctly
        mock_sync.assert_any_call(user_id="lbl-3", plan="pro", suspended=False, raise_on_error=True)

    def test_update_user_status_invalid(self):
        label = Label(id="lbl-4", name="Label 4", slug="label-4", owner_email="label4@test.com", plan="free", subscription_status="active")
        self.session.add(label)
        self.session.commit()

        # Invalid plan
        response = client.put(
            "/api/admin/users/lbl-4/status",
            json={"plan": "ultra"},
            headers={"X-Admin-Password": "test-admin-secret"}
        )
        self.assertEqual(response.status_code, 400)

        # Invalid status
        response = client.put(
            "/api/admin/users/lbl-4/status",
            json={"subscription_status": "deleted"},
            headers={"X-Admin-Password": "test-admin-secret"}
        )
        self.assertEqual(response.status_code, 400)

    @patch("app.services.auth.httpx.Client")
    def test_sync_user_to_supabase_success(self, mock_client_cls):
        from app.services.auth import sync_user_to_supabase
        
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_client.put.return_value = mock_response
        mock_client_cls.return_value.__enter__.return_value = mock_client
        
        with patch("app.services.auth.SUPABASE_SERVICE_ROLE_KEY", "test-role-key"), \
             patch("app.services.auth.SUPABASE_URL", "https://test.supabase.co"):
            sync_user_to_supabase("user-123", plan="pro", suspended=True, raise_on_error=True)
                
        mock_client.put.assert_called_once_with(
            "https://test.supabase.co/auth/v1/admin/users/user-123",
            json={"app_metadata": {"plan": "pro"}, "ban_duration": "876600h"},
            headers={
                "apikey": "test-role-key",
                "Authorization": "Bearer test-role-key",
                "Content-Type": "application/json"
            },
            timeout=5.0
        )

    @patch("app.services.auth.httpx.Client")
    def test_sync_user_to_supabase_only_plan(self, mock_client_cls):
        from app.services.auth import sync_user_to_supabase
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_client.put.return_value = mock_response
        mock_client_cls.return_value.__enter__.return_value = mock_client
        
        with patch("app.services.auth.SUPABASE_SERVICE_ROLE_KEY", "test-role-key"), \
             patch("app.services.auth.SUPABASE_URL", "https://test.supabase.co"):
            sync_user_to_supabase("user-123", plan="free", raise_on_error=True)
            
        mock_client.put.assert_called_once_with(
            "https://test.supabase.co/auth/v1/admin/users/user-123",
            json={"app_metadata": {"plan": "free"}},
            headers={
                "apikey": "test-role-key",
                "Authorization": "Bearer test-role-key",
                "Content-Type": "application/json"
            },
            timeout=5.0
        )

    @patch("app.services.auth.httpx.Client")
    def test_sync_user_to_supabase_error_raised(self, mock_client_cls):
        from app.services.auth import sync_user_to_supabase
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            message="Internal Server Error",
            request=MagicMock(),
            response=mock_response
        )
        mock_client.put.return_value = mock_response
        mock_client_cls.return_value.__enter__.return_value = mock_client
        
        with patch("app.services.auth.SUPABASE_SERVICE_ROLE_KEY", "test-role-key"), \
             patch("app.services.auth.SUPABASE_URL", "https://test.supabase.co"):
            with self.assertRaises(httpx.HTTPError):
                sync_user_to_supabase("user-123", plan="pro", raise_on_error=True)

    def test_sync_user_to_supabase_missing_key_raises_value_error(self):
        from app.services.auth import sync_user_to_supabase
        with patch("app.services.auth.SUPABASE_SERVICE_ROLE_KEY", ""):
            with self.assertRaises(ValueError) as ctx:
                sync_user_to_supabase("user-123", plan="pro", raise_on_error=True)
            self.assertEqual(str(ctx.exception), "SUPABASE_SERVICE_ROLE_KEY is not configured.")

    @patch("app.services.auth.logger")
    def test_sync_user_to_supabase_missing_key_warning(self, mock_logger):
        from app.services.auth import sync_user_to_supabase
        with patch("app.services.auth.SUPABASE_SERVICE_ROLE_KEY", ""):
            sync_user_to_supabase("user-123", plan="pro", raise_on_error=False)
            mock_logger.warning.assert_called_once_with(
                "SUPABASE_SERVICE_ROLE_KEY is missing. Skipping sync_user_to_supabase."
            )

    @patch("app.api.waitlist.sync_user_to_supabase")
    def test_update_user_status_rollback_on_sync_failure(self, mock_sync):
        mock_sync.side_effect = Exception("Supabase connection failed")
        
        label = Label(id="lbl-rollback-test", name="Rollback Test", slug="rollback-test", owner_email="rollback@test.com", plan="free", subscription_status="active")
        self.session.add(label)
        self.session.commit()
        
        response = client.put(
            "/api/admin/users/lbl-rollback-test/status",
            json={"subscription_status": "suspended"},
            headers={"X-Admin-Password": "test-admin-secret"}
        )
        self.assertEqual(response.status_code, 500)
        self.assertIn("Supabase synchronization failed", response.json()["detail"])
        
        self.session.expire_all()
        db_label = self.session.exec(select(Label).where(Label.id == "lbl-rollback-test")).first()
        self.assertEqual(db_label.subscription_status, "active")
        self.assertEqual(db_label.plan, "free")
