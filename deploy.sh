#!/bin/bash
# True Peak AI - Backend Deployment Script
# Run this on your Oracle Cloud server

set -e

echo "🚀 Deploying True Peak AI Backend..."

# Navigate to project directory
cd /home/ubuntu/truepeak || { echo "❌ Directory not found. Update path in deploy.sh"; exit 1; }

# Pull latest changes (if using git)
if [ -d ".git" ]; then
    echo "📦 Pulling latest changes..."
    git pull || echo "⚠️  Git pull failed, continuing with local changes..."
fi

# Stop existing containers
echo "⏹️  Stopping existing containers..."
docker compose down

# Rebuild with new dependencies (libsndfile1, Pillow, resend)
echo "🔨 Rebuilding Docker image..."
docker compose build --no-cache

# Start containers
echo "▶️  Starting containers..."
docker compose up -d

# Wait for health check
echo "⏳ Waiting for backend to be ready..."
sleep 10

# Check health
if curl -f http://localhost:8000/ > /dev/null 2>&1; then
    echo "✅ Backend is running and healthy!"
    echo "📍 URL: http://$(curl -s ifconfig.me):8000"
else
    echo "❌ Backend failed to start. Check logs with: docker compose logs"
    exit 1
fi

echo "🎉 Deployment complete!"
