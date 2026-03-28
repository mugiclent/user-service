import cron from 'node-cron';
import { prisma } from '../models/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const log = (job: string, deleted: number): void => {
  if (deleted > 0) console.warn(`[cleanup:${job}] Deleted ${deleted} row(s)`);
};

const run = async (name: string, fn: () => Promise<number>): Promise<void> => {
  try {
    const deleted = await fn();
    log(name, deleted);
  } catch (err) {
    console.error(`[cleanup:${name}] Failed`, err);
  }
};

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/**
 * Delete expired OTPs.
 * Safe to hard-delete — expired OTPs are worthless and the row is small.
 * Runs every hour.
 */
const deleteExpiredOtps = () =>
  run('otps', async () => {
    const { count } = await prisma.otp.deleteMany({
      where: { expires_at: { lt: new Date() } },
    });
    return count;
  });

/**
 * Delete refresh tokens that are either:
 *   - expired (expires_at < now), OR
 *   - revoked more than 7 days ago (kept briefly for forensics / reuse detection)
 * Runs every hour.
 */
const deleteStaleRefreshTokens = () =>
  run('refresh_tokens', async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { count } = await prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expires_at: { lt: new Date() } },
          { revoked_at: { lt: sevenDaysAgo } },
        ],
      },
    });
    return count;
  });

/**
 * Hard-delete users who registered but never verified their phone number
 * and whose account is older than 24 hours.
 *
 * These are abandoned registrations or bot signups. Hard-delete (not soft)
 * because the phone number should be freed so it can be reregistered.
 * Runs daily.
 */
const deleteUnverifiedUsers = () =>
  run('unverified_users', async () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { count } = await prisma.user.deleteMany({
      where: {
        status: 'pending_verification',
        created_at: { lt: oneDayAgo },
        deleted_at: null,
      },
    });
    return count;
  });

/**
 * Hard-delete org applications where the contact email was never verified
 * and the application is older than 24 hours.
 *
 * OrgDocument rows are cascade-deleted.
 * Runs daily.
 */
const deleteAbandonedOrgApplications = () =>
  run('abandoned_org_applications', async () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { count } = await prisma.org.deleteMany({
      where: {
        status: 'pending',
        contact_email_verified_at: null,
        created_at: { lt: oneDayAgo },
        deleted_at: null,
      },
    });
    return count;
  });

/**
 * Delete invitations that expired without being accepted and are older than 7 days.
 * Keeps recent expired invites briefly in case an admin is checking status.
 * Runs daily.
 */
const deleteExpiredInvitations = () =>
  run('invitations', async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { count } = await prisma.invitation.deleteMany({
      where: {
        accepted_at: null,
        expires_at: { lt: sevenDaysAgo },
      },
    });
    return count;
  });

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const initCleanup = (): void => {
  // Run all jobs once immediately at startup to catch any backlog
  void deleteExpiredOtps();
  void deleteStaleRefreshTokens();
  void deleteUnverifiedUsers();
  void deleteAbandonedOrgApplications();
  void deleteExpiredInvitations();

  // Every hour: OTPs + refresh tokens
  cron.schedule('0 * * * *', () => {
    void deleteExpiredOtps();
    void deleteStaleRefreshTokens();
  });

  // Daily at 03:00 UTC: user/org/invitation cleanup
  cron.schedule('0 3 * * *', () => {
    void deleteUnverifiedUsers();
    void deleteAbandonedOrgApplications();
    void deleteExpiredInvitations();
  });

  console.warn('[cleanup] Scheduled: OTPs + refresh tokens (hourly), users/orgs/invitations (daily 03:00 UTC)');
};
