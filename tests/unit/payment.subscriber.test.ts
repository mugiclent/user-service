/**
 * Tests for src/subscribers/payment.subscriber.ts
 * Consumes payment-service's passenger/organisation wallet events + topup outcomes,
 * dispatched by AMQP routing key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Channel, ConsumeMessage } from 'amqplib';

// ── RabbitMQ mock ─────────────────────────────────────────────────────────────

let capturedHandler: ((msg: ConsumeMessage | null) => Promise<void>) | null = null;

const mockChannel = {
  assertQueue: vi.fn().mockResolvedValue(undefined),
  bindQueue: vi.fn().mockResolvedValue(undefined),
  unbindQueue: vi.fn().mockResolvedValue(undefined),
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
const mockRedisSet = vi.fn().mockResolvedValue('OK');
vi.mock('../../src/loaders/redis.js', () => ({
  getRedisClient: () => ({ publish: mockRedisPublish, set: mockRedisSet }),
}));

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockUserUpdate = vi.fn().mockResolvedValue({});
const mockOrgUpdate = vi.fn().mockResolvedValue({});
const mockWalletTxCreate = vi.fn().mockResolvedValue({});
const mockTransaction = vi.fn().mockImplementation((ops: unknown[]) => Promise.all(ops));
vi.mock('../../src/models/index.js', () => ({
  prisma: {
    user: { update: mockUserUpdate },
    org: { update: mockOrgUpdate },
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
  it('asserts the queue and binds the specific wallet/topup keys (and drops #)', () => {
    expect(mockChannel.assertQueue).toHaveBeenCalledWith('payment-user-svc', { durable: true, arguments: { 'x-dead-letter-exchange': 'payment.dlx' } });
    for (const key of ['wallet.events', 'topup.confirmed', 'topup.failed']) {
      expect(mockChannel.bindQueue).toHaveBeenCalledWith('payment-user-svc', 'payment', key);
    }
    expect(mockChannel.unbindQueue).toHaveBeenCalledWith('payment-user-svc', 'payment', '#');
  });
});

// ── passenger.transaction ─────────────────────────────────────────────────────

describe('passenger.transaction (wallet.events)', () => {
  const event = { type: 'passenger.transaction', userId: 'user-1', newBalance: '15000', movement: 'CREDIT', amount: '5000', occurredAt: '2026-06-12T00:00:00.000Z', source: 'topup', reference: 'ref-1', ticketId: null };

  it('SETS the user balance to newBalance (BigInt)', async () => {
    await capturedHandler!(makeMsg('wallet.events', event));
    expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { balance: 15000n } });
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it('appends a PASSENGER ledger row with integer amounts', async () => {
    await capturedHandler!(makeMsg('wallet.events', event));
    expect(mockWalletTxCreate).toHaveBeenCalledWith({
      data: { owner_id: 'user-1', owner_type: 'PASSENGER', type: 'CREDIT', source: 'topup', payment_method: null, reference: 'ref-1', ticket_id: null, amount: 5000n, balance_after: 15000n, occurred_at: new Date('2026-06-12T00:00:00.000Z') },
    });
  });

  it('acks the message', async () => {
    await capturedHandler!(makeMsg('wallet.events', event));
    expect(mockChannel.ack).toHaveBeenCalled();
  });
});

// ── organisation.transaction ──────────────────────────────────────────────────

describe('organisation.transaction (wallet.events)', () => {
  const event = { type: 'organisation.transaction', orgId: 'org-1', newBalance: '20000', movement: 'CREDIT', amount: '1800', occurredAt: '2026-06-12T00:00:00.000Z', source: 'ticket_payment', reference: 'ref-2', ticketId: 'ticket-1' };

  it('SETS the org balance to newBalance (BigInt)', async () => {
    await capturedHandler!(makeMsg('wallet.events', event));
    expect(mockOrgUpdate).toHaveBeenCalledWith({ where: { id: 'org-1' }, data: { balance: 20000n } });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('appends an ORGANISATION ledger row', async () => {
    await capturedHandler!(makeMsg('wallet.events', event));
    expect(mockWalletTxCreate).toHaveBeenCalledWith({
      data: { owner_id: 'org-1', owner_type: 'ORGANISATION', type: 'CREDIT', source: 'ticket_payment', payment_method: null, reference: 'ref-2', ticket_id: 'ticket-1', amount: 1800n, balance_after: 20000n, occurred_at: new Date('2026-06-12T00:00:00.000Z') },
    });
  });
});

// ── topup.confirmed / topup.failed (SSE bridge) ───────────────────────────────

describe('topup.confirmed event', () => {
  const event = { topupId: 'topup-1', userId: 'user-1', amount: '5000', newBalance: '15000', method: 'mtn' };
  it('persists + publishes the confirmed SSE payload', async () => {
    await capturedHandler!(makeMsg('topup.confirmed', event));
    const body = JSON.stringify({
      status: 'confirmed', amount: 5000, currency: 'RWF', new_balance: 15000, message: 'Topped up via MTN successfully.',
    });
    expect(mockRedisSet).toHaveBeenCalledWith('topup_status:topup-1', body, 'EX', 600);
    expect(mockRedisPublish).toHaveBeenCalledWith('topup:topup-1', body);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});

describe('topup.failed event', () => {
  const event = { topupId: 'topup-2', userId: 'user-1', reason: 'MOMO_DECLINED' };
  it('persists + publishes the failed SSE payload (retryable)', async () => {
    await capturedHandler!(makeMsg('topup.failed', event));
    const body = JSON.stringify({
      status: 'failed', reason: 'MOMO_DECLINED', message: 'The mobile money payment was declined. Please try again.', retryable: true,
    });
    expect(mockRedisSet).toHaveBeenCalledWith('topup_status:topup-2', body, 'EX', 600);
    expect(mockRedisPublish).toHaveBeenCalledWith('topup:topup-2', body);
  });
});

// ── unrelated / error handling ────────────────────────────────────────────────

describe('unrelated routing keys', () => {
  it('acks and ignores ticket payment events', async () => {
    await capturedHandler!(makeMsg('payment.confirmed', { paymentRef: 'p1', method: 'mtn' }));
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockOrgUpdate).not.toHaveBeenCalled();
    expect(mockRedisPublish).not.toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalled();
  });
});

describe('error handling', () => {
  it('nacks (no requeue) when message body is malformed JSON', async () => {
    const badMsg = { content: Buffer.from('not-json{{{'), fields: { routingKey: 'wallet.events' } } as unknown as ConsumeMessage;
    await capturedHandler!(badMsg);
    expect(mockChannel.nack).toHaveBeenCalledWith(badMsg, false, false);
    expect(mockChannel.ack).not.toHaveBeenCalled();
  });

  it('nacks when a DB write throws', async () => {
    mockUserUpdate.mockRejectedValueOnce(new Error('DB error'));
    const msg = makeMsg('wallet.events', { type: 'passenger.transaction', userId: 'u', newBalance: '100', movement: 'CREDIT', amount: '100', occurredAt: '2026-06-12T00:00:00.000Z' });
    await capturedHandler!(msg);
    expect(mockChannel.nack).toHaveBeenCalledWith(msg, false, false);
  });

  it('does nothing when message is null', async () => {
    await capturedHandler!(null);
    expect(mockChannel.ack).not.toHaveBeenCalled();
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });
});
