# DEVOPS.md — Skill: Set up DevOps infrastructure for a Katisha microservice

Use this skill when asked to add Docker, docker-compose, a CI/CD pipeline, or
deployment scripts to a Katisha microservice. Follow every step in order.

The canonical reference for all decisions made here is
[`docs/DEVOPS.md`](../docs/DEVOPS.md) in the user-service. Read it if you need
the rationale behind any choice.

---

## Inputs to gather before starting

Ask the user for (or infer from the codebase):

| Input | Example |
|---|---|
| Service name (kebab-case) | `notification-service` |
| Port number | `3002` (each service gets its own port in the `3001+` range) |
| Has native addons? | Yes if `argon2`, `bcrypt`, `sharp`, `canvas`, etc. in `dependencies` |
| Entry point | `dist/index.js` (default for TS services compiled with `tsc`) |
| Build command | `npm run build` (default) |
| Prisma used? | Yes/No — affects whether `prisma generate` runs in the build |

---

## Step 1 — Dockerfile

Create `Dockerfile` in the service root.

**Always use the two-stage pattern:**
- Stage 1 (`builder`): `node:22-bookworm-slim` — glibc, has build tools for
  native addons
- Stage 2 (`production`): `gcr.io/distroless/nodejs22-debian12` — no shell,
  no build tools, 0 critical/high CVEs

```dockerfile
FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
{{IF_PRISMA}}COPY prisma ./prisma/
{{/IF_PRISMA}}
RUN npm ci

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build{{IF_PRISMA}} && npx prisma generate{{/IF_PRISMA}} && npm prune --omit=dev


FROM gcr.io/distroless/nodejs22-debian12

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
{{IF_PRISMA}}COPY --from=builder /app/prisma ./prisma
{{/IF_PRISMA}}
ENV NODE_ENV=production
ENV PORT={{PORT}}

EXPOSE {{PORT}}

CMD ["dist/index.js"]
```

**Rules:**
- Never run `npm ci` or `npm install` in the production stage
- Never copy build tools into the production stage
- `CMD` takes only the script path — distroless nodejs uses `node` as its
  entrypoint automatically
- If the service has no native addons, you may omit the `apt-get` block — but
  keep it in if unsure; it adds ~30 seconds to build time, not to image size

---

## Step 2 — docker-compose.yml

Create `docker-compose.yml` in the service root.

```yaml
services:
  {{SERVICE_NAME}}:
    image: ${DOCKER_USERNAME}/{{SERVICE_NAME}}:${IMAGE_TAG:-latest}
    container_name: katisha-{{SERVICE_NAME}}
    restart: unless-stopped
    environment:
      NODE_ENV: ${NODE_ENV}
      PORT: ${PORT}
      # --- paste all env vars the service needs, each as ${VAR_NAME} ---
    ports:
      - "${PORT:-{{PORT}}}:${PORT:-{{PORT}}}"
    networks:
      - katisha-net

networks:
  katisha-net:
    external: true
```

**Rules:**
- Use `image:` not `build:` — the server pulls a pre-built image, it never
  builds locally
- Every env var must use `${VAR_NAME}` — no hardcoded values
- Use the service's assigned port as the default in `${PORT:-PORT}`
- Always attach to `katisha-net` as an external network
- Do not define other services (databases, Redis, etc.) in this file — they
  are managed separately on the host

---

## Step 3 — .env.example

Ensure `.env.example` exists and includes these two lines at the top, in
addition to all service-specific vars:

```bash
# Docker image — managed by CI/CD pipeline (do not edit manually in production)
DOCKER_USERNAME=yourdockerhubusername
IMAGE_TAG=latest
```

---

## Step 4 — .gitignore

Create `.gitignore` with this content (exact — do not abbreviate):

```gitignore
# Environment variables — never commit real env files
.env
.env.local
.env.*.local

# Local secrets — filled-in copy of actions.env, never commit
actions.env

# Build output
dist/

# Dependencies
node_modules/

# Coverage
coverage/

# Local dev — not for production
docker-compose.local.yml
Dockerfile.local
local/

# OS
.DS_Store
```

---

## Step 4b — .dockerignore

Create `.dockerignore` with this content (exact — do not abbreviate):

