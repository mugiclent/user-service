/**
 * consumeSudoToken — shared sudo guard
 *
 * Copy this file into any service that needs to protect
 * an endpoint with sudo token validation.
 *
 * Currently required by:
 *   Trip Service  → POST /api/v1/tickets           (action: 'purchase_ticket')
 *   User Service  → PATCH /api/v1/users/me         (action: 'change_password', when password in body)
 *   User Service  → DELETE /api/v1/users/me        (action: 'delete_account')
 *
 * The Trip Service must add to its ticket creation handler:
 *   await consumeSudoToken(
 *     req.headers['x-sudo-token'] as string | undefined,
 *     req.user.id,
 *     'purchase_ticket',
 *     getRedisClient()
 *   )
 */

import type { Redis } from 'ioredis';
import { errors as JoseErrors } from 'jose';
import { AppError } from '../utils/AppError.js';
import { verifySudoToken } from '../utils/sudoToken.js';

export const consumeSudoToken = async (
  token: string | undefined,
  expectedUserId: string,
  expectedAction: string,
  redis: Redis,
): Promise<void> => {
  if (!token) {
    throw new AppError('STEP_UP_REQUIRED', 403);
  }

  let payload;
  try {
    payload = await verifySudoToken(token);
  } catch (err) {
    if (err instanceof JoseErrors.JWTExpired) {
      throw new AppError('STEP_UP_EXPIRED', 403);
    }
    throw new AppError('STEP_UP_INVALID', 403);
  }

  if (payload.type !== 'sudo') throw new AppError('STEP_UP_INVALID', 403);
  if (payload.action !== expectedAction) throw new AppError('STEP_UP_INVALID', 403);
  if (payload.sub !== expectedUserId) throw new AppError('STEP_UP_MISMATCH', 403);

  const remainingTtl = payload.exp - Math.floor(Date.now() / 1000);
  const claimed = await redis.set(
    `sudo:used:${payload.jti}`,
    '1',
    'EX',
    Math.max(remainingTtl, 1),
    'NX',
  );

  if (claimed === null) {
    throw new AppError('STEP_UP_ALREADY_USED', 403);
  }
};
