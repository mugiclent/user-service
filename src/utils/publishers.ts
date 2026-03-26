import { getRabbitMQChannel } from '../loaders/rabbitmq.js';
import { randomUUID } from 'node:crypto';

const publish = (exchange: string, routingKey: string, payload: object): void => {
  try {
    getRabbitMQChannel().publish(
      exchange,
      routingKey,
      Buffer.from(
        JSON.stringify({
          event_id: randomUUID(),
          version: 1,
          source: 'user-service',
          timestamp: new Date().toISOString(),
          ...payload,
        }),
      ),
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

export const publishAudit = (event: AuditEvent): void =>
  publish('logs', 'audit.logs', event);

// ---------------------------------------------------------------------------
// SMS notifications — notifications exchange, routing key: sms.notifications
// Routed to the `sms` queue.
//
// otp.sms: single type for all OTP deliveries; `purpose` selects template wording
// ---------------------------------------------------------------------------

export type SmsEvent =
  | {
      type: 'otp.sms';
      purpose: 'phone_verification' | '2fa' | 'password_reset';
      phone_number: string;
      code: string;
      expires_in_seconds: number;
    }
  | { type: 'welcome.sms'; phone_number: string; first_name: string }
  | { type: 'invite.sms'; phone_number: string; first_name: string; invite_link: string; expires_in_seconds: number }
  | { type: 'org_approved.sms'; phone_number: string; org_name: string; invite_link: string; expires_in_seconds: number };

export const publishSms = (event: SmsEvent): void =>
  publish('notifications', 'sms.notifications', event);

// ---------------------------------------------------------------------------
// Mail notifications — notifications exchange, routing key: mail.notifications
// Routed to the `mail` queue.
//
// otp.mail: password reset via email now uses a 6-digit code (not a link)
// ---------------------------------------------------------------------------

export type MailEvent =
  | {
      type: 'otp.mail';
      purpose: 'password_reset';
      email: string;
      first_name: string;
      code: string;
      expires_in_seconds: number;
    }
  | { type: 'welcome.mail'; email: string; first_name: string }
  | { type: 'invite.mail'; email: string; first_name: string; invite_link: string; expires_in_seconds: number }
  | { type: 'org_approved.mail'; email: string; org_name: string; invite_link: string; expires_in_seconds: number };

export const publishMail = (event: MailEvent): void =>
  publish('notifications', 'mail.notifications', event);
