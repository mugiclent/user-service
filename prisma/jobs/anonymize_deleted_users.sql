-- =============================================================================
-- pg_cron job: anonymize users past the deletion grace period
--
-- Grace period: 30 days (must match DELETION_GRACE_DAYS in user.service.ts)
--
-- What this does:
--   Finds users in status='pending_deletion' whose deleted_at is older than
--   30 days and wipes all PII, then sets status='deleted'. The row is kept
--   for referential integrity (audit logs, refresh tokens, invitations all
--   reference user_id).
--
-- Setup (run once on the database, requires pg_cron extension):
--
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--
--   SELECT cron.schedule(
--     'anonymize-deleted-users',   -- job name
--     '0 3 * * *',                 -- daily at 03:00 UTC
--     $$
--       UPDATE users SET
--         first_name        = 'Deleted',
--         last_name         = 'User',
--         phone_number      = NULL,
--         email             = NULL,
--         password_hash     = NULL,
--         avatar_path       = NULL,
--         login_channel     = NULL,
--         two_factor_enabled = FALSE,
--         phone_verified_at = NULL,
--         email_verified_at = NULL,
--         status            = 'deleted'
--       WHERE status = 'pending_deletion'
--         AND deleted_at < now() - INTERVAL '30 days';
--     $$
--   );
--
-- To verify the job is registered:
--   SELECT * FROM cron.job WHERE jobname = 'anonymize-deleted-users';
--
-- To remove the job:
--   SELECT cron.unschedule('anonymize-deleted-users');
--
-- To run immediately (for testing):
--   UPDATE users SET
--     first_name        = 'Deleted',
--     last_name         = 'User',
--     phone_number      = NULL,
--     email             = NULL,
--     password_hash     = NULL,
--     avatar_path       = NULL,
--     login_channel     = NULL,
--     two_factor_enabled = FALSE,
--     phone_verified_at = NULL,
--     email_verified_at = NULL,
--     status            = 'deleted'
--   WHERE status = 'pending_deletion'
--     AND deleted_at < now() - INTERVAL '30 days';
-- =============================================================================

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Register (or replace) the daily anonymization job
SELECT cron.unschedule('anonymize-deleted-users') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'anonymize-deleted-users'
);

SELECT cron.schedule(
  'anonymize-deleted-users',
  '0 3 * * *',
  $$
    UPDATE users SET
      first_name         = 'Deleted',
      last_name          = 'User',
      phone_number       = NULL,
      email              = NULL,
      password_hash      = NULL,
      avatar_path        = NULL,
      login_channel      = NULL,
      two_factor_enabled = FALSE,
      phone_verified_at  = NULL,
      email_verified_at  = NULL,
      status             = 'deleted'
    WHERE status = 'pending_deletion'
      AND deleted_at < now() - INTERVAL '30 days';
  $$
);
