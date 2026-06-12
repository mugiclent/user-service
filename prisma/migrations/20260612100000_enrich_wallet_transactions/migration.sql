-- Enrich the wallet ledger projection with the source, payment reference, and
-- (for ticket movements) the ticket id, so history rows are self-describing.
ALTER TABLE "wallet_transactions" ADD COLUMN "source" VARCHAR(20);
ALTER TABLE "wallet_transactions" ADD COLUMN "reference" TEXT;
ALTER TABLE "wallet_transactions" ADD COLUMN "ticket_id" TEXT;
