import { prisma } from '../models/index.js';
import { slugify } from '../utils/slugify.js';
import { AppError } from '../utils/AppError.js';
import { OrgOtpService } from './org-otp.service.js';
import { publishMail, publishSms, publishAudit, notifyUser, publishOrgEvent } from '../utils/publishers.js';
import type { Locale, NotifiableUser } from '../utils/publishers.js';

// ---------------------------------------------------------------------------
// Helpers — notification recipients
// ---------------------------------------------------------------------------

const PLATFORM_NOTIFICATION_PATTERNS = [
  '*:*:platform',
  'Notification:*:platform',
  '*:receive:platform',
  'Notification:receive:platform',
];

const getPlatformNotificationRecipients = () =>
  prisma.user.findMany({
    where: {
      status: 'active',
      deleted_at: null,
      OR: [
        {
          user_roles: {
            some: {
              role: {
                role_grants: {
                  some: { pattern: { in: PLATFORM_NOTIFICATION_PATTERNS } },
                },
              },
            },
          },
        },
        {
          user_grants: {
            some: { pattern: { in: PLATFORM_NOTIFICATION_PATTERNS } },
          },
        },
      ],
    },
    select: { email: true, phone_number: true, fcm_token: true, notif_channel: true, locale: true },
  });

const COOP_NOTIFICATION_PATTERNS = [
  '*:*:org',
  'Notification:*:org',
  '*:receive:org',
  'Notification:receive:org',
];

const getCoopNotificationRecipients = (coopOrgId: string) =>
  prisma.user.findMany({
    where: {
      org_id: coopOrgId,
      status: 'active',
      deleted_at: null,
      OR: [
        {
          user_roles: {
            some: {
              role: {
                role_grants: {
                  some: { pattern: { in: COOP_NOTIFICATION_PATTERNS } },
                },
              },
            },
          },
        },
        {
          user_grants: {
            some: { pattern: { in: COOP_NOTIFICATION_PATTERNS } },
          },
        },
      ],
    },
    select: { email: true, phone_number: true, fcm_token: true, notif_channel: true, locale: true },
  });

// ---------------------------------------------------------------------------
// OrgApplicationService
// ---------------------------------------------------------------------------

