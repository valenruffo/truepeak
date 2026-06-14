import os

# Set default test environment variables before any other imports
os.environ["POSTGRES_URL"] = "sqlite:///:memory:"
