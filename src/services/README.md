# src/services/

Business logic layer. Services are framework-agnostic — no `req`, `res`, or
Express imports. They are called by controllers and publish side effects to
RabbitMQ via the publishers utility.

## Files

| File | Purpose |
|---|---|
| `auth.service.ts` | Login, register, OTP verify, token refresh, logout, logout-all |
| `user.service.ts` | Profile reads and updates |
| `otp.service.ts` | OTP generation, validation, Redis TTL tracking, rate limiting |
| `password.service.ts` | Forgot-password token creation and reset-password flow |
| `token.service.ts` | Access token signing, refresh token issuance and rotation |

## Conventions

See [`skills/SERVICE.md`](../../skills/SERVICE.md).

Key rules:
- Throw `AppError` — never return error objects or raw strings
- All DB access via Prisma imported from `../models/index.js`
- Never add `where: { org_id }` manually — Prisma middleware handles scoping
- RabbitMQ publishes are fire-and-forget via `../utils/publishers.js`
- Refresh tokens are stored as SHA-256 hashes — never the raw token

## Example

```ts
export const AuthService = {
  async login({ identifier, password }: LoginDto) {
    const user = await prisma.user.findFirst({ where: { ... } });
    if (!user) throw new AppError('INVALID_CREDENTIALS', 401);
    return { user: serializeUser(user), tokens: await issueTokenPair(user) };
  },
};
```

## Do not

- Import `Request`, `Response`, or `NextFunction` from express
- Call `prisma.*` from a controller — go through a service
- Throw raw `Error` objects — always use `AppError` with a code
