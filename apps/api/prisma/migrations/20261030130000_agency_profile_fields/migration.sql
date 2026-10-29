-- AlterTable: add agency profile fields (description, contactEmail,
-- contactPhone, country). All defaults are empty strings / "XX" so the
-- migration is fully back-compatible — existing rows get sensible defaults
-- and the new fields are optional on every write path.
ALTER TABLE "Agency" ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
                          ADD COLUMN "contactEmail" TEXT NOT NULL DEFAULT '',
                          ADD COLUMN "contactPhone" TEXT NOT NULL DEFAULT '',
                          ADD COLUMN "country" TEXT NOT NULL DEFAULT 'XX';

-- CreateIndex: support status + created-date filtering on the agencies list
CREATE INDEX "Agency_active_idx" ON "Agency"("active");
CREATE INDEX "Agency_createdAt_idx" ON "Agency"("createdAt");
