import os
import unittest
from datetime import UTC, datetime
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine, select, func
from sqlalchemy.pool import StaticPool

# Set up test environment variables
os.environ["ADMIN_PASSWORD"] = "test-admin-secret"
os.environ["NEXT_PUBLIC_APP_MODE"] = "beta"

from app.models import WaitlistEntry, AppConfig
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

app.dependency_overrides[get_session] = override_get_session
client = TestClient(app)

class TestWaitlistAndConfig(unittest.TestCase):
    def setUp(self):
        SQLModel.metadata.create_all(engine)
        self.session = next(override_get_session())

    def tearDown(self):
        SQLModel.metadata.drop_all(engine)

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
