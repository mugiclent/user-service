#!/usr/bin/env bash
# =============================================================================
# setup-remote-server.sh
#
# One-time setup of the production server for the katisha user-service.
# Idempotent — safe to re-run.
#
# What it does:
#   1. Uploads docker-compose.yml to the server
#   2. Creates the .env file on the server with all runtime secrets
#   3. Creates the external Docker network (katisha-net) if absent
#   4. Logs Docker Hub in on the server so it can pull private images
#   5. Pulls the image and starts the service
#
# Usage:
#   1. Copy this file to scripts/setup-remote-server.prod.sh
#   2. Fill in every YOUR_* placeholder in the .prod copy
#   3. Run:  bash scripts/setup-remote-server.prod.sh
#
# Prerequisites:
#   - Docker + Docker Compose v2 installed on the server
#   - Your SSH key added to the server's ~/.ssh/authorized_keys
# =============================================================================
set -euo pipefail

# ── SSH connection ────────────────────────────────────────────────────────────
SSH_HOST="YOUR_SERVER_IP_OR_HOSTNAME"
SSH_USER="YOUR_SERVER_SSH_USER"
SSH_PORT="22"
SSH_KEY="YOUR_PATH_TO_PRIVATE_KEY"        # e.g. ~/.ssh/katisha_deploy

# ── Deployment ────────────────────────────────────────────────────────────────
DEPLOY_PATH="YOUR_SERVER_DEPLOY_PATH"     # e.g. /home/ubuntu/katisha/user-service

# ── Docker Hub ────────────────────────────────────────────────────────────────
DOCKER_USERNAME="YOUR_DOCKERHUB_USERNAME"
DOCKER_TOKEN="YOUR_DOCKERHUB_ACCESS_TOKEN"

# ── Service environment variables ────────────────────────────────────────────
NODE_ENV="production"
PORT="3001"

DATABASE_URL="YOUR_DATABASE_URL"          # e.g. postgresql://user:pass@host:5432/katisha_users

REDIS_URL="YOUR_REDIS_URL"               # e.g. redis://localhost:6379

RABBITMQ_URL="YOUR_RABBITMQ_URL"         # e.g. amqp://user:pass@localhost:5672

# RS256 key pair — store as single-line with literal \n between PEM lines
JWT_PRIVATE_KEY="YOUR_JWT_PRIVATE_KEY"
JWT_PUBLIC_KEY="YOUR_JWT_PUBLIC_KEY"
JWT_EXPIRES_IN="15m"
REFRESH_TOKEN_TTL_DAYS="7"

COOKIE_SECURE="true"
TRUST_PROXY="1"

OTP_TTL_SECONDS="300"
OTP_LENGTH="6"
OTP_MAX_ATTEMPTS="3"
OTP_WINDOW_SECONDS="600"

RATE_LIMIT_LOGIN_MAX="5"
RATE_LIMIT_LOGIN_WINDOW_SECONDS="900"
RATE_LIMIT_RESET_MAX="3"
RATE_LIMIT_RESET_WINDOW_SECONDS="3600"

APP_URL="YOUR_APP_URL"                   # e.g. https://api.katisha.com

S3_ENDPOINT="YOUR_S3_ENDPOINT"
S3_PUBLIC_ENDPOINT="YOUR_S3_PUBLIC_ENDPOINT"
S3_ACCESS_KEY="YOUR_S3_ACCESS_KEY"
S3_SECRET_KEY="YOUR_S3_SECRET_KEY"
S3_BUCKET="katisha"
S3_REGION="us-east-1"
S3_PRESIGNED_EXPIRES_IN="300"

# =============================================================================

SSH_CMD="ssh -i ${SSH_KEY} -p ${SSH_PORT} -o StrictHostKeyChecking=no ${SSH_USER}@${SSH_HOST}"
SCP_CMD="scp -i ${SSH_KEY} -P ${SSH_PORT} -o StrictHostKeyChecking=no"

echo "→ Creating deployment directory on server"
$SSH_CMD "mkdir -p ${DEPLOY_PATH}"

echo "→ Uploading docker-compose.yml"
$SCP_CMD docker-compose.yml "${SSH_USER}@${SSH_HOST}:${DEPLOY_PATH}/docker-compose.yml"

echo "→ Writing .env on server"
$SSH_CMD "cat > ${DEPLOY_PATH}/.env" << EOF
NODE_ENV=${NODE_ENV}
PORT=${PORT}

DOCKER_USERNAME=${DOCKER_USERNAME}
IMAGE_TAG=latest

DATABASE_URL=${DATABASE_URL}

REDIS_URL=${REDIS_URL}

RABBITMQ_URL=${RABBITMQ_URL}

JWT_PRIVATE_KEY=${JWT_PRIVATE_KEY}
JWT_PUBLIC_KEY=${JWT_PUBLIC_KEY}
JWT_EXPIRES_IN=${JWT_EXPIRES_IN}
REFRESH_TOKEN_TTL_DAYS=${REFRESH_TOKEN_TTL_DAYS}

COOKIE_SECURE=${COOKIE_SECURE}
TRUST_PROXY=${TRUST_PROXY}

OTP_TTL_SECONDS=${OTP_TTL_SECONDS}
OTP_LENGTH=${OTP_LENGTH}
OTP_MAX_ATTEMPTS=${OTP_MAX_ATTEMPTS}
OTP_WINDOW_SECONDS=${OTP_WINDOW_SECONDS}

RATE_LIMIT_LOGIN_MAX=${RATE_LIMIT_LOGIN_MAX}
RATE_LIMIT_LOGIN_WINDOW_SECONDS=${RATE_LIMIT_LOGIN_WINDOW_SECONDS}
RATE_LIMIT_RESET_MAX=${RATE_LIMIT_RESET_MAX}
RATE_LIMIT_RESET_WINDOW_SECONDS=${RATE_LIMIT_RESET_WINDOW_SECONDS}

APP_URL=${APP_URL}

S3_ENDPOINT=${S3_ENDPOINT}
S3_PUBLIC_ENDPOINT=${S3_PUBLIC_ENDPOINT}
S3_ACCESS_KEY=${S3_ACCESS_KEY}
S3_SECRET_KEY=${S3_SECRET_KEY}
S3_BUCKET=${S3_BUCKET}
S3_REGION=${S3_REGION}
S3_PRESIGNED_EXPIRES_IN=${S3_PRESIGNED_EXPIRES_IN}
EOF

echo "→ Creating katisha-net Docker network (skipped if already exists)"
$SSH_CMD "docker network inspect katisha-net > /dev/null 2>&1 || docker network create katisha-net"

echo "→ Logging Docker Hub in on server"
$SSH_CMD "echo '${DOCKER_TOKEN}' | docker login --username '${DOCKER_USERNAME}' --password-stdin"

echo "→ Pulling image and starting service"
$SSH_CMD "cd ${DEPLOY_PATH} && docker compose pull user-service && docker compose up -d user-service"

echo ""
echo "✓ Server setup complete. Service is running."
echo "  Logs: ssh ${SSH_USER}@${SSH_HOST} 'docker logs -f katisha-user-service'"
