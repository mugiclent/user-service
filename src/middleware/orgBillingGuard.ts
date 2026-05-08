import type { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../loaders/redis.js';
import { AppError } from '../utils/AppError.js';
import { buildAbilityFromRules, getScopeFor } from '../utils/ability.js';

// Mutating paths that remain accessible even when the org is billing-blocked.
// Must be specified as exact method+path pairs.
const BILLING_BYPASS: { method: string; path: string }[] = [
  { method: 'POST', path: '/api/v1/auth/logout' },
  { method: 'POST', path: '/api/v1/auth/logout-all' },
  { method: 'POST', path: '/api/v1/auth/refresh' },
  // Wallet top-up must remain accessible even when an org's billing is overdue
  { method: 'POST', path: '/api/v1/users/me/wallet/topup' },
];

const isBypassed = (req: Request): boolean => {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  return BILLING_BYPASS.some(
    (r) => r.method === req.method && r.path === req.path,
  );
};

/**
 * Reads the `org_blocked:{org_id}` key written by the billing-service.
 * If set, org members are restricted to read-only access (GET/HEAD) plus
 * a small allowlist of auth endpoints (logout, refresh).
 *
 * Bypasses:
 *  - Requests with no org_id (passengers, platform users without an org)
 *  - Platform-scoped staff (can still manage the affected org)
 *  - GET / HEAD requests
 *  - Explicitly allowlisted mutating paths (auth/logout, auth/refresh)
 */
export const orgBillingGuard = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = req.user;

    if (!user?.org_id) return next();
    if (isBypassed(req)) return next();

    const ability = buildAbilityFromRules(user.rules);
    if (getScopeFor(ability, 'read', 'User') === 'platform') return next();

    const blocked = await getRedisClient().exists(`org_blocked:${user.org_id}`);
    if (blocked) return next(new AppError('ORG_BILLING_OVERDUE', 403));

    next();
  } catch (err) {
    // Redis failure must not lock out users — fail open
    console.error('[orgBillingGuard] Redis check failed, failing open', err);
    next();
  }
};
