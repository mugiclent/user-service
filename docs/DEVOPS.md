# DevOps — Docker, Deployment & CI/CD Pipeline

This document covers every decision made around containerisation, deployment
strategy, and the automated pipeline for this service. Follow this when
onboarding a new engineer or replicating the setup for another microservice.

---

## 1. Docker base image selection

### The problem with `node:22-alpine`

Alpine Linux uses **musl libc** instead of glibc. Most Node.js native addons
(including `argon2`) ship prebuilt binaries compiled against glibc. On Alpine,
npm discards the prebuilt binaries and compiles from source against musl — which
has documented SIGSEGV (segfault) crash vectors in `argon2`'s secure-memory wipe
code path on Node 16+. For a service where `argon2` is in the password
verification hot path, a production segfault is a real failure mode, not a
theoretical one.

### CVE comparison (March 2026 scan)

| Image | Total CVEs | Critical | High | libc | argon2 safe |
|---|---|---|---|---|---|
| `node:22-alpine` | 2 | 0 | 0 | musl | **No** — SIGSEGV risk |
| `node:22-bookworm-slim` | 31 | 0 | 4 | glibc | Yes |
| `gcr.io/distroless/nodejs22-debian12` | ~15 | **0** | **0** | glibc | Yes |
| `cgr.dev/chainguard/node` | 0 | 0 | 0 | glibc (Wolfi) | Yes |

### Decision: `distroless/nodejs22-debian12`

- Zero critical/high CVEs
- glibc-based — argon2 prebuilt binaries load without recompilation
- No shell, no package manager, no OS utilities in the production image
  (smallest possible attack surface)
- Free, no version-pinning constraints (unlike Chainguard's free tier which
  only offers `latest`)

Chainguard is the gold standard (0 total CVEs, nightly rebuilds) but the free
tier has no pinned version tags — automatic major Node.js version upgrades are
an operational risk for a production service. Revisit if a paid subscription
becomes available.

---

## 2. Dockerfile — multi-stage build

```
┌─────────────────────────────────┐
│  Stage 1: builder               │
│  node:22-bookworm-slim          │
│                                 │
│  • Installs build tools         │
│    (python3, make, g++)         │
│    → compiles argon2 native     │
│      addon against glibc        │
│  • npm ci (all deps)            │
│  • npx prisma generate          │
│  • npm run build (tsc → dist/)  │
│  • npm prune --omit=dev         │
│    → strips devDependencies     │
└────────────┬────────────────────┘
             │  COPY --from=builder
             ▼
┌─────────────────────────────────┐
│  Stage 2: production            │
│  gcr.io/distroless/nodejs22     │
│                                 │
│  • node_modules/ (prod only,    │
│    includes .node binary)       │
│  • dist/  (compiled JS)         │
│  • package.json                 │
│  • prisma/  (schema)            │
│                                 │
│  No shell · No build tools      │
│  No package manager             │
└─────────────────────────────────┘
```

**Key rule**: `npm prune --omit=dev` runs in the **builder** stage, then
`node_modules/` is copied to production. The production stage never runs
`npm install` or `npm ci` — so build tools (`python3`, `make`, `g++`) never
exist in the final image.

**CMD format**: distroless nodejs images use `node` as their entrypoint. Pass
only the script path:

```dockerfile
CMD ["dist/index.js"]   # correct — distroless prepends `node` automatically
CMD ["node", "dist/index.js"]  # wrong — would run `node node dist/index.js`
```

---

## 3. docker-compose.yml design

### Pre-built image (not `build:`)

The compose file uses a pre-built image pulled from Docker Hub, not a local
build. This means the server never needs the source code, Node.js, or build
tools installed.

```yaml
image: ${DOCKER_USERNAME}/katisha-user-service:${IMAGE_TAG:-latest}
```

Both `DOCKER_USERNAME` and `IMAGE_TAG` come from the server's `.env` file. The
CI pipeline updates `IMAGE_TAG` on each deploy (see §5).

### Environment variables

All env vars are read from the Linux environment (or a `.env` file on the
server). The compose file contains no hardcoded values — every value is
`${VAR_NAME}`. This means:

- The same `docker-compose.yml` works across all environments
- Secrets never touch the Git repository
- Rotating a secret = update `.env` on the server + restart the container

### External network

```yaml
networks:
  katisha-net:
    external: true
```

`katisha-net` is a pre-existing Docker bridge network shared across all Katisha
microservices on the same host. It must be created once manually before the
first deploy:

```bash
docker network create katisha-net
```

Services on `katisha-net` can reach each other by container name
(e.g. `katisha-user-service`) without exposing ports to the host.

---

## 4. Port convention

Default port is `3001`. The `PORT` env var overrides it.

```yaml
ports:
  - "${PORT:-3001}:${PORT:-3001}"
```

The Dockerfile sets `ENV PORT=3001` and `EXPOSE 3001` as the production
default. Each microservice in the platform gets its own port in the `3001+`
range to avoid conflicts when running on the same host.

---

## 5. CI/CD pipeline — `.github/workflows/ci-cd.yml`

### Three-job pipeline

