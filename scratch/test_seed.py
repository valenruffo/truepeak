import sys
import os
from pathlib import Path

# Add backend to path
sys.path.append(str(Path(__file__).parent.parent / "backend"))

# Set environment
os.environ["DATA_DIR"] = str(Path(__file__).parent.parent / "data")
Path(os.environ["DATA_DIR"]).mkdir(parents=True, exist_ok=True)

from app.database import init_db, engine
from sqlmodel import Session, select
from app.models import Label, Submission

print("Initializing DB and seeding...")
init_db()

with Session(engine) as session:
    labels = session.exec(select(Label)).all()
    print(f"Total Labels: {len(labels)}")
    for l in labels:
        print(f" - Label: {l.name} (slug: {l.slug}), Plan: {l.plan}")
        
    subs = session.exec(select(Submission)).all()
    print(f"Total Submissions: {len(subs)}")
    for s in subs[:5]:
        print(f" - Submission: {s.producer_name} - {s.track_name} ({s.status})")
