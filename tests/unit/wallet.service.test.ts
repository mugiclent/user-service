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

// ── Publisher mock ────────────────────────────────────────────────────────────

const mockPublishWalletEvent = vi.fn();
vi.mock('../../src/utils/publishers.js', () => ({
  publishWalletEvent: mockPublishWalletEvent,
}));

// ── UUID mock — deterministic IDs ─────────────────────────────────────────────

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return { ...actual, randomUUID: vi.fn(() => 'topup-uuid-1') };
});

const { WalletService } = await import('../../src/services/wallet.service.js');

beforeEach(() => vi.clearAllMocks());

// ── initiateTopup ─────────────────────────────────────────────────────────────

describe('WalletService.initiateTopup', () => {
  const data = { amount: 5000, phone_number: '+250788000001', provider: 'mtn_momo' as const };

  it('returns a topup_id', async () => {
    const result = await WalletService.initiateTopup('user-1', data);
    expect(result.topup_id).toBe('topup-uuid-1');
  });

  it('stores topup_owner:{topup_id} → user_id in Redis with 600s TTL', async () => {
    await WalletService.initiateTopup('user-1', data);
    expect(mockRedisSet).toHaveBeenCalledWith('topup_owner:topup-uuid-1', 'user-1', 'EX', 600);
  });

  it('publishes wallet.topup.requested event with correct shape', async () => {
    await WalletService.initiateTopup('user-1', data);
    expect(mockPublishWalletEvent).toHaveBeenCalledWith({
      type: 'wallet.topup.requested',
      topup_id: 'topup-uuid-1',
      user_id: 'user-1',
      amount: 5000,
      phone_number: '+250788000001',
      provider: 'mtn_momo',
    });
  });

  it('propagates Redis errors', async () => {
    mockRedisSet.mockRejectedValueOnce(new Error('Redis down'));
    await expect(WalletService.initiateTopup('user-1', data)).rejects.toThrow('Redis down');
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
