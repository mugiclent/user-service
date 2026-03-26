import type { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../loaders/redis.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/AppError.js';

const increment = async (key: string, windowSeconds: number): Promise<number> => {
  const redis = getRedisClient();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count;
};

/**
 * Rate limiter for login — keyed by identifier (phone or email).
 * 5 attempts per 15 minutes by default (configurable via env).
 */
export const loginRateLimiter = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const identifier = (req.body as { identifier?: string }).identifier;
  if (!identifier) return next();

  const key = `ratelimit:login:${identifier}`;
  const { max, windowSeconds } = config.rateLimit.login;

  try {
    const count = await increment(key, windowSeconds);
    if (count > max) return next(new AppError('TOO_MANY_ATTEMPTS', 429));
  } catch {
    // Redis failure — fail open to avoid blocking all logins
  }

  next();
};

/**
 * Rate limiter for password reset — keyed by identifier.
 * 3 attempts per hour by default.
 */
export const resetRateLimiter = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const identifier = (req.body as { identifier?: string }).identifier;
  if (!identifier) return next();

  const key = `ratelimit:reset:${identifier}`;
  const { max, windowSeconds } = config.rateLimit.reset;

  try {
    const count = await increment(key, windowSeconds);
    if (count > max) return next(new AppError('TOO_MANY_ATTEMPTS', 429));
  } catch {
    // Redis failure — fail open
  }

  next();
};

/**
 * Rate limiter for OTP sends — keyed by phone number.
 * 3 sends per 10 minutes by default.
 */
export const otpRateLimiter = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const phone = (req.body as { phone_number?: string }).phone_number;
  if (!phone) return next();

  const key = `ratelimit:otp:${phone}`;
  const { maxAttempts: max, windowSeconds } = config.otp;

  try {
    const count = await increment(key, windowSeconds);
    if (count > max) return next(new AppError('TOO_MANY_ATTEMPTS', 429));
  } catch {
    // Redis failure — fail open
  }

  next();
};
