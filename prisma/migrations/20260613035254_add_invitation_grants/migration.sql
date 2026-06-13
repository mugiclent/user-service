-- CreateTable
CREATE TABLE "invitation_grants" (
    "id" TEXT NOT NULL,
    "invitation_id" TEXT NOT NULL,
    "pattern" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitation_grants_invitation_id_pattern_key" ON "invitation_grants"("invitation_id", "pattern");

-- AddForeignKey
ALTER TABLE "invitation_grants" ADD CONSTRAINT "invitation_grants_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
