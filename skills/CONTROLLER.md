# CONTROLLER.md — Controller Conventions

A controller is a thin HTTP adapter. It calls a service, then sends the response. Nothing else.

## Pattern

```ts
// src/api/auth.controller.ts
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { sendAuthResponse } from '../utils/sendAuthResponse';

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user, tokens } = await AuthService.login(req.body);
    sendAuthResponse(req, res, { user, tokens });
  } catch (err) {
    next(err);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await AuthService.logout(req);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
```

## Rules

- **Always `try/catch` → `next(err)`**. Never let async errors escape uncaught.
- **Never import Prisma** directly in a controller. Call the service layer.
- **Never inspect `X-Client-Type`** in a controller. Use `sendAuthResponse()` for all auth responses.
- **Never build error responses inline** (`res.status(401).json(...)`). Throw or call `next(new AppError(...))`.
- **204 responses** (`logout`, `logout-all`): `res.status(204).end()` — no body.
- Controllers receive a hydrated `req.user` from Passport — trust it, don't re-query.

## Presigned URL controller pattern

```ts
// src/api/user.controller.ts
export const getAvatarPresignedUrl = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const contentType = req.query['content_type'] as string;
    const result = await MediaService.generateUserAvatarPresignedUrl(
      (req.user as AuthenticatedUser).id,
      contentType,
    );
    // result = { uploadUrl: 'http://...?X-Amz-...', path: 'avatars/user-id/uuid.jpg' }
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};
```

The client then:
1. PUTs file bytes directly to `uploadUrl` (bypasses this service entirely)
2. PATCHes `/me` with `{ avatar_path: "avatars/user-id/uuid.jpg" }` to commit the path

## Org logo — admin vs own-org controller

```ts
// src/api/org.controller.ts
export const getLogoPresignedUrl = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as AuthenticatedUser;
    // Platform admin passes /:id; org_admin uses /me (falls back to their own org_id)
    const orgId = req.params['id'] ?? user.org_id;
    if (!orgId) return next(new AppError('FORBIDDEN', 403));
    const result = await MediaService.generateOrgLogoPresignedUrl(orgId, req.query['content_type'] as string);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};
```

## sendAuthResponse — dual-client serializer

```ts
// src/utils/sendAuthResponse.ts
export const sendAuthResponse = (
  req: Request,
  res: Response,
  { user, tokens }: { user: AuthUser; tokens: AuthTokens }
) => {
  const isMobile = req.headers['x-client-type'] === 'mobile';

  if (isMobile) {
    return res.status(200).json({
      access_token:  tokens.access,
      refresh_token: tokens.refresh,
      token_type:    'Bearer',
      expires_in:    900,
      user,
    });
  }

  // Web: cookies only, user in body
  res
    .cookie('access_token', tokens.access, {
      httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/', maxAge: 15 * 60 * 1000,
    })
    .cookie('refresh_token', tokens.refresh, {
      httpOnly: true, secure: config.isProd, sameSite: 'lax',
      path: '/api/v1/auth/refresh', maxAge: 30 * 24 * 60 * 60 * 1000,
    })
    .status(200)
    .json({ user });
};
```

## AppError — error contract

All thrown errors must be `AppError` instances. The global error handler converts them to the wire format.

```ts
// Wire format → { error: { code: 'SCREAMING_SNAKE', message: '...' } }
throw new AppError('INVALID_CREDENTIALS', 401);
throw new AppError('ACCOUNT_SUSPENDED',   403);
throw new AppError('VALIDATION_ERROR',    422, joiDetails);
```