```dockerignore
# Build output
dist/

# Dependencies (reinstalled inside the image)
node_modules/

# Environment files — never bake secrets into an image
.env
.env.*
actions.env

# Local dev
docker-compose.local.yml
Dockerfile.local
local/

# Git
.git/
.gitignore

# Editor
.vscode/
.idea/

# Test & coverage
coverage/
tests/

# OS
.DS_Store
```

---

## Step 5 — package.json scripts

Ensure these scripts exist in `package.json` for every service that uses Prisma:

```json
"scripts": {
  "build":        "tsc",
  "start":        "node dist/index.js",
  "dev":          "tsx watch src/index.ts",
  "test":         "vitest run",
  "lint":         "eslint src/",
  "db:push":      "prisma db push --skip-generate",
  "db:generate":  "prisma generate"
}
```

`db:push` is the key script — it applies the Prisma schema to the database
idempotently. It is called during every production deploy (see Step 6).
`--skip-generate` avoids re-running client generation (already done at build time).

---

## Step 6 — GitHub Actions pipeline

Create `.github/workflows/ci-cd.yml`.

The pipeline uses **Infisical** for secret injection and **appleboy/ssh-action**
for deployment. `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` silences Node 20
deprecation warnings from bundled action runtimes.

```yaml
name: CI / CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  IMAGE_NAME: ${{ secrets.DOCKER_USERNAME }}/{{SERVICE_NAME}}
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  checks:
    name: Type-check · Lint · Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      {{IF_PRISMA}}- run: npx prisma generate
      {{/IF_PRISMA}}- run: npx tsc --noEmit
      - run: npx eslint src/
      - run: npx vitest run --passWithNoTests

  build-and-push:
    name: Build & push Docker image
    runs-on: ubuntu-latest
    needs: checks
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    outputs:
      image_tag: ${{ steps.meta.outputs.sha_tag }}
    steps:
      - uses: actions/checkout@v4
      - id: meta
        run: |
          SHA_TAG=sha-${{ github.sha }}
          echo "sha_tag=${SHA_TAG}" >> $GITHUB_OUTPUT
      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_TOKEN }}
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ env.IMAGE_NAME }}:${{ steps.meta.outputs.sha_tag }}
            ${{ env.IMAGE_NAME }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    name: Deploy to production
    runs-on: ubuntu-latest
    needs: build-and-push
    steps:
      - uses: appleboy/ssh-action@v1.0.3
        with:
          host:     ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key:      ${{ secrets.SERVER_SSH_KEY }}
          script: |
            set -e
            export PATH="$HOME/.local/bin:$PATH"

            DEPLOY_DIR="$HOME/katisha/{{SERVICE_DIR}}"
            REPO_URL="https://github.com/${{ github.repository }}.git"

            if [ -d "$DEPLOY_DIR/.git" ]; then
              cd "$DEPLOY_DIR"
              git pull origin main
            else
              mkdir -p "$HOME/katisha"
              git clone "$REPO_URL" "$DEPLOY_DIR"
              cd "$DEPLOY_DIR"
            fi

            cat > .env <<ENVEOF
            DOCKER_USERNAME=${{ secrets.DOCKER_USERNAME }}
            IMAGE_TAG=${{ needs.build-and-push.outputs.image_tag }}
            ENVEOF

            INFISICAL_TOKEN=$(infisical login \
              --method=universal-auth \
              --client-id=${{ secrets.INFISICAL_CLIENT_ID }} \
              --client-secret=${{ secrets.INFISICAL_CLIENT_SECRET }} \
              --domain=http://localhost:8080 \
              --plain --silent)

            {{IF_PRISMA}}# Apply schema changes before starting the container.
            # Runs npm run db:push inside a temporary container using the just-built
            # image — Node is not installed on the host.
            DB_PASSWORD=$(infisical secrets get DB_PASSWORD \
              --token="$INFISICAL_TOKEN" \
              --projectId=${{ secrets.INFISICAL_PROJECT_ID }} \
              --env=dev \
              --path=/{{INFISICAL_PATH}} \
              --domain=http://localhost:8080 \
              --plain 2>/dev/null)

            docker run --rm \
              --network katisha-net \
              -e DB_PASSWORD="${DB_PASSWORD}" \
              -e DATABASE_URL="postgresql://{{DB_USER}}:${DB_PASSWORD}@pgbouncer:6432/{{DB_NAME}}?pgbouncer=true&connect_timeout=5&pool_timeout=5" \
              ${{ secrets.DOCKER_USERNAME }}/{{SERVICE_NAME}}:${{ needs.build-and-push.outputs.image_tag }} \
              npm run db:push

            {{/IF_PRISMA}}infisical run \
              --token="$INFISICAL_TOKEN" \
              --projectId=${{ secrets.INFISICAL_PROJECT_ID }} \
              --env=dev \
              --path=/{{INFISICAL_PATH}} \
              --domain=http://localhost:8080 \
              -- docker compose up -d --no-deps --pull always {{CONTAINER_NAME}}

            echo "Waiting for {{CONTAINER_NAME}} to be healthy..."
            for i in $(seq 1 30); do
              STATUS=$(docker inspect --format='{{.State.Health.Status}}' {{CONTAINER_NAME}} 2>/dev/null || echo "missing")
              [ "$STATUS" = "healthy" ] && break
              [ $i -eq 30 ] && echo "Timed out waiting for {{CONTAINER_NAME}}" && exit 1
              sleep 3
            done

            echo "{{CONTAINER_NAME}} is up."
```

