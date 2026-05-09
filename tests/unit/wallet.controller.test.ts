/**
 * Tests for src/api/wallet.controller.ts — SSE stream + initiate topup
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../src/utils/AppError.js';

// ── WalletService mock ────────────────────────────────────────────────────────

const mockInitiateTopup = vi.fn();
const mockVerifyTopupOwner = vi.fn();
const mockGetWallet = vi.fn();

vi.mock('../../src/services/wallet.service.js', () => ({
  WalletService: {
    getWallet: mockGetWallet,
    initiateTopup: mockInitiateTopup,
    verifyTopupOwner: mockVerifyTopupOwner,
  },
}));

// ── Redis mock — duplicate() returns an EventEmitter with subscribe/unsubscribe/quit ──

class FakeSubscriber extends EventEmitter {
  subscribe = vi.fn().mockResolvedValue(undefined);
  unsubscribe = vi.fn().mockResolvedValue(undefined);
  quit = vi.fn().mockResolvedValue(undefined);
}

let fakeSubscriber: FakeSubscriber;
const mockDuplicate = vi.fn(() => {
  fakeSubscriber = new FakeSubscriber();
  return fakeSubscriber;
});

vi.mock('../../src/loaders/redis.js', () => ({
  getRedisClient: () => ({ duplicate: mockDuplicate }),
}));

const { WalletController } = await import('../../src/api/wallet.controller.js');

// ── helpers ───────────────────────────────────────────────────────────────────

const makeReq = (overrides: {
  userId?: string;
  topupId?: string;
  body?: object;
} = {}): Request => ({
  user: { id: overrides.userId ?? 'user-1' },
  params: { id: overrides.topupId ?? 'topup-abc' },
  body: overrides.body ?? { amount: 5000, phone_number: '+250788000001', payment_method: 'mtn' },
  on: vi.fn(),
} as unknown as Request);

const makeRes = (): Response => {
  const chunks: string[] = [];
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => { chunks.push(chunk); }),
    end: vi.fn(),
    _chunks: chunks,
  } as unknown as Response;
};

beforeEach(() => vi.clearAllMocks());

// ── getWallet ─────────────────────────────────────────────────────────────────

describe('WalletController.getWallet', () => {
  it('returns 200 with wallet balance from service', async () => {
    mockGetWallet.mockResolvedValue({ balance: 15000, currency: 'RWF', user_id: 'user-1' });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await WalletController.getWallet(makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ balance: 15000, currency: 'RWF', user_id: 'user-1' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next(err) when service throws', async () => {
    mockGetWallet.mockRejectedValueOnce(new Error('503'));
    const next = vi.fn() as NextFunction;

    await WalletController.getWallet(makeReq(), makeRes(), next);

    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

// ── initiateTopup ─────────────────────────────────────────────────────────────

describe('WalletController.initiateTopup', () => {
  it('returns 202 with topup_id', async () => {
    mockInitiateTopup.mockResolvedValue({ topup_id: 'topup-abc' });
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await WalletController.initiateTopup(req, res, next);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ topup_id: 'topup-abc' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next(err) on service error', async () => {
    mockInitiateTopup.mockRejectedValueOnce(new Error('Redis down'));
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await WalletController.initiateTopup(req, res, next);

    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

// ── streamTopup ───────────────────────────────────────────────────────────────

describe('WalletController.streamTopup — ownership check', () => {
  it('calls next(AppError 404) when topup does not belong to user', async () => {
    mockVerifyTopupOwner.mockResolvedValue(false);
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await WalletController.streamTopup(req, res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(404);
  });

  it('calls next(err) when verifyTopupOwner throws', async () => {
    mockVerifyTopupOwner.mockRejectedValueOnce(new Error('Redis error'));
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await WalletController.streamTopup(req, res, next);

    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

describe('WalletController.streamTopup — SSE flow', () => {
  const setupStream = async () => {
    mockVerifyTopupOwner.mockResolvedValue(true);
    const reqEmitter = new EventEmitter();
    const req = {
      user: { id: 'user-1' },
      params: { id: 'topup-abc' },
      on: reqEmitter.on.bind(reqEmitter),
    } as unknown as Request;
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    const streamPromise = WalletController.streamTopup(req, res, next);
    // Give subscribe() a tick to resolve
    await new Promise((r) => setImmediate(r));

    return { req: reqEmitter, res, next, streamPromise };
  };

  it('sets SSE headers and flushes', async () => {
    const { res } = await setupStream();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    expect(res.flushHeaders).toHaveBeenCalled();
    fakeSubscriber.unsubscribe();
    fakeSubscriber.quit();
  });

  it('subscribes to topup:{topupId} Redis channel', async () => {
    await setupStream();
    expect(fakeSubscriber.subscribe).toHaveBeenCalledWith('topup:topup-abc');
  });

  it('sends "completed" SSE event on topup.payment.confirmed message', async () => {
    const { res } = await setupStream();

    fakeSubscriber.emit('message', 'topup:topup-abc', JSON.stringify({
      type: 'topup.payment.confirmed',
      topup_id: 'topup-abc',
      user_id: 'user-1',
      amount: 5000,
      currency: 'RWF',
      new_balance: 15000,
      mtn_transaction_id: 'mtn-tx-1',
      mtn_absorbed: 89,
    }));

    await new Promise((r) => setImmediate(r));

    const written = (res as unknown as { _chunks: string[] })._chunks.join('');
    expect(written).toContain('event: completed');
    expect(written).toContain('"type":"topup.payment.confirmed"');
    expect(res.end).toHaveBeenCalled();
    expect(fakeSubscriber.unsubscribe).toHaveBeenCalled();
    expect(fakeSubscriber.quit).toHaveBeenCalled();
  });

  it('sends "failed" SSE event on topup.payment.failed message', async () => {
    const { res } = await setupStream();

    fakeSubscriber.emit('message', 'topup:topup-abc', JSON.stringify({
      type: 'topup.payment.failed',
      topup_id: 'topup-abc',
      user_id: 'user-1',
      reason: 'LOW_BALANCE',
      message: 'Payment was not completed.',
      retryable: true,
    }));

    await new Promise((r) => setImmediate(r));

    const written = (res as unknown as { _chunks: string[] })._chunks.join('');
    expect(written).toContain('event: failed');
    expect(res.end).toHaveBeenCalled();
  });

  it('sends "failed" SSE event on malformed Redis message', async () => {
    const { res } = await setupStream();

    fakeSubscriber.emit('message', 'topup:topup-abc', 'not-json{{{');
    await new Promise((r) => setImmediate(r));

    const written = (res as unknown as { _chunks: string[] })._chunks.join('');
    expect(written).toContain('event: failed');
    expect(res.end).toHaveBeenCalled();
  });

  it('cleans up subscriber on client disconnect (req close)', async () => {
    const { req } = await setupStream();

    req.emit('close');
    await new Promise((r) => setImmediate(r));

    expect(fakeSubscriber.unsubscribe).toHaveBeenCalled();
    expect(fakeSubscriber.quit).toHaveBeenCalled();
  });

  it('does not double-cleanup if message fires then client disconnects', async () => {
    const { req, res } = await setupStream();

    fakeSubscriber.emit('message', 'topup:topup-abc', JSON.stringify({ type: 'topup.payment.confirmed' }));
    await new Promise((r) => setImmediate(r));

    req.emit('close');
    await new Promise((r) => setImmediate(r));

    expect(fakeSubscriber.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fakeSubscriber.quit).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

});

// ── getTransactions ───────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => { vi.stubGlobal('fetch', mockFetch); });
afterEach(() => { vi.unstubAllGlobals(); });

const makeTxReq = (overrides: { userId?: string; url?: string; params?: Record<string, string> } = {}): Request => ({
  user: { id: overrides.userId ?? 'user-1' },
  params: overrides.params ?? {},
  url: overrides.url ?? '/me/wallet/transactions',
  on: vi.fn(),
} as unknown as Request);

const fakeList = {
  data: [],
  balance: { available: 5000, currency: 'RWF' },
  pagination: { page: 1, limit: 20, total: 0, has_more: false },
};

describe('WalletController.getTransactions', () => {
  it('proxies to payment-svc and returns 200 with the list', async () => {
    mockFetch.mockResolvedValue({ status: 200, json: async () => fakeList });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await WalletController.getTransactions(makeTxReq(), res, next);

    expect(mockFetch).toHaveBeenCalledWith('http://payment-svc:8098/transactions/user-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(fakeList);
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards query string to payment-svc', async () => {
    mockFetch.mockResolvedValue({ status: 200, json: async () => fakeList });
    await WalletController.getTransactions(
      makeTxReq({ url: '/me/wallet/transactions?page=2&type=topup' }),
      makeRes(),
      vi.fn() as NextFunction,
    );
    expect(mockFetch).toHaveBeenCalledWith('http://payment-svc:8098/transactions/user-1?page=2&type=topup');
  });

  it('passes upstream non-200 status through', async () => {
    mockFetch.mockResolvedValue({ status: 503, json: async () => ({ error: 'unavailable' }) });
    const res = makeRes();

    await WalletController.getTransactions(makeTxReq(), res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('calls next(err) when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('connection refused'));
    const next = vi.fn() as NextFunction;

    await WalletController.getTransactions(makeTxReq(), makeRes(), next);

    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

describe('WalletController.getUserTransactions', () => {
  it('proxies to payment-svc using path param user id', async () => {
    mockFetch.mockResolvedValue({ status: 200, json: async () => fakeList });
    const res = makeRes();

    await WalletController.getUserTransactions(
      makeTxReq({ params: { id: 'user-99' }, url: '/user-99/wallet/transactions' }),
      res,
      vi.fn() as NextFunction,
    );

    expect(mockFetch).toHaveBeenCalledWith('http://payment-svc:8098/transactions/user-99');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(fakeList);
  });

  it('forwards query string', async () => {
    mockFetch.mockResolvedValue({ status: 200, json: async () => fakeList });
    await WalletController.getUserTransactions(
      makeTxReq({ params: { id: 'user-99' }, url: '/user-99/wallet/transactions?limit=5&from=2026-01-01' }),
      makeRes(),
      vi.fn() as NextFunction,
    );
    expect(mockFetch).toHaveBeenCalledWith('http://payment-svc:8098/transactions/user-99?limit=5&from=2026-01-01');
  });

  it('calls next(err) when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    const next = vi.fn() as NextFunction;

    await WalletController.getUserTransactions(
      makeTxReq({ params: { id: 'user-99' }, url: '/user-99/wallet/transactions' }),
      makeRes(),
      next,
    );

    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
