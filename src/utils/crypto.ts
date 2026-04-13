import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';

/**
 * SHA-256 hex digest of a token string.
 * Used to store refresh tokens and password reset tokens without exposing raw values.
 */
export const hashToken = (raw: string): string =>
  createHash('sha256').update(raw).digest('hex');

/**
 * Generate a cryptographically random opaque token.
 * Default 32 bytes → 43 base64url characters.
 */
export const generateRawToken = (bytes = 32): string =>
  randomBytes(bytes).toString('base64url');

/**
 * Hash a password with Argon2id.
 */
export const hashPassword = (plain: string): Promise<string> =>
  argon2.hash(plain, { type: argon2.argon2id });

/**
 * Verify a plain password against an Argon2 hash.
 */
export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  argon2.verify(hash, plain);
