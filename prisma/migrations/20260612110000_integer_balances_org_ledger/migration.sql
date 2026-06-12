-- Balances move from Decimal(12,2) to integer (RWF has no minor unit), and the
-- wallet ledger generalises from passenger-only to any owner (passenger | org).

-- Balances -> BIGINT
ALTER TABLE "users" ALTER COLUMN "balance" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "balance" TYPE BIGINT USING (round("balance")::bigint);
ALTER TABLE "users" ALTER COLUMN "balance" SET DEFAULT 0;

ALTER TABLE "orgs" ALTER COLUMN "balance" DROP DEFAULT;
ALTER TABLE "orgs" ALTER COLUMN "balance" TYPE BIGINT USING (round("balance")::bigint);
ALTER TABLE "orgs" ALTER COLUMN "balance" SET DEFAULT 0;

-- wallet_transactions: generalise owner + integer amounts
ALTER TABLE "wallet_transactions" RENAME COLUMN "user_id" TO "owner_id";
ALTER TABLE "wallet_transactions" ADD COLUMN "owner_type" VARCHAR(20) NOT NULL DEFAULT 'PASSENGER';
ALTER TABLE "wallet_transactions" ALTER COLUMN "owner_type" DROP DEFAULT;
ALTER TABLE "wallet_transactions" ALTER COLUMN "amount" TYPE BIGINT USING (round("amount")::bigint);
ALTER TABLE "wallet_transactions" ALTER COLUMN "balance_after" TYPE BIGINT USING (round("balance_after")::bigint);

DROP INDEX IF EXISTS "wallet_transactions_user_id_occurred_at_idx";
CREATE INDEX "wallet_transactions_owner_id_owner_type_occurred_at_idx" ON "wallet_transactions"("owner_id", "owner_type", "occurred_at");
