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

export type Locale = 'rw' | 'en' | 'fr';

export type SmsEvent = (
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
  | { type: 'invite.sms'; phone_number: string; first_name: string; invited_by: string; invite_link: string; expires_in_seconds: number }
  | { type: 'org_approved.sms'; phone_number: string; org_name: string; invite_link: string; expires_in_seconds: number }
  // ── Security events ───────────────────────────────────────────────────────
  | { type: 'security.login_new_device'; phone_number: string; first_name: string; device?: string }
  | { type: 'security.password_changed'; phone_number: string; first_name: string }
  | { type: 'security.account_suspended'; phone_number: string; first_name: string }
  | { type: 'security.2fa_enabled'; phone_number: string; first_name: string }
  | { type: 'security.2fa_disabled'; phone_number: string; first_name: string }
  // ── Org status events ─────────────────────────────────────────────────────
  | { type: 'org.suspended'; phone_number: string; org_name: string }
  | { type: 'org.rejected'; phone_number: string; org_name: string; reason?: string }
  | { type: 'org.contact_verified'; phone_number: string; org_name: string }
  | { type: 'org.contact_otp'; phone_number: string; org_name: string; code: string; expires_in_seconds: number }
  | { type: 'org.application_received'; phone_number: string; org_name: string; contact_email: string; org_type: string }
  // ── Cooperative member flow ───────────────────────────────────────────────
  | { type: 'org.member_application_received'; phone_number: string; org_name: string; coop_name: string }
  | { type: 'org.member_coop_rejected'; phone_number: string; org_name: string; coop_name: string; reason?: string }
  | { type: 'org.member_coop_approved'; phone_number: string; org_name: string; coop_name: string }
  | { type: 'org.member_approved'; phone_number: string; org_name: string; invite_link: string; expires_in_seconds: number }
  | { type: 'org.member_approved_notify_coop'; phone_number: string; org_name: string }
) & { locale?: Locale };

export const publishSms = (event: SmsEvent): void =>
  publish('notifications', 'sms.notifications', event);

// ---------------------------------------------------------------------------
// Mail notifications — notifications exchange, routing key: mail.notifications
// Routed to the `mail` queue.
// ---------------------------------------------------------------------------

export type MailEvent = (
  // ── OTP delivery ──────────────────────────────────────────────────────────
  | {
      type: 'otp.mail';
      purpose: 'email_verification' | '2fa' | 'password_reset';
      email: string;
      first_name: string;
      code: string;
      expires_in_seconds: number;
    }
  // ── Welcome / onboarding ──────────────────────────────────────────────────
  | { type: 'welcome.mail'; email: string; first_name: string }
  | { type: 'invite.mail'; email: string; first_name: string; invited_by: string; invite_link: string; expires_in_seconds: number }
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
  | { type: 'org.application_received'; email: string; org_name: string; contact_email: string; org_type: string }
  // ── Cooperative member flow ───────────────────────────────────────────────
  | { type: 'org.member_application_received'; email: string; org_name: string; coop_name: string; contact_email: string }
  | { type: 'org.member_coop_rejected'; email: string; first_name: string; org_name: string; coop_name: string; reason?: string }
  | { type: 'org.member_coop_approved'; email: string; org_name: string; coop_name: string; contact_email: string }
  | { type: 'org.member_approved'; email: string; first_name: string; org_name: string; invite_link: string; expires_in_seconds: number }
  | { type: 'org.member_approved_notify_coop'; email: string; org_name: string }
) & { locale?: Locale };

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
    | 'security.account_suspended'
    | 'security.2fa_enabled'
    | 'security.2fa_disabled'
    | 'org.suspended'
    | 'org.rejected'
    | 'org.application_received'
    | 'org.member_approved'
    | 'welcome';
  fcm_token: string;
  data?: Record<string, string>;
}

export const publishPush = (event: PushEvent): void =>
  publish('notifications', 'push.notifications', event);

// ---------------------------------------------------------------------------
// Org domain events — logs exchange, routing key: org.events
// Consumed by downstream services that track org state.
// ---------------------------------------------------------------------------

export type OrgDomainEvent =
  | {
      type: 'org.activated';
      id: string;
      name: string;
      slug: string;
      org_type: 'company' | 'cooperative' | 'coop_member';
      status: 'active';
      tin: string;
      billing_day: number;
      logo_path: string | null;
      parent_org_id: string | null;
      story: string | null;
      cancellations_allowed: boolean;
      bank_id: string | null;
      account_number: string | null;
    }
  | {
      type: 'org.updated';
      id: string;
      name: string;
      slug: string;
      logo_path: string | null;
      parent_org_id: string | null;
      story: string | null;
      cancellations_allowed: boolean;
      updated_at: string;
    }
  | {
      type: 'org.suspended';
      id: string;
      status: 'suspended';
      reason?: string;
    };

export const publishOrgEvent = (event: OrgDomainEvent): void =>
  publish('users', 'org.events', event);

