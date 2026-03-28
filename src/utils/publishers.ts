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
// ---------------------------------------------------------------------------

export type SmsEvent =
  // ── OTP delivery ──────────────────────────────────────────────────────────
  | {
      type: 'otp.sms';
      purpose: 'phone_verification' | '2fa' | 'password_reset';
      phone_number: string;
      code: string;
      expires_in_seconds: number;
    }
  // ── Welcome / onboarding ──────────────────────────────────────────────────
  | { type: 'welcome.sms'; phone_number: string; first_name: string }
  | { type: 'invite.sms'; phone_number: string; first_name: string; invite_link: string; expires_in_seconds: number }
  | { type: 'org_approved.sms'; phone_number: string; org_name: string; invite_link: string; expires_in_seconds: number }
  // ── Security events ───────────────────────────────────────────────────────
  | { type: 'security.login_new_device'; phone_number: string; first_name: string; device?: string }
  | { type: 'security.password_changed'; phone_number: string; first_name: string }
  | { type: 'security.all_sessions_revoked'; phone_number: string; first_name: string }
  | { type: 'security.account_suspended'; phone_number: string; first_name: string }
  | { type: 'security.2fa_enabled'; phone_number: string; first_name: string }
  | { type: 'security.2fa_disabled'; phone_number: string; first_name: string }
  // ── Org status events ─────────────────────────────────────────────────────
  | { type: 'org.suspended'; phone_number: string; org_name: string }
  | { type: 'org.rejected'; phone_number: string; org_name: string; reason?: string }
  | { type: 'org.cooperative_approved'; phone_number: string; org_name: string }
  | { type: 'org.contact_verified'; phone_number: string; org_name: string };

export const publishSms = (event: SmsEvent): void =>
  publish('notifications', 'sms.notifications', event);

// ---------------------------------------------------------------------------
// Mail notifications — notifications exchange, routing key: mail.notifications
// Routed to the `mail` queue.
// ---------------------------------------------------------------------------

export type MailEvent =
  // ── OTP delivery ──────────────────────────────────────────────────────────
  | {
      type: 'otp.mail';
      purpose: 'password_reset';
      email: string;
      first_name: string;
      code: string;
      expires_in_seconds: number;
    }
  // ── Welcome / onboarding ──────────────────────────────────────────────────
  | { type: 'welcome.mail'; email: string; first_name: string }
  | { type: 'invite.mail'; email: string; first_name: string; invite_link: string; expires_in_seconds: number }
  | { type: 'org_approved.mail'; email: string; org_name: string; invite_link: string; expires_in_seconds: number }
  // ── Security events ───────────────────────────────────────────────────────
  | { type: 'security.login_new_device'; email: string; first_name: string; device?: string }
  | { type: 'security.password_changed'; email: string; first_name: string }
  | { type: 'security.account_suspended'; email: string; first_name: string }
  | { type: 'security.2fa_enabled'; email: string; first_name: string }
  | { type: 'security.2fa_disabled'; email: string; first_name: string }
  // ── Org status events ─────────────────────────────────────────────────────
  | { type: 'org.suspended'; email: string; org_name: string }
  | { type: 'org.rejected'; email: string; org_name: string; reason?: string }
  // ── Org application flow ──────────────────────────────────────────────────
  | { type: 'org.contact_otp'; email: string; first_name: string; org_name: string; code: string; expires_in_seconds: number }
  | { type: 'org.contact_verified'; email: string; org_name: string; first_name: string }
  | { type: 'org.application_received'; email: string; org_name: string; contact_email: string; org_type: string };

export const publishMail = (event: MailEvent): void =>
  publish('notifications', 'mail.notifications', event);

// ---------------------------------------------------------------------------
// Push notifications — notifications exchange, routing key: push.notifications
// Routed to the `push` queue → push-worker → FCM/APNs.
//
// The push worker maps `type` to the correct notification template.
// `data` carries template variables (all string values for FCM compatibility).
// `fcm_token` is the device registration token stored on User.fcm_token.
// ---------------------------------------------------------------------------

export interface PushEvent {
  type:
    | 'security.login_new_device'
    | 'security.password_changed'
    | 'security.all_sessions_revoked'
    | 'security.account_suspended'
    | 'security.2fa_enabled'
    | 'security.2fa_disabled'
    | 'org.suspended'
    | 'org.rejected'
    | 'org.cooperative_approved'
    | 'org.application_received'
    | 'org.contact_verified'
    | 'welcome';
  fcm_token: string;
  data?: Record<string, string>;
}

export const publishPush = (event: PushEvent): void =>
  publish('notifications', 'push.notifications', event);

// ---------------------------------------------------------------------------
// notifyUser — preference-aware dispatcher
//
// Routes to the correct channel(s) based on user.notif_channel:
//   'sms'   → SMS only
//   'email' → email only (requires user.email)
//   'app'   → push if fcm_token present, else SMS fallback
//   'all'   → SMS + email (if user.email) + push (if fcm_token)
//
// Callers provide the full event objects (with phone_number/email already set)
// for SMS and mail. For push, the caller provides the type + optional data;
// notifyUser fills in fcm_token from the user object.
// ---------------------------------------------------------------------------

export interface NotifiableUser {
  phone_number: string;
  email: string | null;
  fcm_token: string | null;
  notif_channel: 'sms' | 'email' | 'app' | 'all';
}

export const notifyUser = (
  user: NotifiableUser,
  opts: {
    sms?: SmsEvent;
    mail?: MailEvent;
    push?: { type: PushEvent['type']; data?: Record<string, string> };
  },
): void => {
  const ch = user.notif_channel;
  const hasFcm = !!user.fcm_token;
  const hasEmail = !!user.email;

  const shouldSms  = ch === 'sms' || ch === 'all' || (ch === 'app' && !hasFcm);
  const shouldMail = (ch === 'email' || ch === 'all') && hasEmail;
  const shouldPush = (ch === 'app'   || ch === 'all') && hasFcm;

  if (shouldSms  && opts.sms)  publishSms(opts.sms);
  if (shouldMail && opts.mail) publishMail(opts.mail);
  if (shouldPush && opts.push) publishPush({ ...opts.push, fcm_token: user.fcm_token! });
};
