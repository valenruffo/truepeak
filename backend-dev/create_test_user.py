import os
import sys

# Add current directory to sys.path
sys.path.append(os.getcwd())

from app.database import engine
from app.models import Label
from app.services.auth import get_password_hash
from sqlmodel import Session

def create_test_user():
    with Session(engine) as session:
        # Check if user exists
        existing = session.query(Label).filter(Label.slug == "fede").first()
        if existing:
            print("User fede already exists locally.")
            return

        user = Label(
            name="Fede",
            slug="fede",
            owner_email="fede@gmail.com",
            password_hash=get_password_hash("admin123"),
            plan="free",
            max_tracks_month=10,
            max_emails_month=0,
            hq_retention_days=0
        )
        session.add(user)
        session.commit()
        print("Test user fede created successfully!")

if __name__ == "__main__":
    create_test_user()
