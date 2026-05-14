import os
import sys

# Add current directory to sys.path
sys.path.append(os.getcwd())

from app.database import init_db
from app.models import Label, Submission, EmailTemplate, EmailLog

if __name__ == "__main__":
    print("Initializing local database with models...")
    init_db()
    print("Done!")