```
on: push to main  ──┐       on: pull_request
                    │
         ┌──────────▼──────────┐
         │       checks        │  (runs on every push + PR)
         │  tsc --noEmit       │
         │  eslint src/ tests/ │
         │  vitest run         │
         └──────────┬──────────┘
                    │ needs: checks
                    │ if: push to main only
         ┌──────────▼──────────┐
         │   build-and-push    │
         │  docker buildx      │
         │  push :sha-<hash>   │
         │  push :latest       │
         └──────────┬──────────┘
                    │ needs: build-and-push
         ┌──────────▼──────────┐
         │       deploy        │
         │  SSH → server       │
         │  update IMAGE_TAG   │
         │  docker compose     │
         │    pull + up -d     │
         └─────────────────────┘
```

Quality checks run on every branch and every pull request. The build and deploy
jobs only run on pushes to `main` — a PR that fails checks can never deploy.

### Build caching

```yaml
cache-from: type=gha
cache-to: type=gha,mode=max
```

GitHub Actions cache is used for the Docker layer cache. On a warm cache,
rebuilds that only change `src/` (not `package.json` or `prisma/`) skip the
`npm ci` and `prisma generate` layers — typically 60–80% faster.

---

## 6. IMAGE_TAG strategy — SHA vs latest

Two tags are pushed on every successful build:

| Tag | Example | Purpose |
|---|---|---|
| `sha-<commit>` | `sha-abc1234ef` | Immutable — identifies the exact commit |
| `latest` | `latest` | Floating — always points to the newest build |

**The server always runs the SHA tag**, never `latest`. The deploy step writes
the SHA into `.env`:

```bash
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=sha-abc1234ef/" .env
docker compose pull user-service
docker compose up -d --no-deps user-service
```

This means:
- `cat .env | grep IMAGE_TAG` tells you exactly which commit is live
- Rollback = change `IMAGE_TAG` to any previous SHA + `docker compose up -d`
- `latest` is a convenience for manual pulls and local testing only

---

## 7. `--no-deps` on deploy

```bash
docker compose up -d --no-deps user-service
```

`--no-deps` restarts **only** the user-service container. Without it, Docker
Compose would also restart every service that `user-service` depends on (if any
`depends_on` exists), which could cause unintended downtime for other services
sharing the same compose file or network.

---

## 8. GitHub Actions secrets

Set via `scripts/setup-github-secrets.sh` (see §9). All seven must be present
before the first push to `main`.

| Secret | What it is |
|---|---|
| `DOCKER_USERNAME` | Docker Hub account username |
| `DOCKER_TOKEN` | Docker Hub access token — create at hub.docker.com → Account Settings → Security. Use a token, not your password |
| `SSH_HOST` | IP address or hostname of the production server |
| `SSH_USER` | Linux user on the server (must have docker access — either root or in the `docker` group) |
| `SSH_PORT` | SSH port, typically `22` |
| `SSH_PRIVATE_KEY` | Private key whose public counterpart is in `~/.ssh/authorized_keys` on the server. Use a dedicated deploy key, not your personal key |
| `DEPLOY_PATH` | Absolute path on the server where `docker-compose.yml` and `.env` live |

---

## 9. Setup scripts

Two scripts live in `scripts/`. Each has a `.prod` variant (gitignored) that
contains real values.

### `scripts/setup-github-secrets.sh`

Uses the `gh` CLI to register all GitHub Actions secrets in one command.
Requires `gh auth login` with repo admin access.

```bash
cp scripts/setup-github-secrets.sh scripts/setup-github-secrets.prod.sh
# fill in YOUR_* placeholders in the .prod file
bash scripts/setup-github-secrets.prod.sh
```

### `scripts/setup-remote-server.sh`

One-time server bootstrap. Idempotent — safe to re-run. Does:

1. Creates the deployment directory on the server
2. Uploads `docker-compose.yml` via SCP
3. Writes the `.env` file directly on the server over SSH (no intermediate
   local file)
4. Creates the `katisha-net` network if absent
5. Logs Docker Hub in on the server (`~/.docker/config.json`)
6. Pulls the image and starts the service

```bash
cp scripts/setup-remote-server.sh scripts/setup-remote-server.prod.sh
# fill in YOUR_* placeholders in the .prod file
bash scripts/setup-remote-server.prod.sh
```

The `.prod` files are listed in `.gitignore` and must never be committed.

---

## 10. Full deployment lifecycle

```
Developer pushes to main
         │
         ▼
GitHub Actions runs checks (tsc, eslint, vitest)
         │ pass
         ▼
Docker image built with buildx (gha cache)
Tagged: sha-<commit> + latest
Pushed to Docker Hub
         │
         ▼
Pipeline SSHes into production server
  sed updates IMAGE_TAG=sha-<commit> in .env
  docker compose pull user-service   # downloads new image
  docker compose up -d --no-deps user-service  # recreates container
  docker image prune -f              # removes old dangling images
         │
         ▼
New container running sha-<commit> image
Old container stopped and removed
```

Total deploy time from push to live: typically 3–5 minutes depending on cache
hit rate.

---

## 11. Rollback procedure

```bash
# SSH into the server
ssh user@host

cd /path/to/deploy

# Check what's currently running
grep IMAGE_TAG .env

# Roll back to a previous SHA
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=sha-<previous-sha>/" .env
docker compose pull user-service
docker compose up -d --no-deps user-service
```

Previous image layers are available as long as they have not been pruned on the
server. The SHA tag on Docker Hub is permanent unless manually deleted.

---

## 12. Adding a new microservice

See [`skills/DEVOPS.md`](../skills/DEVOPS.md) for the step-by-step skill that
replicates this entire setup for any new Katisha microservice.
