-- Drop old single-column unique constraints
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_phone_number_key";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_key";

-- Add composite unique constraints: (phone_number, user_type) and (email, user_type)
-- This allows the same phone/email to be used across different user types (passenger vs staff)
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_number_user_type_key" ON "users"("phone_number", "user_type") WHERE "phone_number" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_user_type_key" ON "users"("email", "user_type") WHERE "email" IS NOT NULL;
