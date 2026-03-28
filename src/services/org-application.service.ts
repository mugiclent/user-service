import { randomInt } from 'node:crypto';
import { prisma } from '../models/index.js';
import { hashToken } from '../utils/crypto.js';
import { slugify } from '../utils/slugify.js';
import { AppError } from '../utils/AppError.js';
import { publishMail, publishSms, publishAudit } from '../utils/publishers.js';
import { config } from '../config/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generateOtp = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

const OTP_TTL_SECONDS = 600; // 10 minutes for contact verification

// ---------------------------------------------------------------------------
// OrgApplicationService
// ---------------------------------------------------------------------------

export const OrgApplicationService = {
  /**
   * POST /organizations/apply
   *
   * Creates an org record (status: pending) with the uploaded document paths.
   * Sends a 6-digit OTP to contact_email for verification.
   * No admin notification is sent until the email OTP is verified.
   */
  async apply(data: {
    name: string;
    org_type: string;
    contact_email: string;
    contact_phone: string;
    address?: string;
    tin?: string;
    license_number?: string;
    parent_org_id?: string;
    business_certificate_path: string;
    rep_id_path: string;
  }): Promise<{ org_id: string; message: string }> {
    const slug = slugify(data.name);

    const existing = await prisma.org.findFirst({
      where: { OR: [{ name: data.name }, { slug }] },
    });
    if (existing) throw new AppError('ORG_ALREADY_EXISTS', 409);

    const code = generateOtp();
    const codeHash = hashToken(code);
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.org.create({
        data: {
          name: data.name,
          slug,
          org_type: data.org_type as 'company' | 'cooperative',
          contact_email: data.contact_email,
          contact_phone: data.contact_phone,
          address: data.address ?? null,
          tin: data.tin ?? null,
          license_number: data.license_number ?? null,
          parent_org_id: data.parent_org_id ?? null,
          status: 'pending',
          contact_otp_hash: codeHash,
          contact_otp_expires_at: expiresAt,
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

    // Send OTP to contact email for verification
    publishMail({
      type: 'org.contact_otp',
      email: data.contact_email,
      first_name: data.name,
      org_name: data.name,
      code,
      expires_in_seconds: OTP_TTL_SECONDS,
    });

    publishAudit({ actor_id: org.id, action: 'apply', resource: 'Org', resource_id: org.id });

    return { org_id: org.id, message: 'Application received. Please check your email for a verification code.' };
  },

  /**
   * POST /organizations/verify-contact
   *
   * Verifies the 6-digit OTP sent to the org's contact email.
   * On success:
   *   - Sets contact_email_verified_at
   *   - Clears the OTP fields
   *   - Sends confirmation to the applicant (email + SMS)
   *   - Notifies Katisha admins (email to ADMIN_NOTIFICATION_EMAIL)
   */
  async verifyContact(orgId: string, otp: string): Promise<void> {
    const org = await prisma.org.findUnique({ where: { id: orgId } });

    if (!org) throw new AppError('ORG_NOT_FOUND', 404);
    if (org.contact_email_verified_at) throw new AppError('CONTACT_ALREADY_VERIFIED', 409);
    if (!org.contact_otp_hash || !org.contact_otp_expires_at) throw new AppError('INVALID_OTP', 400);

    if (org.contact_otp_expires_at < new Date()) {
      throw new AppError('OTP_EXPIRED', 410);
    }

    const codeHash = hashToken(otp);
    if (codeHash !== org.contact_otp_hash) throw new AppError('INVALID_OTP', 400);

    await prisma.org.update({
      where: { id: orgId },
      data: {
        contact_email_verified_at: new Date(),
        contact_otp_hash: null,
        contact_otp_expires_at: null,
      },
    });

    // Confirm to applicant
    publishMail({
      type: 'org.contact_verified',
      email: org.contact_email,
      org_name: org.name,
      first_name: org.name,
    });
    publishSms({
      type: 'org.contact_verified',
      phone_number: org.contact_phone,
      org_name: org.name,
    });

    // Notify Katisha admins
    if (config.adminNotificationEmail) {
      publishMail({
        type: 'org.application_received',
        email: config.adminNotificationEmail,
        org_name: org.name,
        contact_email: org.contact_email,
        org_type: org.org_type,
      });
    }

    publishAudit({ actor_id: orgId, action: 'verify_contact', resource: 'Org', resource_id: orgId });
  },
};
