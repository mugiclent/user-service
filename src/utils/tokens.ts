import jwt from 'jsonwebtoken';
import { packRules } from '@casl/ability/extra';
import type { PackRule } from '@casl/ability/extra';
import type { SubjectRawRule } from '@casl/ability';
import { config } from '../config/index.js';

export interface JwtPayload {
  sub: string;
  org_id: string | null;
  user_type: 'passenger' | 'staff';
  rules: PackRule<SubjectRawRule>[];
}

/**
 * Sign a short-lived access token containing the user's identity and
 * packed CASL rules for zero-DB-hit authorization.
 */
export const signAccessToken = (
  payload: Omit<JwtPayload, 'rules'> & { rules: SubjectRawRule[] },
): string => {
  const { rules, ...rest } = payload;
  const tokenPayload: JwtPayload = { ...rest, rules: packRules(rules) };
  return jwt.sign(tokenPayload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
};

/**
 * Verify and decode an access token.
 * Throws JsonWebTokenError / TokenExpiredError on invalid input.
 */
export const verifyAccessToken = (token: string): JwtPayload =>
  jwt.verify(token, config.jwt.secret) as JwtPayload;
