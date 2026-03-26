# tests/unit/

Unit tests for services and utilities. All external dependencies (Prisma, Redis,
RabbitMQ) are mocked with `vi.mock()` — no real I/O.

## Files

| File | Purpose |
|---|---|
| `auth.service.test.ts` | AuthService: login, register, logout logic |
| `otp.service.test.ts` | OTP generation, expiry, rate limiting |
| `token.service.test.ts` | JWT signing, refresh token hashing, reuse detection |
| `password.service.test.ts` | Forgot-password and reset-password flows |
| `AppError.test.ts` | AppError class shape and properties |
| `sendAuthResponse.test.ts` | Web vs mobile response branching |
| `crypto.test.ts` | hashToken, hashPassword, verifyPassword |

## Pattern

```ts
vi.mock('../../src/models/index.js', () => ({
  prisma: { user: { findFirst: vi.fn() } },
}));

describe('AuthService.login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws INVALID_CREDENTIALS when user not found', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    await expect(AuthService.login({ identifier: 'x', password: 'y' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
  });
});
```
