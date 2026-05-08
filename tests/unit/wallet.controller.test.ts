/**
 * Tests for src/api/wallet.controller.ts — SSE stream + initiate topup
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../src/utils/AppError.js';

// ── WalletService mock ────────────────────────────────────────────────────────

const mockInitiateTopup = vi.fn();
const mockVerifyTopupOwner = vi.fn();
vi.mock('../../src/services/wallet.service.js', () => ({
  WalletService: {
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
  body: overrides.body ?? { amount: 5000, phone_number: '+250788000001', provider: 'mtn_momo' },
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
    expect(res.flushHeaders).toHaveBeenCalled();
    fakeSubscriber.unsubscribe();
    fakeSubscriber.quit();
  });

  it('subscribes to topup:{topupId} Redis channel', async () => {
    await setupStream();
    expect(fakeSubscriber.subscribe).toHaveBeenCalledWith('topup:topup-abc');
  });

  it('sends "completed" SSE event on topup.completed message', async () => {
    const { res } = await setupStream();

    fakeSubscriber.emit('message', 'topup:topup-abc', JSON.stringify({
      type: 'topup.completed',
      topup_id: 'topup-abc',
      user_id: 'user-1',
      amount: 5000,
      new_balance: 15000,
    }));

    await new Promise((r) => setImmediate(r));

    const written = (res as unknown as { _chunks: string[] })._chunks.join('');
    expect(written).toContain('event: completed');
    expect(written).toContain('"type":"topup.completed"');
    expect(res.end).toHaveBeenCalled();
    expect(fakeSubscriber.unsubscribe).toHaveBeenCalled();
    expect(fakeSubscriber.quit).toHaveBeenCalled();
  });

  it('sends "failed" SSE event on topup.failed message', async () => {
    const { res } = await setupStream();

    fakeSubscriber.emit('message', 'topup:topup-abc', JSON.stringify({
      type: 'topup.failed',
      topup_id: 'topup-abc',
      user_id: 'user-1',
      reason: 'Insufficient funds',
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

    fakeSubscriber.emit('message', 'topup:topup-abc', JSON.stringify({ type: 'topup.completed' }));
    await new Promise((r) => setImmediate(r));

    req.emit('close');
    await new Promise((r) => setImmediate(r));

    // unsubscribe and quit should only have been called once each
    expect(fakeSubscriber.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fakeSubscriber.quit).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});
