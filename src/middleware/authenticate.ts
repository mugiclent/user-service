import type { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { AppError } from '../utils/AppError.js';

/**
 * Passport JWT guard.
 * Attaches the authenticated user (with unpacked CASL rules) to `req.user`.
 * Returns 401 UNAUTHORIZED for missing or invalid tokens.
 */
export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  passport.authenticate(
    'jwt',
    { session: false },
    (err: unknown, user: Express.User | false) => {
      if (err) return next(err);
      if (!user) return next(new AppError('UNAUTHORIZED', 401));
      req.user = user;
      next();
    },
  )(req, res, next);
};
