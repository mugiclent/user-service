# src/config/

Environment variable validation and the single exported config object.
`process.env` is only accessed here — everywhere else imports from this directory.

## Files

| File | Purpose |
|---|---|
| `env.ts` | Joi schema that validates all env vars at startup; crashes fast on missing/invalid values |
| `index.ts` | Typed `config` object exported for use across the service |

## Conventions

See [`skills/CONFIG.md`](../../skills/CONFIG.md).

Key rules:
- Never access `process.env` outside this directory
- `env.ts` is the source of truth — `.env.example` must mirror it exactly
- The `config` object is `as const` — treat it as read-only

## Example

```ts
// anywhere in the codebase
import { config } from '../config/index.js';

const ttl = config.jwt.expiresIn;
```

## Do not

- Import `process.env.SOMETHING` directly in services, middleware, or loaders
- Add a config value without also adding it to `.env.example`
- Use fallback defaults for required secrets (e.g. `process.env.JWT_SECRET ?? 'dev'`) — fail fast
