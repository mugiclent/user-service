import jwt from 'jsonwebtoken';
import { packRules } from '@casl/ability/extra';
import type { PackRule } from '@casl/ability/extra';
import type { AppRule } from './ability.js';
import { config } from '../config/index.js';

export interface JwtPayload {
  sub: string;
  org_id: string | null;
  user_type: 'passenger' | 'staff';
  role_slugs: string[];
  rules: PackRule<AppRule>[];
}

/**
 * Sign a short-lived access token containing the user's identity and
 * packed CASL rules for zero-DB-hit authorization.
 */
export const signAccessToken = (
  payload: Omit<JwtPayload, 'rules'> & { rules: AppRule[] },
): string => {
  const { rules, ...rest } = payload;
  const tokenPayload: JwtPayload = { ...rest, rules: packRules(rules) };
  return jwt.sign(tokenPayload as object, config.jwt.privateKey, {
    algorithm: 'RS256',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expiresIn: config.jwt.expiresIn as any, // jsonwebtoken v9 uses branded StringValue from ms
  });
};

/**
 * Verify and decode an access token.
 * Throws JsonWebTokenError / TokenExpiredError on invalid input.
 */
export const verifyAccessToken = (token: string): JwtPayload =>
  jwt.verify(token, config.jwt.publicKey, { algorithms: ['RS256'] }) as JwtPayload;
