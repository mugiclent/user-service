# Authentication & Authorization Architecture

This document covers the full lifecycle of a JWT — from issuance at login to verification
on every subsequent request — and explains how authentication is distributed across the
API gateway and microservices without duplication.

---

## 1. Token issuance (login)

When a user logs in successfully, the user-service issues two tokens:

```
POST /api/v1/auth/login
                │
                ▼
        AuthService.login()
                │
                ├── verify password (Argon2)
                ├── check status (suspended / pending_verification)
                │
                ▼
        TokenService.issueTokenPair(userWithRoles)
                │
                ├── buildAccessToken(user)
                │     ├── collectPermissions(user)       — read role_permissions + user_permissions from DB
                │     ├── buildRulesForUser(...)         — expand permission levels into CASL rules
                │     ├── packRules(rules)               — compact binary-safe encoding (~70% smaller)
                │     └── jwt.sign(payload, PRIVATE_KEY, { algorithm: 'RS256' })
                │
                └── store SHA-256(rawRefreshToken) in DB  — never the raw token
```

### Access token payload (JWT claims)

```json
{
  "sub":        "user-uuid",
  "org_id":     "org-uuid | null",
  "user_type":  "passenger | staff",
  "role_slugs": ["org_admin"],
  "rules":      [ ...packed CASL rules... ],
  "iat":        1711234567,
  "exp":        1711235467
}
```

| Claim | Purpose |
|---|---|
| `sub` | User identity — becomes `X-User-ID` header at the gateway |
| `org_id` | Org scope — becomes `X-Org-ID` header |
| `user_type` | Coarse type check (passenger vs staff) |
| `role_slugs` | Role names — services use these for admin/org-admin branching without a DB call |
| `rules` | Packed CASL rules — authorization decisions happen entirely from this field |

**Why RS256?** The private key lives only in the user-service. Any service (gateway, future
microservices) can verify tokens using only the public key — no shared secret, no round-trip
to the user-service on each request.

---

## 2. Public key distribution (JWKS)

The user-service exposes its RSA public key at the standard OIDC discovery endpoint:

```
GET /.well-known/jwks.json
```

Response:
```json
{
  "keys": [{
    "kty": "RSA",
    "use": "sig",
    "alg": "RS256",
    "kid": "katisha-user-service-1",
    "n": "...",
    "e": "AQAB"
  }]
}
```

The API gateway fetches this on startup and caches it. On key rotation, bump `kid` and
the gateway will re-fetch. No service restart required.

---

## 3. Subsequent requests — what the gateway does

Every request passes through the API gateway before reaching any microservice.

```
Client request (with JWT in cookie or Authorization: Bearer header)
        │
        ▼
   API Gateway
        │
        ├── 1. Extract JWT from cookie or Authorization header
        ├── 2. Verify RS256 signature using cached JWKS public key
        ├── 3. Check exp claim (token expiry)
        ├── 4. Check Redis: GET blacklist:user:<sub>   → 401 if present
        ├── 5. Check Redis: GET blacklist:org:<org_id> → 401 if present (staff only)
        │
        ├── FAIL any of the above → return 401 to client, request never reaches a service
        │
        └── PASS → strip the JWT, inject trusted headers, forward request:
                   X-User-ID:    <sub>
                   X-Org-ID:     <org_id>      (omit if null)
                   X-User-Type:  <user_type>
                   X-User-Roles: <JSON array of role_slugs>
                   X-User-Rules: <JSON array of packed CASL rules>
```

**Why the gateway checks Redis:**
When a user is suspended or deleted, the user-service writes a Redis blacklist entry with a
TTL matching the access token lifetime (15 minutes). This gives immediate revocation without
waiting for the short-lived token to naturally expire. The gateway enforces it — services
never need to check.

**Why services are private (not publicly accessible):**
Since only the gateway can reach the services, only the gateway can set `X-User-*` headers.
A client cannot inject fake identity headers — they never reach the service directly.

---

## 4. What microservices do

Because the gateway has already verified identity, **microservices do zero JWT work**.

### authenticate middleware (`src/middleware/authenticate.ts`)

