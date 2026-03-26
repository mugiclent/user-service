import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import { buildAbilityFromRules } from '../utils/ability.js';
import type { Actions, Subjects } from '../utils/ability.js';
import type { AuthenticatedUser } from '../models/index.js';

/**
 * Route-level authorization gate.
 *
 * Checks whether req.user has ANY rule matching action+subject.
 * Conditions are NOT evaluated here — services handle object-level scope.
 * Returns 403 only when no rule at all matches.
 *
 * Usage:
 *   router.delete('/:id', authenticate, authorize('delete', 'User'), handler);
 *
 * Note: For conditioned rules (e.g. passenger has read:User scoped to own id),
 * ability.can('read', 'User') returns true — the route gate passes.
 * The service must then verify the condition holds for the specific resource.
 */
export const authorize = (action: Actions, subject: Subjects) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const ability = buildAbilityFromRules((req.user as AuthenticatedUser).rules);
    if (!ability.can(action, subject)) return next(new AppError('FORBIDDEN', 403));
    next();
  };
