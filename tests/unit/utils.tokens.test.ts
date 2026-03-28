/**
 * Tests for src/utils/tokens.ts
 * Covers: signAccessToken, verifyAccessToken
 */
import { describe, it, expect, vi } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockSign = vi.fn().mockReturnValue('signed.jwt.token');
const mockVerify = vi.fn().mockReturnValue({ sub: 'u-1', org_id: null, user_type: 'staff', role_slugs: [], rules: [] });
const mockPackRules = vi.fn().mockReturnValue([]);

vi.mock('jsonwebtoken', () => ({
  default: { sign: mockSign, verify: mockVerify },
}));

vi.mock('@casl/ability/extra', () => ({
  packRules: mockPackRules,
  unpackRules: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/config/index.js', () => ({
  config: {
    jwt: {
      privateKey: 'TEST_PRIVATE_KEY',
      publicKey: 'TEST_PUBLIC_KEY',
      expiresIn: '15m',
    },
  },
}));

const { signAccessToken, verifyAccessToken } = await import('../../src/utils/tokens.js');

// ── signAccessToken ────────────────────────────────────────────────────────────

describe('signAccessToken', () => {
  it('calls jwt.sign with RS256 and packed rules', () => {
    const payload = { sub: 'u-1', org_id: null, user_type: 'staff' as const, role_slugs: ['org_admin'], rules: [] };
    const token = signAccessToken(payload);
    expect(token).toBe('signed.jwt.token');
    expect(mockSign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'u-1', rules: [] }),
      'TEST_PRIVATE_KEY',
      expect.objectContaining({ algorithm: 'RS256' }),
    );
  });

  it('packs rules before signing', () => {
    signAccessToken({ sub: 'u-1', org_id: 'o-1', user_type: 'staff', role_slugs: [], rules: [{ action: 'read', subject: 'User' }] });
    expect(mockPackRules).toHaveBeenCalled();
  });
});

// ── verifyAccessToken ──────────────────────────────────────────────────────────

describe('verifyAccessToken', () => {
  it('calls jwt.verify with RS256 and returns payload', () => {
    const result = verifyAccessToken('some.token.here');
    expect(mockVerify).toHaveBeenCalledWith('some.token.here', 'TEST_PUBLIC_KEY', { algorithms: ['RS256'] });
    expect(result).toMatchObject({ sub: 'u-1' });
  });

  it('propagates errors from jwt.verify', () => {
    mockVerify.mockImplementationOnce(() => { throw new Error('invalid token'); });
    expect(() => verifyAccessToken('bad.token')).toThrow('invalid token');
  });
});
