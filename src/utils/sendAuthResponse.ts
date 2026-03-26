import type { Request, Response } from 'express';
import { config } from '../config/index.js';
import type { AuthUserDto } from '../models/serializers.js';

export type { AuthUserDto as AuthUser };

export interface AuthTokens {
  access: string;
  refresh: string;
}

/**
 * Serializes an auth response for both web and mobile clients.
 *
 * Web  (default): sets HttpOnly cookies, returns { user } in body.
 * Mobile         : returns { access_token, refresh_token, token_type, expires_in, user } in body.
 *
 * Client type is determined solely by the X-Client-Type request header.
 */
export const sendAuthResponse = (
  req: Request,
  res: Response,
  { user, tokens }: { user: AuthUserDto; tokens: AuthTokens },
): void => {
  const isMobile = req.headers['x-client-type'] === 'mobile';

  if (isMobile) {
    res.status(200).json({
      access_token: tokens.access,
      refresh_token: tokens.refresh,
      token_type: 'Bearer',
      expires_in: 900,
      user,
    });
    return;
  }

  // Web: deliver tokens as HttpOnly cookies, user object in body only
  res
    .cookie('access_token', tokens.access, {
      httpOnly: true,
      secure: config.cookie.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60 * 1000,
    })
    .cookie('refresh_token', tokens.refresh, {
      httpOnly: true,
      secure: config.cookie.secure,
      sameSite: 'lax',
      path: '/api/v1/auth/refresh',
      maxAge: config.jwt.refreshTtlMs,
    })
    .status(200)
    .json({ user });
};

/**
 * Clear auth cookies server-side (web logout / post-password-reset).
 * Mobile clients have no cookies — this is a no-op for them.
 */
export const clearAuthCookies = (res: Response): void => {
  res
    .clearCookie('access_token', { path: '/' })
    .clearCookie('refresh_token', { path: '/api/v1/auth/refresh' });
};

/**
 * Send a refresh response — no user object, tokens only.
 *
 * Web:    set new cookies, respond 204 No Content.
 * Mobile: respond 200 with { access_token, refresh_token, token_type, expires_in }.
 */
export const sendRefreshResponse = (
  req: Request,
  res: Response,
  tokens: AuthTokens,
): void => {
  const isMobile = req.headers['x-client-type'] === 'mobile';

  if (isMobile) {
    res.status(200).json({
      access_token: tokens.access,
      refresh_token: tokens.refresh,
      token_type: 'Bearer',
      expires_in: 900,
    });
    return;
  }

  res
    .cookie('access_token', tokens.access, {
      httpOnly: true,
      secure: config.cookie.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60 * 1000,
    })
    .cookie('refresh_token', tokens.refresh, {
      httpOnly: true,
      secure: config.cookie.secure,
      sameSite: 'lax',
      path: '/api/v1/auth/refresh',
      maxAge: config.jwt.refreshTtlMs,
    })
    .status(204)
    .end();
};