export const OrgApplicationService = {
  /**
   * POST /organizations/apply
   *
   * Creates an org record (status: unverified) and sends a 6-digit OTP
   * to BOTH contact_phone (SMS) and contact_email (mail) — different codes.
   * Either channel can be verified to move the org to pending status.
   * No admin notification until one contact channel is verified.
   */
  async apply(data: {
    name: string;
    org_type: string;
    contact_first_name: string;
    contact_last_name: string;
    contact_email: string;
    contact_phone: string;
    address?: string;
    tin?: string;
    license_number?: string;
    parent_org_id?: string;
    business_certificate_path: string;
    rep_id_path: string;
    story?: string;
  }): Promise<{ org_id: string; message: string }> {
    const slug = slugify(data.name);

    const [existing, tinConflict, phoneConflict, emailConflict] = await Promise.all([
      prisma.org.findFirst({ where: { OR: [{ name: data.name }, { slug }] }, select: { id: true } }),
      prisma.org.findUnique({ where: { tin: data.tin! }, select: { id: true } }),
      prisma.user.findUnique({ where: { phone_number_user_type: { phone_number: data.contact_phone, user_type: 'staff' } }, select: { id: true } }),
      prisma.user.findUnique({ where: { email_user_type: { email: data.contact_email, user_type: 'staff' } }, select: { id: true } }),
    ]);
    if (existing) throw new AppError('ORG_ALREADY_EXISTS', 409);
    if (tinConflict) throw new AppError('TIN_ALREADY_EXISTS', 409);
    if (phoneConflict) throw new AppError('CONTACT_PHONE_ALREADY_REGISTERED', 409);
    if (emailConflict) throw new AppError('CONTACT_EMAIL_ALREADY_REGISTERED', 409);

    // coop_member must reference an active cooperative as parent
    if (data.org_type === 'coop_member') {
      const parentCoop = await prisma.org.findUnique({
        where: { id: data.parent_org_id!, deleted_at: null },
        select: { id: true, org_type: true, status: true },
      });
      if (!parentCoop || parentCoop.org_type !== 'cooperative') throw new AppError('PARENT_COOP_NOT_FOUND', 404);
      if (parentCoop.status !== 'active') throw new AppError('PARENT_COOP_NOT_ACTIVE', 400);
    }

    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.org.create({
        data: {
          name: data.name,
          slug,
          org_type: data.org_type as 'company' | 'cooperative' | 'coop_member',
          contact_first_name: data.contact_first_name,
          contact_last_name: data.contact_last_name,
          contact_email: data.contact_email,
          contact_phone: data.contact_phone,
          address: data.address ?? null,
          tin: data.tin!,
          license_number: data.license_number ?? null,
          parent_org_id: data.org_type === 'coop_member' ? (data.parent_org_id ?? null) : null,
          story: data.story ?? null,
          status: 'unverified',
        },
      });

      await tx.orgDocument.createMany({
        data: [
          { org_id: created.id, doc_type: 'business_certificate', s3_path: data.business_certificate_path, mime_type: 'application/pdf' },
          { org_id: created.id, doc_type: 'rep_id', s3_path: data.rep_id_path, mime_type: 'application/octet-stream' },
        ],
      });

      return created;
    });

    // Send separate OTPs to both channels
    const [phoneOtp, emailOtp] = await Promise.all([
      OrgOtpService.create(org.id, 'phone_verification'),
      OrgOtpService.create(org.id, 'email_verification'),
    ]);

    publishSms({
      type: 'org.contact_otp',
      phone_number: data.contact_phone,
      org_name: data.name,
      code: phoneOtp.code,
      expires_in_seconds: phoneOtp.expiresIn,
    });
    publishMail({
      type: 'org.contact_otp',
      email: data.contact_email,
      first_name: data.contact_first_name,
      org_name: data.name,
      code: emailOtp.code,
      expires_in_seconds: emailOtp.expiresIn,
    });

    publishAudit({ actor_id: org.id, action: 'apply', resource: 'Org', resource_id: org.id });

    return {
      org_id: org.id,
      message: 'Application received. Verification codes have been sent to your phone and email. Verify either to submit your application.',
    };
  },

  /**
   * POST /organizations/verify-contact
   *
   * Verifies the OTP sent to the specified channel (phone or email).
   * On first successful verification:
   *   - Sets contact_phone_verified_at or contact_email_verified_at
   *   - Upgrades org status from unverified → pending
   *   - Notifies all platform-notification-enabled staff via their preferred channels
   */
  async verifyContact(orgId: string, otp: string, channel: 'phone' | 'email'): Promise<void> {
    const org = await prisma.org.findUnique({ where: { id: orgId } });

    if (!org) throw new AppError('ORG_NOT_FOUND', 404);
    if (org.status !== 'unverified') throw new AppError('CONTACT_ALREADY_VERIFIED', 409);

    const purpose = channel === 'phone' ? 'phone_verification' : 'email_verification';
    const alreadyVerified = channel === 'phone' ? org.contact_phone_verified_at : org.contact_email_verified_at;
    if (alreadyVerified) throw new AppError('CONTACT_ALREADY_VERIFIED', 409);

    await OrgOtpService.verify(orgId, otp, purpose);

    await prisma.org.update({
      where: { id: orgId },
      data: {
        ...(channel === 'phone'
          ? { contact_phone_verified_at: new Date() }
          : { contact_email_verified_at: new Date() }),
        status: 'pending',
      },
    });

    // Confirm to applicant via SMS only
    publishSms({
      type: 'org.contact_verified',
      phone_number: org.contact_phone,
      org_name: org.name,
    });

    // Notify all platform admins
    const platformRecipients = await getPlatformNotificationRecipients();
    for (const recipient of platformRecipients) {
      notifyUser(recipient as NotifiableUser, {
        mail: recipient.email
          ? { type: 'org.application_received', email: recipient.email, org_name: org.name, contact_email: org.contact_email, org_type: org.org_type, locale: recipient.locale as Locale }
          : undefined,
        sms: recipient.phone_number
          ? { type: 'org.application_received', phone_number: recipient.phone_number, org_name: org.name, contact_email: org.contact_email, org_type: org.org_type, locale: recipient.locale as Locale }
          : undefined,
      });
    }

    // For coop_member: also notify the parent cooperative admins
    if (org.org_type === 'coop_member' && org.parent_org_id) {
      const parentCoop = await prisma.org.findUnique({
        where: { id: org.parent_org_id },
        select: { name: true },
      });
      const coopRecipients = await getCoopNotificationRecipients(org.parent_org_id);
      const coopName = parentCoop?.name ?? '';
      for (const recipient of coopRecipients) {
        notifyUser(recipient as NotifiableUser, {
          mail: recipient.email
            ? { type: 'org.member_application_received', email: recipient.email, org_name: org.name, coop_name: coopName, contact_email: org.contact_email, locale: recipient.locale as Locale }
            : undefined,
          sms: recipient.phone_number
            ? { type: 'org.member_application_received', phone_number: recipient.phone_number, org_name: org.name, coop_name: coopName, locale: recipient.locale as Locale }
            : undefined,
        });
      }
    }

    publishOrgEvent({
      type: 'org.application_submitted',
      org_id: org.id,
      org_type: org.org_type,
      parent_org_id: org.parent_org_id,
      contact_email: org.contact_email,
      contact_phone: org.contact_phone,
    });

    publishAudit({ actor_id: orgId, action: 'verify_contact', resource: 'Org', resource_id: orgId });
  },

  /**
   * POST /organizations/resend-contact-otp
   *
   * Resends the OTP for a specific channel. Org must still be unverified
   * and an OTP flow must have been initiated (i.e. apply() was called).
   */
  async resendContactOtp(orgId: string, channel: 'phone' | 'email'): Promise<{ expires_in: number }> {
    const org = await prisma.org.findUnique({ where: { id: orgId } });
    if (!org) throw new AppError('ORG_NOT_FOUND', 404);
    if (org.status !== 'unverified') throw new AppError('CONTACT_ALREADY_VERIFIED', 409);

    const purpose = channel === 'phone' ? 'phone_verification' : 'email_verification';
    const alreadyVerified = channel === 'phone' ? org.contact_phone_verified_at : org.contact_email_verified_at;
    if (alreadyVerified) throw new AppError('CONTACT_ALREADY_VERIFIED', 409);

    // Gate: require that apply() was already called (OTP flow initiated)
    const hasExisting = await OrgOtpService.hasExisting(orgId, purpose);
    if (!hasExisting) throw new AppError('OTP_FLOW_NOT_INITIATED', 400);

    const { code, expiresIn } = await OrgOtpService.create(orgId, purpose);

    if (channel === 'phone') {
      publishSms({
        type: 'org.contact_otp',
        phone_number: org.contact_phone,
        org_name: org.name,
        code,
        expires_in_seconds: expiresIn,
      });
    } else {
      publishMail({
        type: 'org.contact_otp',
        email: org.contact_email,
        first_name: org.contact_first_name,
        org_name: org.name,
        code,
        expires_in_seconds: expiresIn,
      });
    }

    return { expires_in: expiresIn };
  },
};
