import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publishAudit, publishSms, publishMail } from '../../src/utils/publishers.js';

// ── mock the RabbitMQ channel ─────────────────────────────────────────────────

const mockPublish = vi.fn();
vi.mock('../../src/loaders/rabbitmq.js', () => ({
  getRabbitMQChannel: () => ({ publish: mockPublish }),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

/** Parse the Buffer written to channel.publish back to an object. */
const lastMessage = (): Record<string, unknown> => {
  const call = mockPublish.mock.calls.at(-1)!;
  return JSON.parse((call[2] as Buffer).toString()) as Record<string, unknown>;
};

const lastExchange = () => mockPublish.mock.calls.at(-1)![0] as string;
const lastRoutingKey = () => mockPublish.mock.calls.at(-1)![1] as string;
const lastOptions = () => mockPublish.mock.calls.at(-1)![3] as Record<string, unknown>;

beforeEach(() => mockPublish.mockClear());

// ── publishAudit ──────────────────────────────────────────────────────────────

describe('publishAudit', () => {
  it('routes to the logs exchange with audit.logs routing key', () => {
    publishAudit({ actor_id: 'u1', action: 'login', resource: 'User', resource_id: 'u1' });
    expect(lastExchange()).toBe('logs');
    expect(lastRoutingKey()).toBe('audit.logs');
  });

  it('sets persistent: true', () => {
    publishAudit({ actor_id: 'u1', action: 'login', resource: 'User', resource_id: 'u1' });
    expect(lastOptions()).toMatchObject({ persistent: true });
  });

  it('includes standard envelope fields (event_id, version, source, timestamp)', () => {
    publishAudit({ actor_id: 'u1', action: 'login', resource: 'User', resource_id: 'u1' });
    const msg = lastMessage();
    expect(msg).toMatchObject({ version: 1, source: 'user-service' });
    expect(typeof msg['event_id']).toBe('string');
    expect(typeof msg['timestamp']).toBe('string');
  });

  it('includes all audit event fields', () => {
    publishAudit({
      actor_id: 'u1',
      action: 'delete',
      resource: 'User',
      resource_id: 'u2',
      ip: '10.0.0.1',
      delta: { status: 'deleted' },
    });
    expect(lastMessage()).toMatchObject({
      actor_id: 'u1',
      action: 'delete',
      resource: 'User',
      resource_id: 'u2',
      ip: '10.0.0.1',
      delta: { status: 'deleted' },
    });
  });

  it('generates a unique event_id per publish call', () => {
    publishAudit({ actor_id: 'u1', action: 'a', resource: 'User', resource_id: 'u1' });
    const id1 = lastMessage()['event_id'];
    publishAudit({ actor_id: 'u1', action: 'b', resource: 'User', resource_id: 'u1' });
    const id2 = lastMessage()['event_id'];
    expect(id1).not.toBe(id2);
  });
});

// ── publishSms ────────────────────────────────────────────────────────────────

describe('publishSms', () => {
  it('routes to notifications exchange with sms.notifications routing key', () => {
    publishSms({ type: 'welcome.sms', phone_number: '+250780000001', first_name: 'Alice' });
    expect(lastExchange()).toBe('notifications');
    expect(lastRoutingKey()).toBe('sms.notifications');
  });

  it('sets persistent: true', () => {
    publishSms({ type: 'welcome.sms', phone_number: '+250780000001', first_name: 'Alice' });
    expect(lastOptions()).toMatchObject({ persistent: true });
  });

  it('sends welcome.sms with correct fields', () => {
    publishSms({ type: 'welcome.sms', phone_number: '+250780000001', first_name: 'Alice' });
    expect(lastMessage()).toMatchObject({
      type: 'welcome.sms',
      phone_number: '+250780000001',
      first_name: 'Alice',
    });
  });

  it('sends otp.sms for phone_verification with correct fields', () => {
    publishSms({
      type: 'otp.sms',
      purpose: 'phone_verification',
      phone_number: '+250780000001',
      code: '483920',
      expires_in_seconds: 600,
    });
    expect(lastMessage()).toMatchObject({
      type: 'otp.sms',
      purpose: 'phone_verification',
      phone_number: '+250780000001',
      code: '483920',
      expires_in_seconds: 600,
    });
  });

  it('sends otp.sms for 2fa purpose', () => {
    publishSms({
      type: 'otp.sms',
      purpose: '2fa',
      phone_number: '+250780000002',
      code: '112233',
      expires_in_seconds: 300,
    });
    expect(lastMessage()).toMatchObject({ type: 'otp.sms', purpose: '2fa' });
  });

  it('sends otp.sms for password_reset purpose', () => {
    publishSms({
      type: 'otp.sms',
      purpose: 'password_reset',
      phone_number: '+250780000003',
      code: '999888',
      expires_in_seconds: 600,
    });
    expect(lastMessage()).toMatchObject({ type: 'otp.sms', purpose: 'password_reset' });
  });
});

// ── publishMail ───────────────────────────────────────────────────────────────

describe('publishMail', () => {
  it('routes to notifications exchange with mail.notifications routing key', () => {
    publishMail({ type: 'welcome.mail', email: 'a@example.com', first_name: 'Alice' });
    expect(lastExchange()).toBe('notifications');
    expect(lastRoutingKey()).toBe('mail.notifications');
  });

  it('sets persistent: true', () => {
    publishMail({ type: 'welcome.mail', email: 'a@example.com', first_name: 'Alice' });
    expect(lastOptions()).toMatchObject({ persistent: true });
  });

  it('sends welcome.mail with correct fields', () => {
    publishMail({ type: 'welcome.mail', email: 'a@example.com', first_name: 'Alice' });
    expect(lastMessage()).toMatchObject({
      type: 'welcome.mail',
      email: 'a@example.com',
      first_name: 'Alice',
    });
  });

  it('sends otp.mail for password_reset with correct fields', () => {
    publishMail({
      type: 'otp.mail',
      purpose: 'password_reset',
      email: 'bob@example.com',
      first_name: 'Bob',
      code: '445566',
      expires_in_seconds: 600,
    });
    expect(lastMessage()).toMatchObject({
      type: 'otp.mail',
      purpose: 'password_reset',
      email: 'bob@example.com',
      first_name: 'Bob',
      code: '445566',
      expires_in_seconds: 600,
    });
  });

  it('includes standard envelope in mail messages', () => {
    publishMail({ type: 'welcome.mail', email: 'a@example.com', first_name: 'Alice' });
    const msg = lastMessage();
    expect(msg).toMatchObject({ version: 1, source: 'user-service' });
    expect(typeof msg['event_id']).toBe('string');
  });
});

// ── invite events ─────────────────────────────────────────────────────────────

describe('publishSms — invite.sms', () => {
  it('routes to notifications/sms.notifications', () => {
    publishSms({ type: 'invite.sms', phone_number: '+250780000005', first_name: 'Dave', invite_link: 'https://app/accept', expires_in_seconds: 604800 });
    expect(lastExchange()).toBe('notifications');
    expect(lastRoutingKey()).toBe('sms.notifications');
  });

  it('includes all required fields', () => {
    publishSms({ type: 'invite.sms', phone_number: '+250780000005', first_name: 'Dave', invite_link: 'https://app/accept', expires_in_seconds: 604800 });
    expect(lastMessage()).toMatchObject({
      type: 'invite.sms',
      phone_number: '+250780000005',
      first_name: 'Dave',
      invite_link: 'https://app/accept',
      expires_in_seconds: 604800,
    });
  });
});

describe('publishMail — invite.mail', () => {
  it('routes to notifications/mail.notifications', () => {
    publishMail({ type: 'invite.mail', email: 'dave@example.com', first_name: 'Dave', invite_link: 'https://app/accept', expires_in_seconds: 604800 });
    expect(lastExchange()).toBe('notifications');
    expect(lastRoutingKey()).toBe('mail.notifications');
  });

  it('includes all required fields', () => {
    publishMail({ type: 'invite.mail', email: 'dave@example.com', first_name: 'Dave', invite_link: 'https://app/accept', expires_in_seconds: 604800 });
    expect(lastMessage()).toMatchObject({
      type: 'invite.mail',
      email: 'dave@example.com',
      first_name: 'Dave',
      invite_link: 'https://app/accept',
      expires_in_seconds: 604800,
    });
  });
});

describe('publishSms — org_approved.sms', () => {
  it('routes to notifications/sms.notifications', () => {
    publishSms({ type: 'org_approved.sms', phone_number: '+250780000010', org_name: 'Acme Bus', invite_link: 'https://app/accept', expires_in_seconds: 604800 });
    expect(lastExchange()).toBe('notifications');
    expect(lastRoutingKey()).toBe('sms.notifications');
  });

  it('includes all required fields', () => {
    publishSms({ type: 'org_approved.sms', phone_number: '+250780000010', org_name: 'Acme Bus', invite_link: 'https://app/accept', expires_in_seconds: 604800 });
    expect(lastMessage()).toMatchObject({
      type: 'org_approved.sms',
      phone_number: '+250780000010',
      org_name: 'Acme Bus',
      invite_link: 'https://app/accept',
    });
  });
});

describe('publishMail — org_approved.mail', () => {
  it('routes to notifications/mail.notifications', () => {
    publishMail({ type: 'org_approved.mail', email: 'ops@acme.com', org_name: 'Acme Bus', invite_link: 'https://app/accept', expires_in_seconds: 604800 });
    expect(lastExchange()).toBe('notifications');
    expect(lastRoutingKey()).toBe('mail.notifications');
  });

  it('includes all required fields', () => {
    publishMail({ type: 'org_approved.mail', email: 'ops@acme.com', org_name: 'Acme Bus', invite_link: 'https://app/accept', expires_in_seconds: 604800 });
    expect(lastMessage()).toMatchObject({
      type: 'org_approved.mail',
      email: 'ops@acme.com',
      org_name: 'Acme Bus',
      invite_link: 'https://app/accept',
    });
  });
});
