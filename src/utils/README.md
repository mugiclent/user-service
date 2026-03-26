# src/utils/

Shared, stateless helper functions used across multiple layers.
Nothing here should contain business logic or external I/O beyond what is
explicitly its purpose (e.g. `publishers.ts` does publish to RabbitMQ by design).

## Files

| File | Purpose |
|---|---|
| `AppError.ts` | Custom error class — `new AppError('CODE', status)` — caught by `errorHandler` |
| `sendAuthResponse.ts` | Dual-client response serializer — inspects `X-Client-Type`, sets cookies (web) or returns tokens in body (mobile) |
| `publishers.ts` | RabbitMQ publish helpers: `publishAudit()`, `publishNotification()` — fire-and-forget |
| `tokens.ts` | JWT signing (`signAccessToken`) and refresh token generation (`generateRefreshToken`) |
| `crypto.ts` | `hashToken()` (SHA-256), `hashPassword()` (Argon2), `verifyPassword()` (Argon2 verify) |

## Conventions

- All functions are pure or have clearly isolated side effects
- `AppError` is the only way to signal errors through the stack — no raw `Error` objects
- `sendAuthResponse` is the only place that reads `X-Client-Type` — never check it elsewhere
- `publishers.ts` wraps publish calls in `try/catch` and only logs on failure — never throws

## Example

```ts
import { AppError } from '../utils/AppError.js';
import { sendAuthResponse } from '../utils/sendAuthResponse.js';
import { publishAudit } from '../utils/publishers.js';

throw new AppError('INVALID_CREDENTIALS', 401);
sendAuthResponse(req, res, { user, tokens });
publishAudit({ actor_id: user.id, action: 'login', resource: 'User', resource_id: user.id });
```

## Do not

- Add business logic to utils — if it needs the DB, it belongs in a service
- Throw from `publishAudit` or `publishNotification` — side effects must never crash the main flow
- Read `X-Client-Type` anywhere outside `sendAuthResponse.ts`
