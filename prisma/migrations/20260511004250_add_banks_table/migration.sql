-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "account_number" VARCHAR(20),
ADD COLUMN     "bank_id" VARCHAR(36);

-- CreateTable
CREATE TABLE "banks" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "banks_name_key" ON "banks"("name");

-- AddForeignKey
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
