FROM python:3.12-slim

# Install system dependencies: ffmpeg for audio conversion, cron for cleanup jobs, curl for healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libsndfile1 curl cron && \
    rm -rf /var/lib/apt/lists/*

# Install OpenL3 audio-embedding stack (TensorFlow CPU + kapre + h5py).
# openl3 0.4.2 ships a setup.py that imports the removed `imp` module on Python 3.12,
# so we fetch the sdist, patch that import out, and install without deps.
RUN pip install --no-cache-dir "tensorflow>=2.20,<3" "kapre>=0.3.5" "h5py>=3.0" resampy && \
    curl -fsSL -o /tmp/openl3.tar.gz https://files.pythonhosted.org/packages/33/fb/ac93a879d93db231e9f94acf2b07ac0977290f746953dd014ba7f1ac68b5/openl3-0.4.2.tar.gz && \
    tar -xzf /tmp/openl3.tar.gz -C /tmp && \
    sed -i '/^import imp$/d; s|^version = imp.load_source.*$|version = type("V", (), {"version": "0.4.2"})()|' /tmp/openl3-0.4.2/setup.py && \
    pip install --no-cache-dir --no-deps /tmp/openl3-0.4.2 && \
    rm -rf /tmp/openl3*

# Setup daily cleanup cron (runs at 3 AM UTC)
RUN echo "0 3 * * * cd /app && python -m app.cleanup_cron >> /var/log/cleanup.log 2>&1" > /etc/cron.d/truepeak-cleanup && \
    chmod 0644 /etc/cron.d/truepeak-cleanup && \
    crontab /etc/cron.d/truepeak-cleanup

WORKDIR /app

# Install Python dependencies
COPY pyproject.toml ./
RUN pip install --no-cache-dir .

# Copy application code
COPY app/ ./app/

# Create data directory for runtime volume mount
RUN mkdir -p /app/data/mp3s

EXPOSE 8000

# Start cron and FastAPI
CMD cron && uvicorn app.main:app --host 0.0.0.0 --port 8000
