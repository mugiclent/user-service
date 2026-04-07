/**
 * Tests for src/utils/tokens.ts
 * Covers: signAccessToken, verifyAccessToken
 */
import { describe, it, expect, vi } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockSign = vi.fn().mockResolvedValue('signed.jwt.token');
const mockVerify = vi.fn().mockResolvedValue({ payload: { sub: 'u-1', org_id: null, user_type: 'staff', role_slugs: [], rules: [], locale: 'rw' } });
const mockPackRules = vi.fn().mockReturnValue([]);
const mockImportPKCS8 = vi.fn().mockResolvedValue('mock-private-key');
const mockImportSPKI = vi.fn().mockResolvedValue('mock-public-key');

vi.mock('jose', () => ({
  SignJWT: vi.fn().mockImplementation(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setIssuedAt: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: mockSign,
  })),
  jwtVerify: mockVerify,
  importPKCS8: mockImportPKCS8,
  importSPKI: mockImportSPKI,
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
  it('returns a signed token string', async () => {
    const payload = { sub: 'u-1', org_id: null, user_type: 'staff' as const, role_slugs: ['org_admin'], rules: [], locale: 'rw' };
    const token = await signAccessToken(payload);
    expect(token).toBe('signed.jwt.token');
    expect(mockSign).toHaveBeenCalled();
  });

  it('packs rules before signing', async () => {
    await signAccessToken({ sub: 'u-1', org_id: 'o-1', user_type: 'staff', role_slugs: [], rules: [{ action: 'read', subject: 'User' }], locale: 'en' });
    expect(mockPackRules).toHaveBeenCalled();
  });

  it('imports the private key on first call', async () => {
    expect(mockImportPKCS8).toHaveBeenCalledWith('TEST_PRIVATE_KEY', 'EdDSA');
  });
});

// ── verifyAccessToken ──────────────────────────────────────────────────────────

describe('verifyAccessToken', () => {
  it('returns the decoded payload', async () => {
    const result = await verifyAccessToken('some.token.here');
    expect(mockVerify).toHaveBeenCalledWith('some.token.here', 'mock-public-key', { algorithms: ['EdDSA'] });
    expect(result).toMatchObject({ sub: 'u-1' });
  });

  it('propagates errors from jwtVerify', async () => {
    mockVerify.mockRejectedValueOnce(new Error('invalid token'));
    await expect(verifyAccessToken('bad.token')).rejects.toThrow('invalid token');
  });
});
