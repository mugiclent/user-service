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
const mockWalletTxFindMany = vi.fn().mockResolvedValue([]);
const mockWalletTxCount = vi.fn().mockResolvedValue(0);
vi.mock('../../src/models/index.js', () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    walletTransaction: { findMany: mockWalletTxFindMany, count: mockWalletTxCount },
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
  const body = { amount: 5000, phone: '+250788000001', payment_method: 'mtn' as const };

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

  it('normalises phone without + prefix', async () => {
    await WalletService.initiateTopup('user-1', { ...body, phone: '250788000001' });
    expect(mockPublishWalletEvent).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+250788000001' }),
    );
  });

  it('rejects amount below the minimum (100)', async () => {
    await expect(WalletService.initiateTopup('user-1', { ...body, amount: 50 }))
      .rejects.toMatchObject({ code: 'INVALID_AMOUNT', status: 400 });
  });

  it('rejects an invalid phone', async () => {
    await expect(WalletService.initiateTopup('user-1', { ...body, phone: 'not-a-phone' }))
      .rejects.toMatchObject({ code: 'INVALID_PHONE', status: 422 });
  });

  it('passes airtel payment_method through unchanged', async () => {
    await WalletService.initiateTopup('user-1', { ...body, payment_method: 'airtel' });
    expect(mockPublishWalletEvent).toHaveBeenCalledWith(
      expect.objectContaining({ payment_method: 'airtel' }),
    );
  });

  it('falls back to user phone_number from DB when not provided', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ phone_number: '250788000002' });
    await WalletService.initiateTopup('user-1', { amount: 3000, payment_method: 'mtn' });
    expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, select: { phone_number: true } });
    expect(mockPublishWalletEvent).toHaveBeenCalledWith(expect.objectContaining({ phone: '+250788000002' }));
  });

  it('throws INVALID_PHONE when no phone provided and user has none', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ phone_number: null });
    await expect(WalletService.initiateTopup('user-1', { amount: 3000, payment_method: 'mtn' }))
      .rejects.toMatchObject({ code: 'INVALID_PHONE' });
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
  it('returns available + currency from the local projection', async () => {
    mockUserFindUnique.mockResolvedValue({ balance: 15000 });

    const result = await WalletService.getWallet('user-1');

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { balance: true },
    });
    expect(result).toEqual({ available: 15000, currency: 'RWF' });
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

// ── getTransactions ─────────────────────────────────────────────────────────────

describe('WalletService.getTransactions', () => {
  it('maps rows to the frontend DTO (type=source, currency, description, created_at) under data', async () => {
    const occurred = new Date('2026-06-12T00:00:00.000Z');
    mockWalletTxFindMany.mockResolvedValueOnce([
      { id: 'tx-1', source: 'topup', payment_method: 'mtn', type: 'CREDIT', amount: 5000n, balance_after: 15000n, occurred_at: occurred, reference: 'ref-1', ticket_id: null },
    ]);
    mockWalletTxCount.mockResolvedValueOnce(1);

    const result = await WalletService.getTransactions('user-1', {});

    expect(result).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(result.data[0]).toEqual({
      id: 'tx-1',
      type: 'topup',
      amount: 5000,
      currency: 'RWF',
      description: 'Top up via MTN',
      created_at: occurred,
      reference: 'ref-1',
      ticket_id: null,
      balance_after: 15000,
    });
  });

  it('filters by type (mapped onto source)', async () => {
    await WalletService.getTransactions('user-1', { type: 'topup' });
    expect(mockWalletTxFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { owner_id: 'user-1', owner_type: 'PASSENGER', source: 'topup' } }),
    );
  });
});
