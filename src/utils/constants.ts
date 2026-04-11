/** Days before a pending_deletion account is permanently anonymized by pg_cron. Must match prisma/jobs/anonymize_deleted_users.sql */
export const DELETION_GRACE_DAYS = 30;
