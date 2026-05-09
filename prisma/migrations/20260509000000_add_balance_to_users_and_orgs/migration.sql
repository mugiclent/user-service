-- Add wallet balance to users (passengers) and orgs
ALTER TABLE "users" ADD COLUMN "balance" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "orgs"  ADD COLUMN "balance" DECIMAL(12,2) NOT NULL DEFAULT 0;
