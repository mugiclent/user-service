# SERVICE.md — Service Layer Conventions

Services own all business logic. They have no knowledge of HTTP — no `req`, no `res`, no cookies, no headers.

## Pattern

```ts
// src/services/auth.service.ts
import { prisma } from '../models';
import { hashToken, verifyPassword } from '../utils/crypto';
import { signAccessToken, signRefreshToken } from '../utils/tokens';
import { AppError } from '../utils/AppError';
import { publishAudit, publishNotification } from '../utils/publishers';

export const AuthService = {
  async login({ identifier, password, device_name }: LoginDto) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ phone_number: identifier }, { email: identifier }],
      },
    });

    // Deliberate: never reveal which field was wrong
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new AppError('INVALID_CREDENTIALS', 401);
    }
    if (user.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED', 403);
    if (user.status === 'pending_verification') throw new AppError('PHONE_NOT_VERIFIED', 403);

    const tokens = await issueTokenPair(user, device_name);
    return { user: serializeUser(user), tokens };
  },

  // ... other methods
};
```

## Rules

- **No HTTP imports** (`express`, `Request`, `Response`, `next`). Services are framework-agnostic.
- **Throw `AppError`** with the canonical error code and HTTP status. Never return error objects.
- **All DB access via Prisma** — imported from `../models` (the re-export). Never construct raw SQL.
- **`org_id` scoping for staff**: Prisma middleware handles injection automatically for multi-tenant queries. Services must NOT manually add `where.org_id` unless bypassing for admin operations (document why).
- **Passengers** are not org-scoped — skip `org_id` filter when `user.user_type === 'passenger'`.
- **Token issuance** lives in the service, using helpers from `utils/tokens.ts`.
- **Side effects** (audit logs, notifications) are published to RabbitMQ via `utils/publishers.ts` — fire-and-forget, wrapped in try/catch that only logs on failure, never throws.

## CASL rules in JWT

```ts
// utils/tokens.ts
import { packRules } from '@casl/ability/extra';

export const signAccessToken = (user: User, ability: AppAbility): string => {
  const payload: JwtPayload = {
    sub:       user.id,
    org_id:    user.org_id,
    user_type: user.user_type,
    rules:     packRules(ability.rules),
  };
  return jwt.sign(payload, config.jwt.secret, { expiresIn: '15m' });
};
```

Keep `packRules` output under 4 KB. If the payload exceeds this, audit which permissions are bloating it.

## Refresh token lifecycle

```ts
// Always store SHA-256(raw_token), never the raw token
const rawToken   = crypto.randomBytes(40).toString('hex');
const tokenHash  = hashToken(rawToken);          // SHA-256

await prisma.refreshToken.create({
  data: { token_hash: tokenHash, user_id: user.id, device_name, expires_at },
});

return rawToken; // sent to client, never stored
```

On refresh: hash the incoming token, look up by hash. On reuse detection (already-revoked hash found): wipe ALL `RefreshToken` rows for that user.

## RabbitMQ events the service publishes

| Exchange / Queue  | Event key               | When                         |
|-------------------|-------------------------|------------------------------|
| `audit-logs`      | —                       | Every state-changing action  |
| `notifications`   | `otp.send`              | After OTP creation           |
| `notifications`   | `password_reset.send`   | After reset token creation   |
| `notifications`   | `user.registered`       | After successful registration |

See `utils/publishers.ts` for the publish helpers.
