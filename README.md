# user-service

Handles authentication, identity, and access control for Katisha Online.
Part of the Katisha microservices platform — communicates with the notification
service via RabbitMQ and exposes a REST API consumed by web and mobile clients.

## Stack

| Concern | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript (ESM) |
| Framework | Express 4 + Passport.js (`passport-jwt`) |
| Database | PostgreSQL via Prisma ORM |
| Password hashing | Argon2 |
| Authorization | CASL (`@casl/ability`) with packed rules in JWT |
| Validation | Joi |
| Messaging | RabbitMQ — `audit-logs` queue · `notifications` exchange |
| Rate limiting | Redis (ioredis) |
| Tests | Vitest + Supertest · ≥ 80% line coverage |

## Quick start

```bash
cp .env.example .env          # fill in your local values
npm install
npx prisma migrate dev
npm run dev
```

## Directories

| Directory | Purpose |
|---|---|
| [`src/api/`](src/api/README.md) | Routes and controllers |
| [`src/config/`](src/config/README.md) | Env validation and config object |
| [`src/services/`](src/services/README.md) | Business logic |
| [`src/models/`](src/models/README.md) | Prisma client and model helpers |
| [`src/middleware/`](src/middleware/README.md) | Auth guards, rate limiter, request validation |
| [`src/loaders/`](src/loaders/README.md) | Startup wiring (Express, DB, RabbitMQ, Passport) |
| [`src/subscribers/`](src/subscribers/README.md) | RabbitMQ inbound consumers |
| [`src/utils/`](src/utils/README.md) | Shared helpers — AppError, sendAuthResponse, publishers |
| [`tests/`](tests/README.md) | Unit and integration tests |
| [`docs/`](docs/README.md) | OpenAPI spec and API documentation |
| [`prisma/`](prisma/README.md) | Schema, migrations, seed data |

## Environment variables

Copy `.env.example` and fill in your values. All variables are validated at
startup — the service will refuse to start if any required variable is missing.
See [`src/config/`](src/config/README.md) for the full schema.

## API

Base path: `/api/v1/`

| Group | Endpoints |
|---|---|
| Auth | `POST /auth/login` · `POST /auth/register` · `POST /auth/verify-phone` · `POST /auth/forgot-password` · `POST /auth/reset-password` · `POST /auth/refresh` · `POST /auth/logout` · `POST /auth/logout-all` |
| Users | `GET /users/me` · `PATCH /users/me` |

Full spec: [`docs/`](docs/README.md)

## Testing

```bash
npm test                   # run all tests once
npm run test:watch         # watch mode
npm run test:coverage      # run with coverage report (must be ≥ 80%)
```

See [`tests/`](tests/README.md) for conventions and patterns.

## Lint

```bash
npm run lint               # check
npm run lint:fix           # auto-fix
```
