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
};
```

## Rules

- **No HTTP imports** (`express`, `Request`, `Response`, `next`). Services are framework-agnostic.
- **Throw `AppError`** with the canonical error code and HTTP status. Never return error objects.
- **All DB access via Prisma** — imported from `../models` (the re-export). Never construct raw SQL.
- **`org_id` scoping for staff**: Prisma middleware handles injection automatically for multi-tenant queries.
- **Passengers** are not org-scoped — skip `org_id` filter when `user.user_type === 'passenger'`.
- **Token issuance** lives in the service, using helpers from `utils/tokens.ts`.
- **Side effects** (audit logs, notifications) are published to RabbitMQ via `utils/publishers.ts` — fire-and-forget, wrapped in try/catch that only logs on failure, never throws.

## RS256 JWT — access token signing

Tokens are signed with an **RSA private key** (RS256). The public key is distributed via
`GET /.well-known/jwks.json` so any microservice can verify tokens without contacting this service.

```ts
// src/utils/tokens.ts
import jwt from 'jsonwebtoken';
import { packRules } from '@casl/ability/extra';
import { config } from '../config';

export const signAccessToken = (
  payload: Omit<JwtPayload, 'rules'> & { rules: AppRule[] },
): string => {
  const { rules, ...rest } = payload;
  return jwt.sign(
    { ...rest, rules: packRules(rules) },
    config.jwt.privateKey,
    { algorithm: 'RS256', expiresIn: config.jwt.expiresIn as any },
  );
};

export const verifyAccessToken = (token: string): JwtPayload =>
  jwt.verify(token, config.jwt.publicKey, { algorithms: ['RS256'] }) as JwtPayload;
```

**Key generation** (run once per environment):
```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```
Store each file's contents in `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` (single-line with `\n`).

## CASL rules in JWT

CASL rules are **packed into the JWT at login** and **unpacked by Passport** on every
authenticated request — zero DB hits for authorization decisions.

```ts
// Packed rules example (what's stored in the JWT 'rules' field):
[["create","User"], ["read","User",{"org_id":"abc"}], ["update","Org",{"id":"abc"}]]
```

Permissions come from the DB (`role_permissions`, `user_permissions`) and are collected by
`collectPermissions(user)` in `src/utils/ability.ts`. Keep packed rules under ~4 KB.

## IAM — permission levels and role conditions

Permission levels expand to CASL actions:

| DB level | CASL actions |
|---|---|
| `manage` | `manage` (covers all, including delete) |
| `write`  | `create`, `read`, `update` |
| `read`   | `read` |

Runtime conditions (org scoping, self-scoping) are applied in `buildRulesForUser` by role slug:

| Role | User condition | Org condition |
|---|---|---|
| `katisha_super_admin` / `katisha_admin` | none | none |
| `org_admin` | `{ org_id }` | `{ id: orgId }` |
| `dispatcher` | `{ org_id }` | `{ id: orgId }` |
| `driver` / `passenger` | `{ id: userId }` | — |

Route-level gate: `authorize('create', 'User')` middleware checks `ability.can(action, subject)`.
Object-level scope: services add `where.org_id` / `where.id` for conditioned roles.

## Presigned URL (S3 media upload)

Services never handle file bytes. The pattern is **Sign → Upload → Patch**:

```ts
// src/services/media.service.ts
import { generatePresignedPutUrl, userAvatarKey } from '../utils/s3';

export const MediaService = {
  async generateUserAvatarPresignedUrl(userId: string, contentType: string) {
    const path = userAvatarKey(userId, contentType);  // avatars/<userId>/<uuid>.jpg
    return generatePresignedPutUrl(path, contentType);
    // Returns: { uploadUrl: 'http://public-seaweedfs/...?X-Amz-...', path: 'avatars/...' }
  },
};
```

After upload, the client PATCHes the resource with `{ avatar_path: "avatars/..." }`.
The service stores **only the S3 key** (not a full URL) — changing the CDN requires zero DB migration.

Old files are deleted from S3 (fire-and-forget) when a new path is committed:
```ts
if ('avatar_path' in data && requestingUser.avatar_path) {
  deleteFromS3(requestingUser.avatar_path); // non-blocking
}
```

## Refresh token lifecycle

```ts
// Always store SHA-256(raw_token), never the raw token
const rawToken  = crypto.randomBytes(40).toString('hex');
const tokenHash = hashToken(rawToken); // SHA-256

await prisma.refreshToken.create({
  data: { token_hash: tokenHash, user_id: user.id, device_name, expires_at },
});

return rawToken; // sent to client, never stored
```

On refresh: hash the incoming token, look up by hash. On reuse detection (already-revoked hash found): wipe ALL `RefreshToken` rows for that user.

## RabbitMQ events the service publishes

| Exchange / Queue | Event key | When |
|---|---|---|
| `audit-logs` | — | Every state-changing action |
| `notifications` | `otp.sms` / `otp.mail` | After OTP creation |
| `notifications` | `password_reset.sms` / `password_reset.mail` | After reset token creation |
| `notifications` | `invite.sms` / `invite.mail` | After user invitation |
| `notifications` | `welcome.sms` / `welcome.mail` | After invite accepted |
| `notifications` | `org_approved.sms` / `org_approved.mail` | After org approval |

See `utils/publishers.ts` for the publish helpers.
