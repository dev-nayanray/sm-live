/*
  Warnings:

  - You are about to drop the column `gameProviderId` on the `SettlementRecord` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "SettlementRecord" DROP CONSTRAINT "SettlementRecord_gameProviderId_fkey";

-- AlterTable
ALTER TABLE "SettlementRecord" DROP COLUMN "gameProviderId";

-- AddForeignKey
ALTER TABLE "SettlementRecord" ADD CONSTRAINT "SettlementRecord_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "GameProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
