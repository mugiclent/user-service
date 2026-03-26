import { getRabbitMQChannel } from '../loaders/rabbitmq.js';

// ---------------------------------------------------------------------------
// Audit log event
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
 * Publish an audit event to the `audit-logs` queue.
 * Fire-and-forget — never throws; logs on failure.
 */
export const publishAudit = (event: AuditEvent): void => {
  try {
    const channel = getRabbitMQChannel();
    channel.sendToQueue(
      'audit-logs',
      Buffer.from(JSON.stringify({ ...event, timestamp: new Date().toISOString() })),
      { persistent: true },
    );
  } catch (err) {
    console.error('[publishers] Failed to publish audit event', err);
  }
};

// ---------------------------------------------------------------------------
// Notification events
// ---------------------------------------------------------------------------

type NotificationEvent =
  | { type: 'otp.send'; phone_number: string; code: string; expires_in_seconds: number }
  | { type: 'password_reset.send'; identifier: string; reset_url: string; expires_in_seconds: number }
  | { type: 'user.registered'; user_id: string; first_name: string; phone_number: string };

/**
 * Publish a notification event to the `notifications` exchange.
 * Consumed by the notification service (SMS, email, push).
 * Fire-and-forget — never throws; logs on failure.
 */
export const publishNotification = (event: NotificationEvent): void => {
  try {
    const channel = getRabbitMQChannel();
    channel.publish(
      'notifications',
      event.type,
      Buffer.from(JSON.stringify({ ...event, timestamp: new Date().toISOString() })),
      { persistent: true },
    );
  } catch (err) {
    console.error('[publishers] Failed to publish notification event', err);
  }
};
