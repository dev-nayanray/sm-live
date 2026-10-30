-- CreateTable: VipMembership
CREATE TABLE "VipMembership" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "planKey" TEXT NOT NULL DEFAULT '',
    "coinsPaid" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VipMembership_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VipMembership_userId_idx" ON "VipMembership"("userId");
CREATE INDEX "VipMembership_status_expiresAt_idx" ON "VipMembership"("status", "expiresAt");

ALTER TABLE "VipMembership" ADD CONSTRAINT "VipMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
