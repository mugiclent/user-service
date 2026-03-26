# tests/

Unit and integration tests. Coverage gate: ≥ 80% lines and functions, ≥ 70% branches.

## Structure

| Directory | Purpose |
|---|---|
| [`unit/`](unit/README.md) | Pure logic tests — all external deps mocked with `vi.mock()` |
| [`integration/`](integration/README.md) | Full HTTP stack tests — Supertest against a real Postgres test DB |
| `helpers/` | Shared seed functions and test utilities |

## Running tests

```bash
npm test                   # run all tests once
npm run test:watch         # watch mode
npm run test:coverage      # run with coverage report
```

## Conventions

See [`skills/TEST.md`](../skills/TEST.md) for the full ruleset.

Key rules:
- Every auth endpoint that calls `sendAuthResponse` must have both a **web** test and a **mobile** test
- Integration tests use `TEST_DATABASE_URL` — never the development database
- Unit tests mock all I/O (`prisma`, `ioredis`, `amqplib`) with `vi.mock()`
- Test names follow: `describe('POST /auth/login')` → `it('web: sets HttpOnly cookies')`
