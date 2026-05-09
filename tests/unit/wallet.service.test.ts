/**
 * Tests for src/services/wallet.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as NodeCrypto from 'node:crypto';

// ── Redis mock ────────────────────────────────────────────────────────────────

const mockRedisSet = vi.fn().mockResolvedValue('OK');
const mockRedisGet = vi.fn().mockResolvedValue(null);
vi.mock('../../src/loaders/redis.js', () => ({
  getRedisClient: () => ({ set: mockRedisSet, get: mockRedisGet }),
}));

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockUserFindUnique = vi.fn().mockResolvedValue(null);
vi.mock('../../src/models/index.js', () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
  },
}));

// ── Publisher mock ────────────────────────────────────────────────────────────

const mockPublishWalletEvent = vi.fn();
vi.mock('../../src/utils/publishers.js', () => ({
  publishWalletEvent: mockPublishWalletEvent,
}));

// ── UUID mock — deterministic IDs ─────────────────────────────────────────────

import { randomUUID as _randomUUID } from 'node:crypto';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return { ...actual, randomUUID: vi.fn() };
});

const { WalletService } = await import('../../src/services/wallet.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  let call = 0;
  vi.mocked(_randomUUID).mockImplementation(() => call++ === 0 ? 'topup-uuid-1' : 'payment-ref-1');
});

// ── initiateTopup ─────────────────────────────────────────────────────────────

describe('WalletService.initiateTopup', () => {
  const body = { amount: 5000, phone_number: '+250788000001', payment_method: 'mtn' as const };

  it('returns a topup_id', async () => {
    const result = await WalletService.initiateTopup('user-1', body);
    expect(result.topup_id).toBe('topup-uuid-1');
  });

  it('stores topup_owner:{topup_id} → user_id in Redis with 360s TTL', async () => {
    await WalletService.initiateTopup('user-1', body);
    expect(mockRedisSet).toHaveBeenCalledWith('topup_owner:topup-uuid-1', 'user-1', 'EX', 360);
  });

  it('publishes wallet.topup.requested with correct shape', async () => {
    await WalletService.initiateTopup('user-1', body);
    expect(mockPublishWalletEvent).toHaveBeenCalledWith({
      type: 'wallet.topup.requested',
      topup_id: 'topup-uuid-1',
      payment_ref: 'payment-ref-1',
      user_id: 'user-1',
      amount: 5000,
      currency: 'RWF',
      phone: '+250788000001',
      payment_method: 'mtn',
    });
  });

  it('normalises phone_number without + prefix', async () => {
    await WalletService.initiateTopup('user-1', { ...body, phone_number: '250788000001' });
    expect(mockPublishWalletEvent).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+250788000001' }),
    );
  });

  it('passes airtel payment_method through unchanged', async () => {
    await WalletService.initiateTopup('user-1', { ...body, payment_method: 'airtel' });
    expect(mockPublishWalletEvent).toHaveBeenCalledWith(
      expect.objectContaining({ payment_method: 'airtel' }),
    );
  });

  it('falls back to user phone_number from DB when not provided', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ phone_number: '+250788000002' });
    await WalletService.initiateTopup('user-1', { amount: 3000, payment_method: 'mtn' });
    expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, select: { phone_number: true } });
    expect(mockPublishWalletEvent).toHaveBeenCalledWith(expect.objectContaining({ phone: '+250788000002' }));
  });

  it('throws PHONE_NOT_FOUND when no phone provided and user has none', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ phone_number: null });
    await expect(WalletService.initiateTopup('user-1', { amount: 3000, payment_method: 'mtn' }))
      .rejects.toMatchObject({ code: 'PHONE_NOT_FOUND' });
  });

  it('propagates Redis errors without publishing', async () => {
    mockRedisSet.mockRejectedValueOnce(new Error('Redis down'));
    await expect(WalletService.initiateTopup('user-1', body)).rejects.toThrow('Redis down');
    expect(mockPublishWalletEvent).not.toHaveBeenCalled();
  });
});

// ── verifyTopupOwner ──────────────────────────────────────────────────────────

describe('WalletService.verifyTopupOwner', () => {
  it('returns true when the stored owner matches', async () => {
    mockRedisGet.mockResolvedValue('user-1');
    expect(await WalletService.verifyTopupOwner('topup-abc', 'user-1')).toBe(true);
    expect(mockRedisGet).toHaveBeenCalledWith('topup_owner:topup-abc');
  });

  it('returns false when owner does not match', async () => {
    mockRedisGet.mockResolvedValue('user-2');
    expect(await WalletService.verifyTopupOwner('topup-abc', 'user-1')).toBe(false);
  });

  it('returns false when key does not exist (null)', async () => {
    mockRedisGet.mockResolvedValue(null);
    expect(await WalletService.verifyTopupOwner('topup-abc', 'user-1')).toBe(false);
  });
});

// ── getWallet ─────────────────────────────────────────────────────────────────

describe('WalletService.getWallet', () => {
  it('returns balance, currency, and user_id from local DB', async () => {
    mockUserFindUnique.mockResolvedValue({ balance: 15000 });

    const result = await WalletService.getWallet('user-1');

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { balance: true },
    });
    expect(result).toMatchObject({ currency: 'RWF', user_id: 'user-1' });
    expect(typeof result.balance).toBe('number');
  });

  it('throws USER_NOT_FOUND (404) when user does not exist', async () => {
    mockUserFindUnique.mockResolvedValue(null);

    await expect(WalletService.getWallet('user-1')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
      status: 404,
    });
  });

  it('propagates DB errors', async () => {
    mockUserFindUnique.mockRejectedValue(new Error('DB connection lost'));

    await expect(WalletService.getWallet('user-1')).rejects.toThrow('DB connection lost');
  });
});
