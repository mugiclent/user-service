/**
 * Tests for src/subscribers/payment.subscriber.ts
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

vi.mock('../../src/loaders/rabbitmq.js', () => ({
  getConsumerChannel: vi.fn().mockResolvedValue(mockChannel),
}));

// ── Redis mock ────────────────────────────────────────────────────────────────

const mockRedisPublish = vi.fn().mockResolvedValue(1);
vi.mock('../../src/loaders/redis.js', () => ({
  getRedisClient: () => ({ publish: mockRedisPublish }),
}));

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockUserUpdate = vi.fn().mockResolvedValue({});
const mockOrgUpdate = vi.fn().mockResolvedValue({});
vi.mock('../../src/models/index.js', () => ({
  prisma: {
    user: { update: mockUserUpdate },
    org:  { update: mockOrgUpdate },
  },
}));

const { initPaymentSubscriber } = await import('../../src/subscribers/payment.subscriber.js');

// ── helpers ───────────────────────────────────────────────────────────────────

const makeMsg = (payload: object): ConsumeMessage =>
  ({ content: Buffer.from(JSON.stringify(payload)) } as unknown as ConsumeMessage);

beforeEach(async () => {
  vi.clearAllMocks();
  capturedHandler = null;
  await initPaymentSubscriber();
});

// ── queue setup ───────────────────────────────────────────────────────────────

describe('initPaymentSubscriber — queue setup', () => {
  it('asserts and binds the queue', () => {
    expect(mockChannel.assertQueue).toHaveBeenCalledWith('payment-user-svc', { durable: true });
    expect(mockChannel.bindQueue).toHaveBeenCalledWith('payment-user-svc', 'payment', '#');
  });
});

// ── topup.payment.confirmed ───────────────────────────────────────────────────

describe('topup.payment.confirmed event', () => {
  const event = {
    type: 'topup.payment.confirmed',
    topup_id: 'topup-1',
    user_id: 'user-1',
    amount: 5000,
    currency: 'RWF',
    new_balance: 15000,
    mtn_transaction_id: 'mtn-tx-1',
    mtn_absorbed: 89,
  };

  it('increments user balance', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { balance: { increment: 5000 } },
    });
  });

  it('publishes to topup:{topup_id} Redis channel for SSE bridge', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockRedisPublish).toHaveBeenCalledWith('topup:topup-1', JSON.stringify(event));
  });

  it('does not touch the org table', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it('acks the message', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockChannel.ack).toHaveBeenCalled();
  });
});

// ── topup.payment.failed ──────────────────────────────────────────────────────

describe('topup.payment.failed event', () => {
  const event = {
    type: 'topup.payment.failed',
    topup_id: 'topup-2',
    user_id: 'user-1',
    reason: 'LOW_BALANCE',
    message: 'Payment was not completed.',
    retryable: true,
  };

  it('publishes to topup:{topup_id} Redis channel for SSE bridge', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockRedisPublish).toHaveBeenCalledWith('topup:topup-2', JSON.stringify(event));
  });

  it('does not update any balance', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it('acks the message', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockChannel.ack).toHaveBeenCalled();
  });
});

// ── ticket.payment.confirmed — wallet only ────────────────────────────────────

describe('ticket.payment.confirmed event — wallet payment, passenger user', () => {
  const event = {
    type: 'ticket.payment.confirmed',
    ticket_id: 'ticket-1',
    amount: 3000,
    payment_method: 'wallet',
    user_id: 'user-1',
    org_id: 'org-1',
  };

  it('decrements user balance', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { balance: { decrement: 3000 } },
    });
  });

  it('increments org balance', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { balance: { increment: 3000 } },
    });
  });
});

describe('ticket.payment.confirmed event — wallet payment, no user_id (direct org booking)', () => {
  const event = {
    type: 'ticket.payment.confirmed',
    ticket_id: 'ticket-2',
    amount: 12000,
    payment_method: 'wallet',
    org_id: 'org-1',
  };

  it('increments org balance', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { balance: { increment: 12000 } },
    });
  });

  it('does not touch user table when no user_id', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});

describe('ticket.payment.confirmed event — non-wallet payment method', () => {
  const event = {
    type: 'ticket.payment.confirmed',
    ticket_id: 'ticket-3',
    amount: 5000,
    payment_method: 'mtn',
    user_id: 'user-1',
    org_id: 'org-1',
  };

  it('does not touch any balance', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it('acks the message', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockChannel.ack).toHaveBeenCalled();
  });
});

// ── refund.completed ──────────────────────────────────────────────────────────

describe('refund.completed event', () => {
  const event = {
    type: 'refund.completed',
    ticket_id: 'ticket-4',
    amount: 3000,
    user_id: 'user-1',
  };

  it('increments user balance', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { balance: { increment: 3000 } },
    });
  });

  it('does not touch the org table', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it('acks the message', async () => {
    await capturedHandler!(makeMsg(event));
    expect(mockChannel.ack).toHaveBeenCalled();
  });
});

// ── error handling ────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('nacks (no requeue) when message body is malformed JSON', async () => {
    const badMsg = { content: Buffer.from('not-json{{{') } as unknown as ConsumeMessage;
    await capturedHandler!(badMsg);
    expect(mockChannel.nack).toHaveBeenCalledWith(badMsg, false, false);
    expect(mockChannel.ack).not.toHaveBeenCalled();
  });

  it('nacks when a DB update throws', async () => {
    mockUserUpdate.mockRejectedValueOnce(new Error('DB error'));
    const msg = makeMsg({ type: 'topup.payment.confirmed', topup_id: 't', user_id: 'u', amount: 100, currency: 'RWF', new_balance: 100, mtn_transaction_id: null, mtn_absorbed: 0 });
    await capturedHandler!(msg);
    expect(mockChannel.nack).toHaveBeenCalledWith(msg, false, false);
  });

  it('does nothing when message is null', async () => {
    await capturedHandler!(null);
    expect(mockChannel.ack).not.toHaveBeenCalled();
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });
});
