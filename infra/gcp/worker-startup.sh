#!/bin/bash
# Startup script for the vidora-worker VM. Runs on every boot, and on every `pnpm deploy:worker`.
# Pulls the latest worker image, writes its env file from Secret Manager, migrates the database,
# and (re)starts Redis and the worker. Logs go to Cloud Logging (gcplogs driver).
set -euo pipefail

PROJECT=vidora-510913
REGION=asia-southeast1
IMAGE=$REGION-docker.pkg.dev/$PROJECT/vidora/worker:latest
APP_URL=https://vidora-web-657635713769.asia-southeast1.run.app

if ! command -v docker >/dev/null; then
  apt-get update
  apt-get install -y docker.io
  systemctl enable --now docker
fi
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet

# Missing optional secrets come out empty.
secret() { gcloud secrets versions access latest --project="$PROJECT" --secret="$1" 2>/dev/null || true; }

umask 077
mkdir -p /etc/vidora
cat > /etc/vidora/worker.env <<EOF
NODE_ENV=production
DATABASE_URL=$(secret database-url)
REDIS_URL=redis://vidora-redis:6379
APP_URL=$APP_URL
WEBHOOK_BASE_URL=$APP_URL
HIGGSFIELD_WEBHOOK_SECRET=$(secret higgsfield-webhook-secret)
TOKEN_ENCRYPTION_KEYS=$(secret token-encryption-keys)
STORAGE_ENDPOINT=https://storage.googleapis.com
STORAGE_BUCKET=vidora-media-510913
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=$(secret storage-access-key-id)
STORAGE_SECRET_ACCESS_KEY=$(secret storage-secret-access-key)
ANTHROPIC_API_KEY=$(secret anthropic-api-key)
ELEVENLABS_API_KEY=$(secret elevenlabs-api-key)
PLATFORM_WORKSPACE_ID=$(secret platform-workspace-id)
GOOGLE_OAUTH_CLIENT_ID=$(secret google-oauth-client-id)
GOOGLE_OAUTH_CLIENT_SECRET=$(secret google-oauth-client-secret)
YOUTUBE_AUDITED=false
EOF

docker network inspect vidora >/dev/null 2>&1 || docker network create vidora

# BullMQ must never lose queued jobs to memory pressure: noeviction + AOF.
if ! docker inspect vidora-redis >/dev/null 2>&1; then
  docker run -d --name vidora-redis --network vidora --restart unless-stopped \
    -v vidora-redis:/data redis:7-alpine \
    redis-server --appendonly yes --maxmemory-policy noeviction
fi

docker pull "$IMAGE"
docker run --rm --network vidora --env-file /etc/vidora/worker.env "$IMAGE" \
  node --import tsx ../../packages/db/src/migrate.ts

docker rm -f vidora-worker >/dev/null 2>&1 || true
docker run -d --name vidora-worker --network vidora --restart unless-stopped \
  --env-file /etc/vidora/worker.env --log-driver=gcplogs --stop-timeout 30 "$IMAGE"
docker image prune -f >/dev/null
