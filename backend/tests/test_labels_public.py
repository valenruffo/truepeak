import os
# Ensure environment variable is set
os.environ.setdefault(
    "POSTGRES_URL",
    "sqlite:///:memory:",
)

import unittest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine
from app.main import app
from app.database import get_session
from app.models import Label

# Use in-memory SQLite for testing this route
from sqlalchemy.pool import StaticPool
engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

def override_get_session():
    with Session(engine) as session:
        yield session

class TestLabelsPublicSlugs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SQLModel.metadata.create_all(engine)
        app.dependency_overrides[get_session] = override_get_session
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.pop(get_session, None)

    def setUp(self):
        # Clean up labels table
        from sqlmodel import select
        with Session(engine) as session:
            for label in session.exec(select(Label)).all():
                session.delete(label)
            session.commit()

    def test_get_public_slugs_filters_frozen(self):
        """Test that only non-frozen label slugs are returned."""
        with Session(engine) as session:
            label_active = Label(
                id="label-active-id",
                name="Active Records",
                slug="active-records",
                owner_email="active@test.com",
                subscription_status="active"
            )
            label_canceled = Label(
                id="label-canceled-id",
                name="Canceled Records",
                slug="canceled-records",
                owner_email="canceled@test.com",
                subscription_status="canceled"
            )
            label_frozen = Label(
                id="label-frozen-id",
                name="Frozen Records",
                slug="frozen-records",
                owner_email="frozen@test.com",
                subscription_status="frozen"
            )
            session.add(label_active)
            session.add(label_canceled)
            session.add(label_frozen)
            session.commit()

        response = self.client.get("/api/labels/public/slugs")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        self.assertIsInstance(data, list)
        self.assertIn("active-records", data)
        self.assertIn("canceled-records", data)
        self.assertNotIn("frozen-records", data)
        self.assertEqual(len(data), 2)

    def test_get_public_slugs_empty_db(self):
        """Test returning empty list when no labels exist."""
        response = self.client.get("/api/labels/public/slugs")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])
