# src/middleware/

Custom Express middleware. Each file is a focused, single-responsibility middleware
or middleware factory.

## Files

| File | Purpose |
|---|---|
| `authenticate.ts` | Passport JWT guard — attaches `req.user` and `req.ability` (CASL) |
| `validate.ts` | `validate(schema)` factory — runs Joi validation on `req.body`, calls `next(AppError)` on failure |
| `rateLimiter.ts` | Redis-backed rate limiter factories for login, OTP, and password reset |
| `errorHandler.ts` | Global Express error handler — converts `AppError` to `{ error: { code, message } }` |
| `schemas/` | Joi schemas for each request body (e.g. `auth.schema.ts`, `user.schema.ts`) |

## Conventions

See [`skills/ROUTE.md`](../../skills/ROUTE.md) for how middleware is composed in route files.

Key rules:
- Middleware must call `next()` or `next(err)` — never swallow errors silently
- `authenticate.ts` hydrates `req.ability` from packed JWT rules via CASL `unpackRules`
- Rate limiter middleware is applied per-route in the route file, not globally
- `errorHandler.ts` is registered last in the Express loader — after all routes

## Example

```ts
// authenticate.ts
passport.authenticate('jwt', { session: false }, (err, user) => {
  if (!user) return next(new AppError('UNAUTHORIZED', 401));
  req.user = user;
  req.ability = buildAbility(unpackRules(user.rules));
  next();
})(req, res, next);
```

## Do not

- Access the database directly in middleware — delegate to a service if needed
- Put Joi schemas inline in route files — they belong in `schemas/`
- Register `errorHandler` before routes
