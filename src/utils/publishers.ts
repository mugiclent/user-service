import { getRabbitMQChannel } from '../loaders/rabbitmq.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const publish = (exchange: string, routingKey: string, payload: object): void => {
  try {
    getRabbitMQChannel().publish(
      exchange,
      routingKey,
      Buffer.from(JSON.stringify({ ...payload, timestamp: new Date().toISOString() })),
      { persistent: true },
    );
  } catch (err) {
    console.error(`[publishers] Failed to publish to ${exchange}/${routingKey}`, err);
  }
};

// ---------------------------------------------------------------------------
// Audit — logs exchange, routing key: audit.logs
// ---------------------------------------------------------------------------

export interface AuditEvent {
  actor_id: string;
  action: string;
  resource: string;
  resource_id: string;
  delta?: Record<string, unknown>;
  ip?: string;
}

/**
 * Publish an audit event.
 * Routed to the `audit` queue via routing key `audit.logs`.
 * Fire-and-forget — never throws.
 */
export const publishAudit = (event: AuditEvent): void =>
  publish('logs', 'audit.logs', event);

// ---------------------------------------------------------------------------
// SMS notifications — notifications exchange, routing key: sms.notifications
// Routed to the `sms` queue.
// ---------------------------------------------------------------------------

export type SmsEvent =
  | { type: 'otp.send';            phone_number: string; code: string; expires_in_seconds: number }
  | { type: 'password_reset.sms';  phone_number: string; reset_token: string; expires_in_seconds: number }
  | { type: 'welcome.sms';         phone_number: string; first_name: string };

/**
 * Publish an SMS notification event.
 * Routed to the `sms` queue via routing key `sms.notifications`.
 * Fire-and-forget — never throws.
 */
export const publishSms = (event: SmsEvent): void =>
  publish('notifications', 'sms.notifications', event);

// ---------------------------------------------------------------------------
// Mail notifications — notifications exchange, routing key: mail.notifications
// Routed to the `mail` queue.
// ---------------------------------------------------------------------------

export type MailEvent =
  | { type: 'password_reset.mail'; email: string; first_name: string; reset_token: string; expires_in_seconds: number }
  | { type: 'welcome.mail';        email: string; first_name: string };

/**
 * Publish a mail notification event.
 * Routed to the `mail` queue via routing key `mail.notifications`.
 * Fire-and-forget — never throws.
 */
export const publishMail = (event: MailEvent): void =>
  publish('notifications', 'mail.notifications', event);
