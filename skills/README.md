# README.md — Documentation Conventions

Every directory in the project must have a `README.md`. The root `README.md` is the entry point and links to every child directory's `README.md`. The `skills/` directory is exempt from this rule.

---

## Root README.md

The root `README.md` is the service overview. It must contain:

1. **One-line service description** — what this service does and where it fits in the system
2. **Tech stack** — language, framework, DB, auth, messaging (one line each)
3. **Quick start** — how to get the service running locally (copy `.env.example`, install, migrate, run)
4. **Directory index** — a table linking every top-level directory to its `README.md` with a one-line description
5. **Environment variables** — reference to `.env.example` and what each group of vars controls
6. **API overview** — link to `docs/` or a brief table of endpoint groups
7. **Testing** — how to run tests and check coverage

### Root README template

```markdown
# user-service

Handles authentication, identity, and access control for Katisha Online.
Part of the Katisha microservices platform — communicates with the notification
service via RabbitMQ and exposes a REST API consumed by web and mobile clients.

## Stack
- **Runtime**: Node.js 20 + TypeScript
- **Framework**: Express + Passport.js (passport-jwt)
- **Database**: PostgreSQL via Prisma ORM
- **Auth**: Argon2 (hashing) · JWT access tokens · opaque refresh tokens
- **Authorization**: CASL with packed rules in JWT
- **Messaging**: RabbitMQ (`audit-logs` queue · `notifications` exchange)
- **Cache / Rate limiting**: Redis
- **Tests**: Vitest + Supertest · ≥ 80% line coverage

## Quick start

\`\`\`bash
cp .env.example .env          # fill in your local values
npm install
npx prisma migrate dev
npm run dev
\`\`\`

## Directories

| Directory | Purpose |
|-----------|---------|
| [`src/api/`](src/api/README.md) | Routes and controllers |
| [`src/config/`](src/config/README.md) | Env validation and config object |
| [`src/services/`](src/services/README.md) | Business logic |
| [`src/models/`](src/models/README.md) | Prisma client and model helpers |
| [`src/middleware/`](src/middleware/README.md) | Auth guards, rate limiter, validation |
| [`src/loaders/`](src/loaders/README.md) | Startup wiring (Express, DB, RabbitMQ, Passport) |
| [`src/subscribers/`](src/subscribers/README.md) | RabbitMQ inbound consumers |
| [`src/utils/`](src/utils/README.md) | Shared helpers (AppError, sendAuthResponse, publishers) |
| [`tests/`](tests/README.md) | Unit and integration tests |
| [`docs/`](docs/README.md) | OpenAPI spec and API documentation |
| [`prisma/`](prisma/README.md) | Schema, migrations, seed |

## Environment variables

See [`.env.example`](.env.example). Validated at startup — service crashes fast if misconfigured.
See [`src/config/`](src/config/README.md) for the full schema.

## API

Base path: `/api/v1/`

| Group | Routes |
|-------|--------|
| Auth | `/auth/login` · `/auth/register` · `/auth/verify-phone` · `/auth/forgot-password` · `/auth/reset-password` · `/auth/refresh` · `/auth/logout` · `/auth/logout-all` |
| Users | `/users/me` · `/users/:id` |

Full spec: [`docs/`](docs/README.md)

## Testing

\`\`\`bash
npm test                      # run all tests
npm run test:coverage         # run with coverage report (must be ≥ 80%)
\`\`\`

See [`tests/`](tests/README.md) for conventions.
```

---

## Child directory README.md

Each directory's `README.md` documents what lives there and how to work with it.

### Required sections (adjust per directory)

1. **Purpose** — one sentence on what this directory owns
2. **Files** — table of every file (or file pattern) and what it does
3. **Conventions** — the rules that apply specifically here (point to the relevant `skills/` file)
4. **Examples** — a short code snippet showing the canonical pattern for this layer
5. **Do not** — explicit anti-patterns to avoid here

### Example: `src/services/README.md`

```markdown
# src/services/

Business logic layer. Services have no knowledge of HTTP — no `req`, `res`,
or Express imports. They are called by controllers and publish side effects
to RabbitMQ.

## Files

| File | Purpose |
|------|---------|
| `auth.service.ts` | Login, register, OTP verify, token refresh, logout |
| `user.service.ts` | Profile reads and updates |
| `otp.service.ts` | OTP generation, validation, rate limiting |
| `password.service.ts` | Forgot-password and reset-password flows |

## Conventions

See [`skills/SERVICE.md`](../../skills/SERVICE.md) for the full ruleset.

Key rules:
- Throw `AppError` — never return error objects
- All DB access via Prisma imported from `../models`
- No `org_id` filtering in service code — Prisma middleware handles it
- RabbitMQ publishes are fire-and-forget via `../utils/publishers`

## Example

\`\`\`ts
export const AuthService = {
  async login({ identifier, password }: LoginDto) {
    const user = await prisma.user.findFirst({ where: { ... } });
    if (!user) throw new AppError('INVALID_CREDENTIALS', 401);
    // ...
    return { user: serializeUser(user), tokens };
  },
};
\`\`\`

## Do not

- Import `Request` or `Response` from express
- Call `prisma` directly from a controller
- Add `where: { org_id }` manually — the Prisma middleware does this
```

---

## Rules

- **Create the `README.md` when you create the directory**, not later.
- **Update the root `README.md` directory table** every time a new top-level directory is added.
- **Child READMEs must list every file** in that directory. When you add a file, update the table.
- **`skills/` is exempt** — it is meta-documentation, not a runtime directory.
- **`docs/` README** points to the OpenAPI spec and explains how to regenerate it.
- **`prisma/` README** lists the migration history summary and explains how to run migrations and seeds.
- **Keep READMEs short** — if a README grows past ~80 lines, the directory probably has too many responsibilities.
