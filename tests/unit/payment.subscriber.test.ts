/**
 * Tests for src/subscribers/payment.subscriber.ts
 * Consumes payment-service's actual events, dispatched by AMQP routing key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Channel, ConsumeMessage } from 'amqplib';

// ── RabbitMQ mock ─────────────────────────────────────────────────────────────

let capturedHandler: ((msg: ConsumeMessage | null) => Promise<void>) | null = null;

const mockChannel = {
  assertQueue: vi.fn().mockResolvedValue(undefined),
  bindQueue: vi.fn().mockResolvedValue(undefined),
  consume: vi.fn().mockImplementation(
    (_queue: string, handler: (msg: ConsumeMessage | null) => Promise<void>) => {
      capturedHandler = handler;
      return Promise.resolve({ consumerTag: 'tag-1' });
    },
  ),
  ack: vi.fn(),
  nack: vi.fn(),
} as unknown as Channel;

// ── Redis mock ────────────────────────────────────────────────────────────────

const mockRedisPublish = vi.fn().mockResolvedValue(1);
vi.mock('../../src/loaders/redis.js', () => ({
  getRedisClient: () => ({ publish: mockRedisPublish }),
}));

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockUserUpdate = vi.fn().mockResolvedValue({});
const mockWalletTxCreate = vi.fn().mockResolvedValue({});
const mockTransaction = vi.fn().mockImplementation((ops: unknown[]) => Promise.all(ops));
vi.mock('../../src/models/index.js', () => ({
  prisma: {
    user: { update: mockUserUpdate },
    walletTransaction: { create: mockWalletTxCreate },
    $transaction: mockTransaction,
  },
}));

const { initPaymentSubscriber } = await import('../../src/subscribers/payment.subscriber.js');

// ── helpers ───────────────────────────────────────────────────────────────────

const makeMsg = (routingKey: string, payload: object): ConsumeMessage =>
  ({ content: Buffer.from(JSON.stringify(payload)), fields: { routingKey } } as unknown as ConsumeMessage);

beforeEach(async () => {
  vi.clearAllMocks();
  capturedHandler = null;
  await initPaymentSubscriber(mockChannel);
});

// ── queue setup ───────────────────────────────────────────────────────────────

describe('initPaymentSubscriber — queue setup', () => {
  it('asserts and binds the queue', () => {
    expect(mockChannel.assertQueue).toHaveBeenCalledWith('payment-user-svc', { durable: true, arguments: { 'x-dead-letter-exchange': 'payment.dlx' } });
    expect(mockChannel.bindQueue).toHaveBeenCalledWith('payment-user-svc', 'payment', '#');
  });
});

// ── wallet.transaction.completed (balance projection) ─────────────────────────

describe('wallet.transaction.completed event', () => {
  // payment-service emits camelCase + bigint-as-string
  const event = { userId: 'user-1', newBalance: '15000', type: 'CREDIT', amount: '5000', occurredAt: '2026-06-12T00:00:00.000Z' };

  it('SETS the user balance to newBalance (mirror, not increment)', async () => {
    await capturedHandler!(makeMsg('wallet.transaction.completed', event));
    expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { balance: 15000 } });
  });

  it('appends a wallet_transactions ledger row', async () => {
    await capturedHandler!(makeMsg('wallet.transaction.completed', event));
    expect(mockWalletTxCreate).toHaveBeenCalledWith({
      data: { user_id: 'user-1', type: 'CREDIT', amount: 5000, balance_after: 15000, occurred_at: new Date('2026-06-12T00:00:00.000Z') },
    });
  });

  it('acks the message', async () => {
    await capturedHandler!(makeMsg('wallet.transaction.completed', event));
    expect(mockChannel.ack).toHaveBeenCalled();
  });
});

// ── topup.confirmed (SSE bridge) ──────────────────────────────────────────────

describe('topup.confirmed event', () => {
  const event = { topupId: 'topup-1', topupRef: 'ref-1', userId: 'user-1', amount: '5000', newBalance: '15000', confirmedAt: '2026-06-12T00:00:00.000Z' };

  it('bridges to the topup Redis channel as topup.payment.confirmed', async () => {
    await capturedHandler!(makeMsg('topup.confirmed', event));
    expect(mockRedisPublish).toHaveBeenCalledWith('topup:topup-1', JSON.stringify({
      type: 'topup.payment.confirmed', topup_id: 'topup-1', user_id: 'user-1', amount: 5000, new_balance: 15000,
    }));
  });

  it('does not itself touch the balance (handled by wallet.transaction.completed)', async () => {
    await capturedHandler!(makeMsg('topup.confirmed', event));
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('acks the message', async () => {
    await capturedHandler!(makeMsg('topup.confirmed', event));
    expect(mockChannel.ack).toHaveBeenCalled();
  });
});

// ── topup.failed (SSE bridge) ─────────────────────────────────────────────────

describe('topup.failed event', () => {
  const event = { topupId: 'topup-2', topupRef: 'ref-2', userId: 'user-1', amount: '5000', reason: 'PULL_FAILED', failedAt: '2026-06-12T00:00:00.000Z' };

  it('bridges to the topup Redis channel as topup.payment.failed', async () => {
    await capturedHandler!(makeMsg('topup.failed', event));
    expect(mockRedisPublish).toHaveBeenCalledWith('topup:topup-2', JSON.stringify({
      type: 'topup.payment.failed', topup_id: 'topup-2', user_id: 'user-1', reason: 'PULL_FAILED',
    }));
  });

  it('does not update any balance', async () => {
    await capturedHandler!(makeMsg('topup.failed', event));
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});

// ── unrelated payment events ──────────────────────────────────────────────────

describe('unrelated routing keys', () => {
  it('acks and ignores ticket payment events', async () => {
    await capturedHandler!(makeMsg('payment.confirmed', { paymentRef: 'p1', method: 'mtn' }));
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockRedisPublish).not.toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalled();
  });
});

// ── error handling ────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('nacks (no requeue) when message body is malformed JSON', async () => {
    const badMsg = { content: Buffer.from('not-json{{{'), fields: { routingKey: 'wallet.transaction.completed' } } as unknown as ConsumeMessage;
    await capturedHandler!(badMsg);
    expect(mockChannel.nack).toHaveBeenCalledWith(badMsg, false, false);
    expect(mockChannel.ack).not.toHaveBeenCalled();
  });

  it('nacks when a DB write throws', async () => {
    mockUserUpdate.mockRejectedValueOnce(new Error('DB error'));
    const msg = makeMsg('wallet.transaction.completed', { userId: 'u', newBalance: '100', type: 'CREDIT', amount: '100', occurredAt: '2026-06-12T00:00:00.000Z' });
    await capturedHandler!(msg);
    expect(mockChannel.nack).toHaveBeenCalledWith(msg, false, false);
  });

  it('does nothing when message is null', async () => {
    await capturedHandler!(null);
    expect(mockChannel.ack).not.toHaveBeenCalled();
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });
});
