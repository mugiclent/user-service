-- Add the absolute session ceiling carried forward across refresh-token rotations.
-- Nullable: rows created before this column existed are treated as "no cap" and
-- pick up a fresh cap on their next rotation.
ALTER TABLE "refresh_tokens" ADD COLUMN "absolute_expires_at" TIMESTAMP(3);