**Placeholders to replace:**

| Placeholder | Example |
|---|---|
| `{{SERVICE_NAME}}` | `audit-svc` (Docker Hub image name) |
| `{{SERVICE_DIR}}` | `audit-service` (directory under `~/katisha/`) |
| `{{CONTAINER_NAME}}` | `audit-svc` (Docker container name) |
| `{{INFISICAL_PATH}}` | `audit-svc` (Infisical secrets path) |
| `{{DB_USER}}` | `audit_svc` (postgres role) |
| `{{DB_NAME}}` | `audit_db` (postgres database) |

**Rules:**
- The `checks` job runs on every push and every PR — never skip it
- `build-and-push` and `deploy` only run on pushes to `main`
- Always push both the SHA tag and `latest`
- `db:push` runs **before** the container starts — schema is always applied first
- `db:push` is idempotent — safe to run on every deploy, not just first deploy
- Node is not on the host; run `npm run db:push` inside a `docker run --rm` using
  the just-built image connected to `katisha-net`
- The runtime image must be `node:22-bookworm-slim` (not distroless) so that
  `npm` is available when the image is used as a job runner for `db:push`

---

## Step 6 — GitHub secrets setup script

Create `scripts/setup-github-secrets.sh`:

```bash
#!/usr/bin/env bash
# =============================================================================
# setup-github-secrets.sh
#
# Registers all GitHub Actions secrets for the {{SERVICE_NAME}} repo.
#
# Usage:
#   1. cp scripts/setup-github-secrets.sh scripts/setup-github-secrets.prod.sh
#   2. Fill in every YOUR_* placeholder in the .prod copy
#   3. bash scripts/setup-github-secrets.prod.sh
#
# Prerequisites: gh CLI installed and authenticated (gh auth login)
# =============================================================================
set -euo pipefail

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "Setting secrets for: ${REPO}"

DOCKER_USERNAME="YOUR_DOCKERHUB_USERNAME"
DOCKER_TOKEN="YOUR_DOCKERHUB_ACCESS_TOKEN"

SSH_HOST="YOUR_SERVER_IP_OR_HOSTNAME"
SSH_USER="YOUR_SERVER_SSH_USER"
SSH_PORT="22"
SSH_PRIVATE_KEY_PATH="YOUR_PATH_TO_PRIVATE_KEY"

DEPLOY_PATH="YOUR_SERVER_DEPLOY_PATH"

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
```

Make it executable: `chmod +x scripts/setup-github-secrets.sh`

---

## Step 7 — Remote server setup script

Create `scripts/setup-remote-server.sh`:

