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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign(tokenPayload as object, config.jwt.privateKey, {
    algorithm: 'EdDSA' as any, // @types/jsonwebtoken doesn't include EdDSA yet; library supports it since v9
    expiresIn: config.jwt.expiresIn as any, // jsonwebtoken v9 uses branded StringValue from ms
  });
};

/**
 * Verify and decode an access token.
 * Throws JsonWebTokenError / TokenExpiredError on invalid input.
 */
export const verifyAccessToken = (token: string): JwtPayload =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jwt.verify(token, config.jwt.publicKey, { algorithms: ['EdDSA' as any] }) as unknown as JwtPayload;