// ---------------------------------------------------------------------------
// Staff user domain events — users exchange, routing key: user.events
// Consumed by downstream services that track staff identity.
// ---------------------------------------------------------------------------

export type StaffUserDomainEvent =
  | {
      type: 'staff.created';
      id: string;
      first_name: string;
      last_name: string;
      org_id: string | null;
      roles: string[];
      user_type: 'staff';
      avatar_path: string | null;
      status: string;
    }
  | {
      type: 'staff.updated';
      id: string;
      first_name: string;
      last_name: string;
      avatar_path: string | null;
      org_id: string | null;
      roles: string[];
      status: string;
      updated_at: string;
    }
  | {
      type: 'staff.suspended';
      id: string;
      org_id: string | null;
      status: 'suspended';
    }
  | {
      type: 'staff.deleted';
      id: string;
      org_id: string | null;
      deleted_at: string;
    };

export const publishUserEvent = (event: StaffUserDomainEvent): void =>
  publish('users', 'user.events', event);

// ---------------------------------------------------------------------------
// User lifecycle domain events — users exchange, routing key: user.events
// Applies to both passengers and staff: account activation, credential changes.
// ---------------------------------------------------------------------------

export type UserDomainEvent =
  | {
      type: 'user.activated';
      id: string;
      user_type: 'passenger' | 'staff';
      login_channel: 'phone' | 'email';
    }
  | {
      type: 'user.password_changed';
      id: string;
      user_type: 'passenger' | 'staff';
    }
  | {
      type: 'user.login_channel_changed';
      id: string;
      login_channel: 'phone' | 'email';
    };

export const publishUserDomainEvent = (event: UserDomainEvent): void =>
  publish('users', 'user.events', event);

// ---------------------------------------------------------------------------
// Invitation domain events — users exchange, routing key: invitation.events
// ---------------------------------------------------------------------------

export type InvitationDomainEvent =
  | {
      type: 'invitation.created';
      invitation_id: string;
      org_id: string | null;
      email: string | null;
      phone_number: string | null;
      invited_by: string;
      expires_at: string;
    }
  | {
      type: 'invitation.accepted';
      invitation_id: string;
      org_id: string | null;
      user_id: string;
    }
  | {
      type: 'invitation.resent';
      invitation_id: string;
      org_id: string | null;
      expires_at: string;
    };

export const publishInvitationEvent = (event: InvitationDomainEvent): void =>
  publish('users', 'invitation.events', event);

// ---------------------------------------------------------------------------
// Wallet domain events — users exchange, routing key: wallet.events
// ---------------------------------------------------------------------------

export type WalletDomainEvent = {
  type: 'wallet.topup.requested';
  topup_id: string;
  payment_ref: string;
  user_id: string;
  amount: number;
  currency: 'RWF';
  phone: string;
  payment_method: 'mtn' | 'airtel';
};

export const publishWalletEvent = (event: WalletDomainEvent): void =>
  publish('users', 'wallet.events', event);

// ---------------------------------------------------------------------------
// notifyUser — preference-aware dispatcher
//
// Routes to the correct channel(s) based on user.notif_channel array.
// Any combination of 'sms', 'email', 'app' is valid.
// 'app' falls back to SMS when no fcm_token is present.
//
// Callers provide the full event objects (with phone_number/email already set)
// for SMS and mail. For push, the caller provides the type + optional data;
// notifyUser fills in fcm_token from the user object.
// ---------------------------------------------------------------------------

export interface NotifiableUser {
  phone_number: string | null;
  email: string | null;
  fcm_token: string | null;
  notif_channel: string[];
  locale?: string;
}

export const notifyUser = (
  user: NotifiableUser,
  opts: {
    sms?: SmsEvent;
    mail?: MailEvent;
    push?: { type: PushEvent['type']; data?: Record<string, string> };
  },
  // Locale for THIS message. Pass the request locale (x-user-locale) for
  // self-actions so a user's UI language choice (incl. anonymous flows) drives
  // their own notifications. Omit for cross-user notifications (admin→target,
  // broadcasts) so each recipient is messaged in their own saved language.
  localeOverride?: string,
): void => {
  const ch = user.notif_channel;
  const hasFcm = !!user.fcm_token;
  const hasEmail = !!user.email;
  const locale = (localeOverride ?? (user.locale as Locale | undefined) ?? 'rw') as Locale;

  const hasPhone = !!user.phone_number;
  const shouldSms  = hasPhone && (ch.includes('sms') || (ch.includes('app') && !hasFcm));
  const shouldMail = ch.includes('email') && hasEmail;
  const shouldPush = ch.includes('app') && hasFcm;

  if (shouldSms  && opts.sms)  publishSms({ ...opts.sms, locale });
  if (shouldMail && opts.mail) publishMail({ ...opts.mail, locale });
  if (shouldPush && opts.push) publishPush({ ...opts.push, fcm_token: user.fcm_token! });
};
