/**
 * Supplements the existing publishers.test.ts to cover:
 *  - publishPush
 *  - notifyUser (all channel branches)
 *  - publish error path (catch block)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockPublish = vi.fn();
vi.mock('../../src/loaders/rabbitmq.js', () => ({
  getRabbitMQChannel: () => ({ publish: mockPublish }),
}));

const { publishSms, publishPush, notifyUser } =
  await import('../../src/utils/publishers.js');

beforeEach(() => vi.clearAllMocks());

// ── publishPush ────────────────────────────────────────────────────────────────

describe('publishPush', () => {
  it('publishes to push.notifications routing key', () => {
    publishPush({ type: 'security.account_suspended', fcm_token: 'fcm-abc' });
    expect(mockPublish).toHaveBeenCalledWith(
      'notifications',
      'push.notifications',
      expect.any(Buffer),
      { persistent: true },
    );
  });

  it('includes type and fcm_token in the payload', () => {
    publishPush({ type: 'org.suspended', fcm_token: 'tok', data: { org_name: 'Acme' } });
    const buf = mockPublish.mock.calls[0][2] as Buffer;
    const body = JSON.parse(buf.toString());
    expect(body.type).toBe('org.suspended');
    expect(body.fcm_token).toBe('tok');
    expect(body.data).toEqual({ org_name: 'Acme' });
  });
});

// ── publish error path ─────────────────────────────────────────────────────────

describe('publish error handling', () => {
  it('logs error but does not throw when channel.publish throws', () => {
    mockPublish.mockImplementationOnce(() => { throw new Error('channel closed'); });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => publishSms({ type: 'welcome.sms', phone_number: '+250788000001', first_name: 'A' })).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ── notifyUser ─────────────────────────────────────────────────────────────────

const baseOpts = {
  sms:  { type: 'security.account_suspended' as const, phone_number: '+250788000001', first_name: 'A' },
  mail: { type: 'security.account_suspended' as const, email: 'a@b.com', first_name: 'A' },
  push: { type: 'security.account_suspended' as const },
};

describe('notifyUser — sms channel', () => {
  it('sends SMS only', () => {
    notifyUser({ phone_number: '+250788000001', email: null, fcm_token: null, notif_channel: 'sms' }, baseOpts);
    const keys = mockPublish.mock.calls.map((c) => c[1]);
    expect(keys).toContain('sms.notifications');
    expect(keys).not.toContain('mail.notifications');
    expect(keys).not.toContain('push.notifications');
  });
});

describe('notifyUser — email channel', () => {
  it('sends mail only when user has email', () => {
    notifyUser({ phone_number: '+250788000001', email: 'a@b.com', fcm_token: null, notif_channel: 'email' }, baseOpts);
    const keys = mockPublish.mock.calls.map((c) => c[1]);
    expect(keys).toContain('mail.notifications');
    expect(keys).not.toContain('sms.notifications');
  });

  it('sends nothing when user has no email', () => {
    notifyUser({ phone_number: '+250788000001', email: null, fcm_token: null, notif_channel: 'email' }, baseOpts);
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe('notifyUser — app channel', () => {
  it('sends push when fcm_token present', () => {
    notifyUser({ phone_number: '+250788000001', email: null, fcm_token: 'fcm-1', notif_channel: 'app' }, baseOpts);
    const keys = mockPublish.mock.calls.map((c) => c[1]);
    expect(keys).toContain('push.notifications');
    expect(keys).not.toContain('sms.notifications');
  });

  it('falls back to SMS when no fcm_token', () => {
    notifyUser({ phone_number: '+250788000001', email: null, fcm_token: null, notif_channel: 'app' }, baseOpts);
    const keys = mockPublish.mock.calls.map((c) => c[1]);
    expect(keys).toContain('sms.notifications');
    expect(keys).not.toContain('push.notifications');
  });
});

describe('notifyUser — all channel', () => {
  it('sends SMS + mail + push when user has email and fcm_token', () => {
    notifyUser({ phone_number: '+250788000001', email: 'a@b.com', fcm_token: 'fcm-1', notif_channel: 'all' }, baseOpts);
    const keys = mockPublish.mock.calls.map((c) => c[1]);
    expect(keys).toContain('sms.notifications');
    expect(keys).toContain('mail.notifications');
    expect(keys).toContain('push.notifications');
  });

  it('skips mail when user has no email', () => {
    notifyUser({ phone_number: '+250788000001', email: null, fcm_token: 'fcm-1', notif_channel: 'all' }, baseOpts);
    const keys = mockPublish.mock.calls.map((c) => c[1]);
    expect(keys).not.toContain('mail.notifications');
  });

  it('skips push when no fcm_token', () => {
    notifyUser({ phone_number: '+250788000001', email: 'a@b.com', fcm_token: null, notif_channel: 'all' }, baseOpts);
    const keys = mockPublish.mock.calls.map((c) => c[1]);
    expect(keys).not.toContain('push.notifications');
  });
});

describe('notifyUser — fills fcm_token from user object on push', () => {
  it('includes user.fcm_token in push payload', () => {
    notifyUser({ phone_number: '+250788000001', email: null, fcm_token: 'device-tok', notif_channel: 'app' }, baseOpts);
    const pushCall = mockPublish.mock.calls.find((c) => c[1] === 'push.notifications');
    const body = JSON.parse((pushCall![2] as Buffer).toString());
    expect(body.fcm_token).toBe('device-tok');
  });
});
