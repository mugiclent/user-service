# TEST.md — Testing Conventions

## Stack

- **Vitest** — test runner
- **Supertest** — HTTP integration tests (works with the Express app object)
- **@vitest/coverage-v8** — coverage provider
- **Coverage gate: ≥ 80% lines and functions, ≥ 70% branches**

## Test structure

```
/tests
  /unit               # Pure logic — all external deps mocked
    auth.service.test.ts
    tokens.test.ts
    sendAuthResponse.test.ts
    AppError.test.ts
  /integration        # Full HTTP stack — real Postgres test DB, real Redis
    auth.login.test.ts
    auth.register.test.ts
    auth.refresh.test.ts
    auth.logout.test.ts
```

## Naming convention

```ts
// Always: describe = endpoint or unit, it = specific behavior
describe('POST /auth/login', () => {
  it('web: sets HttpOnly access_token and refresh_token cookies on success');
  it('web: body contains user object but no tokens');
  it('mobile: returns tokens and user in body, sets no cookies');
  it('returns 401 INVALID_CREDENTIALS for wrong password');
  it('returns 401 INVALID_CREDENTIALS for unknown identifier'); // same error — no enumeration
  it('returns 403 ACCOUNT_SUSPENDED for suspended users');
  it('returns 403 PHONE_NOT_VERIFIED for unverified passengers');
  it('returns 429 TOO_MANY_ATTEMPTS after 5 failures');
});
```

## Unit test pattern (mocked deps)

```ts
// tests/unit/auth.service.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/models', () => ({ prisma: { user: { findFirst: vi.fn() } } }));
vi.mock('../../src/utils/tokens', () => ({ signAccessToken: vi.fn(), signRefreshToken: vi.fn() }));
vi.mock('../../src/utils/publishers', () => ({ publishAudit: vi.fn(), publishNotification: vi.fn() }));

describe('AuthService.login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws INVALID_CREDENTIALS when user not found', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    await expect(AuthService.login({ identifier: 'x', password: 'y' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
  });
});
```

## Integration test pattern (real DB)

```ts
// tests/integration/auth.login.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/models';
import { seedUser } from '../helpers/seed';

beforeAll(async () => { /* connect test DB */ });
afterAll(async () => { await prisma.$disconnect(); });
beforeEach(async () => { await prisma.user.deleteMany(); }); // clean slate

describe('POST /api/v1/auth/login', () => {
  it('web: sets HttpOnly cookies', async () => {
    await seedUser({ phone_number: '+250788000001', password: 'Test1234!' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: '+250788000001', password: 'Test1234!' });

    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('access_token='),
        expect.stringContaining('HttpOnly'),
        expect.stringContaining('refresh_token='),
      ])
    );
    expect(res.body).toHaveProperty('user');
    expect(res.body).not.toHaveProperty('access_token');
  });

  it('mobile: returns tokens in body', async () => {
    await seedUser({ phone_number: '+250788000002', password: 'Test1234!' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Client-Type', 'mobile')
      .send({ identifier: '+250788000002', password: 'Test1234!' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    expect(res.body.token_type).toBe('Bearer');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
```

## Coverage configuration (vitest.config.ts)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines:     80,
        functions: 80,
        branches:  70,
      },
      exclude: [
        'src/loaders/**',   // startup glue — hard to unit test
        'prisma/**',
        'skills/**',
        'docs/**',
      ],
    },
  },
});
```

Run: `vitest run --coverage` — fails CI if thresholds not met.

## Rules

- **Dual-client test**: every auth endpoint that uses `sendAuthResponse` must have both a web test and a mobile test.
- **Seed helpers** go in `tests/helpers/seed.ts` — shared across integration tests. Never duplicate seed logic.
- **Never mock Prisma in integration tests** — use a real test database (separate `DATABASE_URL` env var).
- **Never use `setTimeout` or `sleep`** in tests — use `vi.useFakeTimers()` for time-sensitive logic.
- **Rate limiting** — mock Redis in unit tests with `vi.mock()`. Use real Redis in integration tests.
- **Test file naming**: `<feature>.<verb>.test.ts` for integration, `<unit>.test.ts` for unit.
