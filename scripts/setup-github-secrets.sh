#!/usr/bin/env bash
# =============================================================================
# setup-github-secrets.sh
#
# Registers all GitHub Actions secrets for the katisha/user-service repo
# using the GitHub CLI (gh).
#
# Usage:
#   1. Copy this file to scripts/setup-github-secrets.prod.sh
#   2. Fill in every YOUR_* placeholder in the .prod copy
#   3. Run:  bash scripts/setup-github-secrets.prod.sh
#
# Prerequisites:
#   - gh CLI installed and authenticated (gh auth login)
#   - Your account must have repo admin access
# =============================================================================
set -euo pipefail

# ── Repository ────────────────────────────────────────────────────────────────
# Auto-detected from the git remote. Override if needed.
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "Setting secrets for: ${REPO}"

# ── Docker Hub ────────────────────────────────────────────────────────────────
DOCKER_USERNAME="YOUR_DOCKERHUB_USERNAME"
# Create at: hub.docker.com → Account Settings → Security → New Access Token
DOCKER_TOKEN="YOUR_DOCKERHUB_ACCESS_TOKEN"

# ── SSH — remote production server ───────────────────────────────────────────
SSH_HOST="YOUR_SERVER_IP_OR_HOSTNAME"
SSH_USER="YOUR_SERVER_SSH_USER"           # e.g. ubuntu, deploy
SSH_PORT="22"
# Absolute path to the private key file on THIS machine (never the key itself)
SSH_PRIVATE_KEY_PATH="YOUR_PATH_TO_PRIVATE_KEY"  # e.g. ~/.ssh/katisha_deploy

# ── Deployment ────────────────────────────────────────────────────────────────
# Absolute path on the server where docker-compose.yml and .env live
DEPLOY_PATH="YOUR_SERVER_DEPLOY_PATH"     # e.g. /home/ubuntu/katisha/user-service

# =============================================================================

echo ""
echo "→ Docker Hub credentials"
gh secret set DOCKER_USERNAME  --repo "$REPO" --body "$DOCKER_USERNAME"
gh secret set DOCKER_TOKEN     --repo "$REPO" --body "$DOCKER_TOKEN"

echo "→ SSH connection"
gh secret set SSH_HOST         --repo "$REPO" --body "$SSH_HOST"
gh secret set SSH_USER         --repo "$REPO" --body "$SSH_USER"
gh secret set SSH_PORT         --repo "$REPO" --body "$SSH_PORT"

echo "→ SSH private key (read from file)"
gh secret set SSH_PRIVATE_KEY  --repo "$REPO" < "$SSH_PRIVATE_KEY_PATH"

echo "→ Deployment path"
gh secret set DEPLOY_PATH      --repo "$REPO" --body "$DEPLOY_PATH"

echo ""
echo "✓ All secrets set. Verify at:"
echo "  https://github.com/${REPO}/settings/secrets/actions"