```typescript
export const authenticate = (req, _res, next) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return next(new AppError('UNAUTHORIZED', 401));

  req.user = {
    id:         userId,
    org_id:     req.headers['x-org-id'] ?? null,
    user_type:  req.headers['x-user-type'],
    role_slugs: JSON.parse(req.headers['x-user-roles'] ?? '[]'),
    rules:      unpackRules(JSON.parse(req.headers['x-user-rules'] ?? '[]')),
  };
  next();
};
```

No async. No DB. No Redis. No JWT library. Just header deserialization.

### authorize middleware (`src/middleware/authorize.ts`)

```typescript
export const authorize = (action: Actions, subject: Subjects) =>
  (req, _res, next) => {
    const ability = buildAbilityFromRules(req.user.rules);
    if (!ability.can(action, subject)) return next(new AppError('FORBIDDEN', 403));
    next();
  };
```

No async. No DB. CASL checks the unpacked rules that came from the JWT.

### Route wiring

```typescript
// Unauthenticated — no middleware
router.post('/login', validate(loginSchema), ctrl.login);

// Authenticated, no authz check (every authenticated user can read their own profile)
router.get('/me', authenticate, ctrl.getMe);

// Authenticated + route-level gate (checks action:subject against JWT rules)
router.get('/',    authenticate, authorize('read',   'User'), ctrl.listUsers);
router.post('/',   authenticate, authorize('create', 'User'), ctrl.createUser);
router.delete('/:id', authenticate, authorize('delete', 'User'), ctrl.deleteUser);
```

---

## 5. Adding a new microservice

For a new service to participate in this auth model:

1. **Copy `authenticate.ts` and `authorize.ts`** — they have no user-service dependencies
2. **Copy `ability.ts`** — or publish it as a shared package
3. **Add `X-User-*` headers to every authenticated route** — the gateway injects them automatically
4. **Never add JWT verification** — the gateway already did it
5. **Never call the user-service to validate identity** — trust the headers

The new service does not need:
- The RSA public key or JWKS
- Redis
- Any JWT library at runtime
- Network access to the user-service for auth decisions

---

## 6. Token refresh

The refresh token never goes through the gateway's JWT verification (it is not a JWT).
The client sends the raw refresh token; the user-service hashes it, looks up the hash in DB,
and issues a new access + refresh pair.

```
POST /api/v1/auth/refresh
        │
        ▼
TokenService.rotateRefreshToken(rawToken)
        │
        ├── hash(rawToken) → look up in DB
        ├── if revoked → TOKEN_REUSE_DETECTED → wipe all sessions for this user
        ├── if expired → INVALID_REFRESH_TOKEN
        ├── fetch user with roles from DB (for fresh rules)
        ├── mark old token revoked
        └── issue new access + refresh token pair
```

Fresh rules are packed into the new access token at rotation time. Role changes take effect
on the next token refresh without requiring a logout.

---

## 7. Revocation

| Event | What happens |
|---|---|
| Logout | Single refresh token revoked in DB. Access token expires naturally (≤15 min). |
| Logout all devices | All refresh tokens revoked for user. |
| User suspended | Refresh tokens revoked + `blacklist:user:<id>` set in Redis (TTL = 900s). Gateway blocks immediately. |
| User deleted | Same as suspended + `deleted_at` set. |
| Org suspended | `blacklist:org:<id>` set in Redis. All org members blocked at gateway. |
| Password reset | All refresh tokens revoked for user (force re-login). |

Access tokens are short-lived (15 min) by design. Redis blacklisting covers the window
between a revocation event and natural token expiry.

---

## 8. Key generation and rotation

**Generate keys** (run once per environment):
```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Set in `.env`:
```
JWT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

**Rotate keys:**
1. Generate a new key pair
2. Add a new entry to the JWKS response (with a new `kid`) alongside the old one
3. Update `JWT_PRIVATE_KEY` in the user-service — new tokens use the new key
4. Wait one access token lifetime (15 min) — all old tokens expire
5. Remove the old `kid` from the JWKS response
6. Update the gateway's `JWT_PUBLIC_KEY` (if baked in config rather than fetched from JWKS)
