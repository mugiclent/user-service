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
router.post('/login',           validate(loginSchema),       ctrl.login);
router.post('/register',        validate(registerSchema),    ctrl.register);
router.post('/verify-phone',    validate(verifyPhoneSchema), ctrl.verifyPhone);
router.post('/forgot-password', validate(forgotSchema),      ctrl.forgotPassword);
router.post('/reset-password',  validate(resetSchema),       ctrl.resetPassword);

// Authenticated routes (cookie or bearer)
router.post('/refresh',     ctrl.refresh);        // token comes from cookie or header
router.post('/logout',      authenticate, ctrl.logout);
router.post('/logout-all',  authenticate, ctrl.logoutAll);

export default router;
```

## Rules

- **One router per domain file** (`auth.routes.ts`, `user.routes.ts`). Files are flat in `/src/api/` — no subfolders.
- **Middleware order:** `[authenticate]` → `[authorize(action, subject)]` → `[validate(schema)]` → `controller.method`
- **All routes mount under `/api/v1/`** — prefix added in the loader, not in the route file.
- **Never** call `res.json()`, `prisma.*`, or service functions inside a route file.
- **Error responses** must flow via `next(err)` to the global error handler.

## authorize() — route-level IAM gate

```ts
import { authorize } from '../middleware/authorize';

// Middleware order: authenticate → authorize → validate → controller
router.get('/',    authenticate, authorize('read',   'User'), UserController.listUsers);
router.post('/',   authenticate, authorize('create', 'User'), validate(schema), UserController.createUser);
router.patch('/:id', authenticate, authorize('update', 'User'), validate(schema), UserController.updateUser);
router.delete('/:id', authenticate, authorize('delete', 'User'), UserController.deleteUser);

// /me routes skip authorize() — every authenticated user may access their own profile
router.get('/me', authenticate, UserController.getMe);
router.patch('/me', authenticate, validate(updateMeSchema), UserController.updateMe);
```

`authorize(action, subject)` calls `ability.can(action, subject)` against the rules packed in
the JWT — **zero DB hits**. Returns 403 if no rule matches. Object-level scoping (e.g. checking
`org_id`) is handled inside service methods, not at the route level.

## Presigned URL route pattern

```ts
// Generate a presigned PUT URL — browser uploads directly to S3, never through this service
router.get('/me/avatar/presigned-url', authenticate, UserController.getAvatarPresignedUrl);

// After upload, client commits the path via PATCH /me { avatar_path: "avatars/..." }
router.patch('/me', authenticate, validate(updateMeSchema), UserController.updateMe);
```

Two separate presigned URL routes when both admin (by id) and own-org paths are needed:
```ts
router.get('/me/logo/presigned-url',  authenticate, authorize('update', 'Org'), ctrl.getLogoPresignedUrl);
router.get('/:id/logo/presigned-url', authenticate, authorize('update', 'Org'), ctrl.getLogoPresignedUrl);
```

## validate() middleware factory

```ts
// src/middleware/validate.ts
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
import orgRouter  from '../api/org.routes';

app.use('/api/v1/auth',          authRouter);
app.use('/api/v1/users',         userRouter);
app.use('/api/v1/organizations', orgRouter);

// JWKS endpoint — public key for token verification by API gateway / other services
// Compute once at startup; no DB hit on each request
app.get('/.well-known/jwks.json', jwksHandler);

// Swagger UI — non-prod only; must be registered BEFORE helmet() to avoid CSP blocking
if (!config.isProd) {
  app.use('/api/v1/users/docs', createSwaggerRouter());
}
```
