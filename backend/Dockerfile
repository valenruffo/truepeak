FROM python:3.12-slim

# Install system dependencies: ffmpeg for audio conversion, cron for cleanup jobs, curl for healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libsndfile1 curl cron && \
    rm -rf /var/lib/apt/lists/*

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
