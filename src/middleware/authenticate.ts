import type { Request, Response, NextFunction } from 'express';
import { unpackRules } from '@casl/ability/extra';
import type { PackRule } from '@casl/ability/extra';
import { AppError } from '../utils/AppError.js';
import type { AppRule } from '../utils/ability.js';

/**
 * Reads the trusted identity headers injected by the API gateway.
 * The gateway is responsible for JWT verification and Redis blacklist checks.
 * This middleware just deserializes the pre-verified identity into req.user.
 *
 * Expected headers (set by gateway, never by the client):
 *   X-User-ID    — user UUID
 *   X-Org-ID     — org UUID or absent for passengers
 *   X-User-Type  — "passenger" | "staff"
 *   X-User-Roles — JSON array of role slugs, e.g. ["org_admin"]
 *   X-User-Rules — JSON array of packed CASL rules
 */
export const authenticate = (req: Request, _res: Response, next: NextFunction): void => {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) return next(new AppError('UNAUTHORIZED', 401));

  try {
    const packedRules = JSON.parse(
      (req.headers['x-user-rules'] as string | undefined) ?? '[]',
    ) as PackRule<AppRule>[];

    req.user = {
      id: userId,
      org_id: (req.headers['x-org-id'] as string | undefined) ?? null,
      user_type: (req.headers['x-user-type'] as 'passenger' | 'staff') ?? 'passenger',
      role_slugs: JSON.parse(
        (req.headers['x-user-roles'] as string | undefined) ?? '[]',
      ) as string[],
      rules: unpackRules(packedRules),
    };
    next();
  } catch {
    next(new AppError('UNAUTHORIZED', 401));
  }
};
