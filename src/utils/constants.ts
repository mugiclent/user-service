/** Days before a pending_deletion account is permanently anonymized by pg_cron. Configured via DELETION_GRACE_DAYS env var (default 30). Must match prisma/jobs/anonymize_deleted_users.sql */
export const DELETION_GRACE_DAYS = parseInt(process.env['DELETION_GRACE_DAYS'] ?? '30', 10);
