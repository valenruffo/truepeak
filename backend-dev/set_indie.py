import sys
sys.path.insert(0, '/app')
from app.database import get_session
from app.models import Label
from sqlmodel import select

s = next(get_session())
label = s.exec(select(Label).where(Label.slug == 'admin')).first()
if label:
    label.plan = 'indie'
    label.max_tracks_month = 100
    label.max_emails_month = 100
    label.hq_retention_days = 7
    s.add(label)
    s.commit()
    s.refresh(label)
    print(f"Updated: {label.slug} | {label.plan} | tracks:{label.max_tracks_month} | emails:{label.max_emails_month} | hq_days:{label.hq_retention_days}")
else:
    print("Label 'admin' not found")
