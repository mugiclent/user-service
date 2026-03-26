# src/api/

Routes and controllers. Files are flat — no subdirectories.

A route file wires HTTP paths to controller methods. A controller file is a
thin adapter that calls a service and sends the response. Neither contains
business logic.

## Files

| File | Purpose |
|---|---|
| `auth.routes.ts` | Route definitions for `/api/v1/auth/*` |
| `auth.controller.ts` | Request handlers for all auth endpoints |
| `user.routes.ts` | Route definitions for `/api/v1/users/*` |
| `user.controller.ts` | Request handlers for user profile endpoints |

## Conventions

See [`skills/ROUTE.md`](../../skills/ROUTE.md) and [`skills/CONTROLLER.md`](../../skills/CONTROLLER.md).

Key rules:
- Route files call `validate(schema)` and mount controller methods — nothing else
- Controllers `try/catch` every handler and call `next(err)` on failure
- All auth responses go through `sendAuthResponse()` — never inline cookies or tokens
- Never import Prisma in this layer

## Example

```ts
// auth.routes.ts
router.post('/login', validate(loginSchema), ctrl.login);

// auth.controller.ts
export const login = async (req, res, next) => {
  try {
    const result = await AuthService.login(req.body);
    sendAuthResponse(req, res, result);
  } catch (err) { next(err); }
};
```

## Do not

- Call `prisma.*` or any service directly from a route file
- Call `res.json({ error: ... })` inline — throw `AppError` and let the error handler format it
- Split auth and user into subdirectories — keep this layer flat
