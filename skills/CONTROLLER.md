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
- **204 responses** (`logout`, `logout-all`, `refresh` web path): `res.status(204).end()` — no body.
- Controllers receive a hydrated `req.user` from Passport — trust it, don't re-query.
- For audit logging, call `audit()` after the service call, before returning (fire-and-forget).

## sendAuthResponse — dual-client serializer

```ts
// src/utils/sendAuthResponse.ts
import { Request, Response } from 'express';
import { config } from '../config';

interface AuthTokens { access: string; refresh: string; }
interface AuthUser   { id: string; first_name: string; last_name: string; /* ... */ }

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
      httpOnly: true,
      secure:   config.isProd,
      sameSite: 'lax',
      path:     '/',
      maxAge:   15 * 60 * 1000,
    })
    .cookie('refresh_token', tokens.refresh, {
      httpOnly: true,
      secure:   config.isProd,
      sameSite: 'lax',
      path:     '/api/v1/auth/refresh',
      maxAge:   30 * 24 * 60 * 60 * 1000,
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

See `utils/AppError.ts` for the class definition.
