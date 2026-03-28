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
    auth.messaging.test.ts
    user.messaging.test.ts
    invitation.messaging.test.ts
    org.messaging.test.ts
    password.messaging.test.ts
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
// tests/unit/auth.messaging.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mock all external modules BEFORE importing the service under test ──────
const publishAudit = vi.fn();
const publishSms   = vi.fn();
const publishMail  = vi.fn();
vi.mock('../../src/utils/publishers.js', () => ({ publishAudit, publishSms, publishMail }));

import type * as CryptoModule from '../../src/utils/crypto.js';

vi.mock('../../src/utils/crypto.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CryptoModule>();
  return { ...actual, generateRawToken: vi.fn(() => 'test-token'), hashToken: vi.fn((t) => `hashed:${t}`) };
});

vi.mock('../../src/config/index.js', () => ({ config: { appUrl: 'https://app.katisha.com' } }));

// Always mock s3.js — it creates S3 clients at module load using config.s3.*
// If s3.js is not mocked, tests will fail with "Cannot read properties of undefined (reading 'accessKey')"
vi.mock('../../src/utils/s3.js', () => ({
  deleteFromS3: vi.fn(),
  keyFromPublicUrl: vi.fn(() => null),
}));

vi.mock('../../src/models/index.js', () => ({
  prisma: { user: { findFirst: vi.fn() } },
  Prisma: {},
}));

// Import service AFTER all vi.mock() calls
const { AuthService } = await import('../../src/services/auth.service.js');

beforeEach(() => vi.clearAllMocks());

describe('AuthService.login', () => {
  it('publishes audit event on successful login', async () => {
    // ... test body
    expect(publishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'login', resource: 'User' }),
    );
  });
});
```

**Critical rules for unit test mock ordering:**
1. `vi.mock()` calls are hoisted to the top of the file — put them before all imports
2. Always mock `../../src/utils/s3.js` in any test file that imports a service using S3
3. Import the service under test AFTER all `vi.mock()` declarations (use `await import(...)`)
4. Use `beforeEach(() => vi.clearAllMocks())` — never share mock state between tests

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
      ])
    );
  });

  it('mobile: returns tokens in body', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Client-Type', 'mobile')
      .send({ identifier: '+250788000001', password: 'Test1234!' });

    expect(res.body).toHaveProperty('access_token');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
```

## Mocking $transaction in unit tests

When the service under test calls `prisma.$transaction(async (tx) => ...)`, mock it as:

```ts
vi.mock('../../src/models/index.js', () => ({
  prisma: {
    user: { create: mockUserCreate, findUniqueOrThrow: mockFindUniqueOrThrow },
    role: { findFirst: mockRoleFindFirst },
    userRole: { create: mockUserRoleCreate },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user:       { create: mockUserCreate, findUniqueOrThrow: mockFindUniqueOrThrow },
        userRole:   { create: mockUserRoleCreate },
        invitation: { update: mockInvitationUpdate },
      };
      return fn(tx);
    }),
  },
  Prisma: {},
}));
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
      thresholds: { lines: 80, functions: 80, branches: 70 },
      exclude: ['src/loaders/**', 'prisma/**', 'skills/**', 'docs/**'],
    },
  },
});
```

Run: `vitest run --coverage` — fails CI if thresholds not met.

## Rules

- **Dual-client test**: every auth endpoint that uses `sendAuthResponse` must have both a web test and a mobile test.
- **Seed helpers** go in `tests/helpers/seed.ts` — shared across integration tests. Never duplicate seed logic.
- **Never mock Prisma in integration tests** — use a real test database (`TEST_DATABASE_URL`).
- **Never use `setTimeout` or `sleep`** in tests — use `vi.useFakeTimers()` for time-sensitive logic.
- **Rate limiting** — mock Redis in unit tests with `vi.mock()`. Use real Redis in integration tests.
- **Test file naming**: `<feature>.<verb>.test.ts` for integration, `<feature>.messaging.test.ts` for unit messaging tests.
