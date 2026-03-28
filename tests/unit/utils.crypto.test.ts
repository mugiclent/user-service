/**
 * Tests for src/utils/crypto.ts
 * Covers: hashToken, generateRawToken, hashPassword, verifyPassword
 */
import { describe, it, expect } from 'vitest';
import { hashToken, generateRawToken, hashPassword, verifyPassword } from '../../src/utils/crypto.js';

describe('hashToken', () => {
  it('returns a 64-char hex SHA-256 digest', () => {
    const h = hashToken('hello');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic for the same input', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('generateRawToken', () => {
  it('returns an 80-char hex string by default (40 bytes)', () => {
    const t = generateRawToken();
    expect(t).toHaveLength(80);
    expect(t).toMatch(/^[0-9a-f]+$/);
  });

  it('respects custom byte length', () => {
    expect(generateRawToken(16)).toHaveLength(32);
    expect(generateRawToken(32)).toHaveLength(64);
  });

  it('generates unique tokens on each call', () => {
    expect(generateRawToken()).not.toBe(generateRawToken());
  });
});

describe('hashPassword / verifyPassword', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces a different hash each time (salt)', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });
}, { timeout: 15000 });
