# tests/integration/

Full HTTP stack tests using Supertest. These tests hit a real Postgres database
(`TEST_DATABASE_URL`) and real Redis. Prisma is not mocked.

## Files

| File | Purpose |
|---|---|
| `auth.login.test.ts` | POST /auth/login — web cookies, mobile body, error cases, rate limiting |
| `auth.register.test.ts` | POST /auth/register — creates user, triggers OTP notification |
| `auth.verify-phone.test.ts` | POST /auth/verify-phone — OTP validation, expiry, reuse |
| `auth.forgot-password.test.ts` | POST /auth/forgot-password — always 200, rate limiting |
| `auth.reset-password.test.ts` | POST /auth/reset-password — valid/expired/used tokens |
| `auth.refresh.test.ts` | POST /auth/refresh — rotation, reuse detection, wipe-all-sessions |
| `auth.logout.test.ts` | POST /auth/logout and POST /auth/logout-all |

## Pattern

```ts
beforeAll(async () => { /* app is already connected via test setup */ });
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
      expect.arrayContaining([expect.stringContaining('HttpOnly')])
    );
  });

  it('mobile: returns tokens in body', async () => {
    // ...
  });
});
```
