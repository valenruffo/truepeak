"""Migration script to seed default email templates for existing labels."""

import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import UTC, datetime
from sqlmodel import Session, select

from app.database import engine
from app.models import EmailTemplate, Label
from app.services.email_service import get_fixed_template


def migrate_templates():
    """Create default rejection/approval templates for each label that has none."""
    with Session(engine) as session:
        # Get all labels
        labels = session.exec(select(Label)).all()
        print(f"Found {len(labels)} labels")
        
        for label in labels:
            # Check if label already has templates
            existing = session.exec(
                select(EmailTemplate).where(EmailTemplate.label_id == label.id)
            ).all()
            
            if existing:
                print(f"  Label {label.name} already has {len(existing)} templates, skipping")
                continue
            
            # Create 2 default templates
            lang = label.lang if hasattr(label, 'lang') else 'es'
            
            rejection = get_fixed_template("rejection", lang)
            approval = get_fixed_template("approval", lang)
            
            rejection_template = EmailTemplate(
                label_id=label.id,
                name="Rechazo" if lang == "es" else "Rejection",
                template_type="rejection",
                subject_template=rejection["subject"],
                body_template=rejection["body"],
            )
            
            approval_template = EmailTemplate(
                label_id=label.id,
                name="Aprobación" if lang == "es" else "Approval",
                template_type="approval",
                subject_template=approval["subject"],
                body_template=approval["body"],
            )
            
            session.add(rejection_template)
            session.add(approval_template)
            
            print(f"  Created 2 default templates for label {label.name}")
        
        session.commit()
        print("Migration complete!")


if __name__ == "__main__":
    migrate_templates()
