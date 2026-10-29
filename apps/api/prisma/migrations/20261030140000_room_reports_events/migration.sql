-- CreateTable: RoomReport — room-level reports/complaints linked to a
-- specific room. Separate from the existing user-level Complaint model
-- because room reports carry roomId + optional reportedUserId context.
CREATE TABLE "RoomReport" (
    "id" SERIAL NOT NULL,
    "roomId" INTEGER NOT NULL,
    "reporterId" INTEGER,
    "reportedUserId" INTEGER,
    "category" TEXT NOT NULL DEFAULT 'other',
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "reviewerId" INTEGER,
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomReport_roomId_idx" ON "RoomReport"("roomId");
CREATE INDEX "RoomReport_status_idx" ON "RoomReport"("status");
CREATE INDEX "RoomReport_category_idx" ON "RoomReport"("category");
CREATE INDEX "RoomReport_createdAt_idx" ON "RoomReport"("createdAt");

-- AddForeignKey: RoomReport → Room (cascade delete when room is deleted)
ALTER TABLE "RoomReport" ADD CONSTRAINT "RoomReport_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: RoomEvent — append-only room lifecycle event timeline.
CREATE TABLE "RoomEvent" (
    "id" SERIAL NOT NULL,
    "roomId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "userId" INTEGER,
    "adminId" INTEGER,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomEvent_roomId_createdAt_idx" ON "RoomEvent"("roomId", "createdAt");
CREATE INDEX "RoomEvent_type_idx" ON "RoomEvent"("type");

-- AddForeignKey: RoomEvent → Room (cascade delete)
ALTER TABLE "RoomEvent" ADD CONSTRAINT "RoomEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: Room.closedAt — supports filtering active vs historical rooms
CREATE INDEX "Room_closedAt_idx" ON "Room"("closedAt");
