import sys
sys.path.insert(0, '/app')
from app.database import get_session
from app.models import Label
s = next(get_session())
for l in s.query(Label).all():
    print(l.slug, '|', l.plan, '|', l.max_tracks_month, '|', l.hq_retention_days)