```bash
#!/usr/bin/env bash
# =============================================================================
# setup-remote-server.sh
#
# One-time setup of the production server for {{SERVICE_NAME}}.
# Idempotent — safe to re-run.
#
# Usage:
#   1. cp scripts/setup-remote-server.sh scripts/setup-remote-server.prod.sh
#   2. Fill in every YOUR_* placeholder in the .prod copy
#   3. bash scripts/setup-remote-server.prod.sh
# =============================================================================
set -euo pipefail

SSH_HOST="YOUR_SERVER_IP_OR_HOSTNAME"
SSH_USER="YOUR_SERVER_SSH_USER"
SSH_PORT="22"
SSH_KEY="YOUR_PATH_TO_PRIVATE_KEY"
DEPLOY_PATH="YOUR_SERVER_DEPLOY_PATH"

DOCKER_USERNAME="YOUR_DOCKERHUB_USERNAME"
DOCKER_TOKEN="YOUR_DOCKERHUB_ACCESS_TOKEN"

# --- All service env vars ---
NODE_ENV="production"
PORT="{{PORT}}"
# Add every variable the service requires here

SSH_CMD="ssh -i ${SSH_KEY} -p ${SSH_PORT} -o StrictHostKeyChecking=no ${SSH_USER}@${SSH_HOST}"
SCP_CMD="scp -i ${SSH_KEY} -P ${SSH_PORT} -o StrictHostKeyChecking=no"

echo "→ Creating deployment directory"
$SSH_CMD "mkdir -p ${DEPLOY_PATH}"

echo "→ Uploading docker-compose.yml"
$SCP_CMD docker-compose.yml "${SSH_USER}@${SSH_HOST}:${DEPLOY_PATH}/docker-compose.yml"

echo "→ Writing .env on server"
$SSH_CMD "cat > ${DEPLOY_PATH}/.env" << EOF
NODE_ENV=${NODE_ENV}
PORT=${PORT}
DOCKER_USERNAME=${DOCKER_USERNAME}
IMAGE_TAG=latest
# --- paste all service vars here ---
EOF

echo "→ Creating katisha-net network (skipped if exists)"
$SSH_CMD "docker network inspect katisha-net > /dev/null 2>&1 || docker network create katisha-net"

echo "→ Docker Hub login on server"
$SSH_CMD "echo '${DOCKER_TOKEN}' | docker login --username '${DOCKER_USERNAME}' --password-stdin"

echo "→ Initial pull and start"
$SSH_CMD "cd ${DEPLOY_PATH} && docker compose pull {{SERVICE_NAME}} && docker compose up -d {{SERVICE_NAME}}"

echo ""
echo "✓ Server setup complete."
echo "  Logs: ssh ${SSH_USER}@${SSH_HOST} 'docker logs -f katisha-{{SERVICE_NAME}}'"
```

Make it executable: `chmod +x scripts/setup-remote-server.sh`

---

## Step 8 — Verification checklist

After completing all steps, verify:

- [ ] `docker build -t test .` succeeds locally
- [ ] `docker run --rm -e NODE_ENV=production -e PORT={{PORT}} ... test` starts without errors
- [ ] `bash scripts/setup-github-secrets.prod.sh` reports all secrets set
- [ ] `bash scripts/setup-remote-server.prod.sh` completes without errors
- [ ] Push to `main` — all three pipeline jobs pass in GitHub Actions
- [ ] `docker logs katisha-{{SERVICE_NAME}}` on the server shows the service started
- [ ] `grep IMAGE_TAG /path/to/.env` shows `sha-<commit>` not `latest`

---

## Required GitHub secrets (all 7)

| Secret | Description |
|---|---|
| `DOCKER_USERNAME` | Docker Hub username |
| `DOCKER_TOKEN` | Docker Hub access token (not password) |
| `SSH_HOST` | Production server IP or hostname |
| `SSH_USER` | Linux user with docker access on the server |
| `SSH_PORT` | SSH port (usually `22`) |
| `SSH_PRIVATE_KEY` | Private key for SSH auth (dedicated deploy key recommended) |
| `DEPLOY_PATH` | Absolute path to the deployment directory on the server |

---

## What NOT to do

- Do not use `build:` in `docker-compose.yml` — the server pulls images, it
  never builds
- Do not use `node:22-alpine` — musl libc causes argon2 segfaults
- Do not use `CMD ["node", "dist/index.js"]` in distroless — the entrypoint
  is already `node`
- Do not run `npm ci` in the production Docker stage — prune in builder, copy
- Do not put real secrets in any committed file — `.env`, `.prod.sh` are
  gitignored for this reason
- Do not deploy on PR — only `push` to `main` triggers build and deploy
- Do not use `latest` as the running IMAGE_TAG on the server — always use
  the SHA tag for traceability and rollback
