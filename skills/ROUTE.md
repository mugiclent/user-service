# ROUTE.md — Route File Conventions

A route file owns only the HTTP wiring. Zero business logic.

## Pattern

```ts
// src/api/auth.routes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { loginSchema } from '../middleware/schemas/auth.schema';
import * as ctrl from './auth.controller';

const router = Router();

// Public routes
router.post('/login',         validate(loginSchema),        ctrl.login);
router.post('/register',      validate(registerSchema),     ctrl.register);
router.post('/verify-phone',  validate(verifyPhoneSchema),  ctrl.verifyPhone);
router.post('/forgot-password', validate(forgotSchema),     ctrl.forgotPassword);
router.post('/reset-password',  validate(resetSchema),      ctrl.resetPassword);

// Authenticated routes (cookie or bearer)
router.post('/refresh', ctrl.refresh);   // token comes from cookie or header — no body schema
router.post('/logout',  authenticate,    ctrl.logout);
router.post('/logout-all', authenticate, ctrl.logoutAll);

export default router;
```

## Rules

- **One router per domain file** (`auth.routes.ts`, `user.routes.ts`). Files are flat in `/src/api/` — no subfolders.
- **Middleware order:** `[authenticate?]` → `validate(schema)` → `controller.method`
- **All routes mount under `/api/v1/`** — prefix added in the loader, not in the route file.
- **Never** call `res.json()`, `prisma.*`, or service functions inside a route file.
- **Never** inspect `X-Client-Type` in a route file — that belongs in the `sendAuthResponse` util.
- **Error responses** must flow via `next(err)` to the global error handler — never inline `res.status(400).json(...)`.

## validate() middleware factory

```ts
// src/middleware/validate.ts
import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { AppError } from '../utils/AppError';

export const validate = (schema: Joi.ObjectSchema) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) return next(new AppError('VALIDATION_ERROR', 422, error.details));
    req.body = value;
    next();
  };
```

## Registering routers in the loader

```ts
// src/loaders/express.ts
import authRouter from '../api/auth.routes';
import userRouter from '../api/user.routes';

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', userRouter);
```
