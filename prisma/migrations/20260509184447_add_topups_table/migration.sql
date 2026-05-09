-- CreateTable
CREATE TABLE "topups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payment_ref" VARCHAR(36) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RWF',
    "phone" VARCHAR(20) NOT NULL,
    "payment_method" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "reason" VARCHAR(100),
    "message" VARCHAR(255),
    "retryable" BOOLEAN,
    "new_balance" DECIMAL(12,2),
    "mtn_transaction_id" VARCHAR(100),
    "mtn_absorbed" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "topups_payment_ref_key" ON "topups"("payment_ref");

-- CreateIndex
CREATE INDEX "topups_user_id_idx" ON "topups"("user_id");

-- AddForeignKey
ALTER TABLE "topups" ADD CONSTRAINT "topups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
