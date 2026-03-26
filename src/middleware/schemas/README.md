# src/middleware/schemas/

Joi validation schemas for all request bodies.
One file per route domain, named to match its route file.

## Files

| File | Purpose |
|---|---|
| `auth.schema.ts` | Schemas for all `/auth/*` request bodies |
| `user.schema.ts` | Schemas for all `/users/*` request bodies |

## Conventions

- Export one named schema per endpoint: `loginSchema`, `registerSchema`, etc.
- Use `Joi.string().trim()` on all string fields
- Phone numbers: `Joi.string().pattern(/^\+\d{7,15}$/)` — E.164 format
- Passwords: `Joi.string().min(8).max(128)` — enforce minimum, cap maximum
- All schemas use `{ abortEarly: false }` (set in the `validate()` middleware, not here)
