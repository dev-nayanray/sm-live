-- CreateTable: MaintenanceSchedule
CREATE TABLE "MaintenanceSchedule" (
    "id" SERIAL NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'platform',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "internalNotes" TEXT NOT NULL DEFAULT '',
    "createdById" INTEGER NOT NULL,
    "scheduledById" INTEGER,
    "activatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_scope_status_idx" ON "MaintenanceSchedule"("scope", "status");
CREATE INDEX "MaintenanceSchedule_status_startAt_idx" ON "MaintenanceSchedule"("status", "startAt");
CREATE INDEX "MaintenanceSchedule_createdById_idx" ON "MaintenanceSchedule"("createdById");

-- AddForeignKey: MaintenanceSchedule → AdminUser (creator, required)
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: MaintenanceSchedule → AdminUser (scheduler, optional)
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_scheduledById_fkey" FOREIGN KEY ("scheduledById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: MaintenanceEvent
CREATE TABLE "MaintenanceEvent" (
    "id" SERIAL NOT NULL,
    "maintenanceId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "adminId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceEvent_maintenanceId_createdAt_idx" ON "MaintenanceEvent"("maintenanceId", "createdAt");
CREATE INDEX "MaintenanceEvent_type_idx" ON "MaintenanceEvent"("type");

-- AddForeignKey: MaintenanceEvent → MaintenanceSchedule (cascade delete with parent)
ALTER TABLE "MaintenanceEvent" ADD CONSTRAINT "MaintenanceEvent_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "MaintenanceSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: MaintenanceEvent → AdminUser (actor, optional)
ALTER TABLE "MaintenanceEvent" ADD CONSTRAINT "MaintenanceEvent_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: BackupRecord
CREATE TABLE "BackupRecord" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'database',
    "scope" TEXT NOT NULL DEFAULT 'platform',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "location" TEXT NOT NULL DEFAULT '',
    "sizeBytes" INTEGER,
    "checksum" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRecord_kind_status_idx" ON "BackupRecord"("kind", "status");
CREATE INDEX "BackupRecord_status_createdAt_idx" ON "BackupRecord"("status", "createdAt");
CREATE INDEX "BackupRecord_createdById_idx" ON "BackupRecord"("createdById");

-- AddForeignKey: BackupRecord → AdminUser (creator, optional)
ALTER TABLE "BackupRecord" ADD CONSTRAINT "BackupRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: RecoveryRecord
CREATE TABLE "RecoveryRecord" (
    "id" SERIAL NOT NULL,
    "backupId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "targetEnvironment" TEXT NOT NULL DEFAULT 'staging',
    "impact" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "result" TEXT NOT NULL DEFAULT '',
    "requestedById" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecoveryRecord_backupId_idx" ON "RecoveryRecord"("backupId");
CREATE INDEX "RecoveryRecord_status_createdAt_idx" ON "RecoveryRecord"("status", "createdAt");
CREATE INDEX "RecoveryRecord_requestedById_idx" ON "RecoveryRecord"("requestedById");

-- AddForeignKey: RecoveryRecord → BackupRecord
ALTER TABLE "RecoveryRecord" ADD CONSTRAINT "RecoveryRecord_backupId_fkey" FOREIGN KEY ("backupId") REFERENCES "BackupRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: RecoveryRecord → AdminUser (requester, optional)
ALTER TABLE "RecoveryRecord" ADD CONSTRAINT "RecoveryRecord_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: HealthCheckResult
CREATE TABLE "HealthCheckResult" (
    "id" SERIAL NOT NULL,
    "component" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "responseTimeMs" INTEGER,
    "details" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "meta" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthCheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthCheckResult_component_checkedAt_idx" ON "HealthCheckResult"("component", "checkedAt");
CREATE INDEX "HealthCheckResult_status_checkedAt_idx" ON "HealthCheckResult"("status", "checkedAt");

-- CreateTable: OperationalIncident
CREATE TABLE "OperationalIncident" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "affectedService" TEXT NOT NULL DEFAULT '',
    "assigneeId" INTEGER,
    "internalNotes" TEXT NOT NULL DEFAULT '',
    "resolutionDetails" TEXT NOT NULL DEFAULT '',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "OperationalIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationalIncident_status_severity_idx" ON "OperationalIncident"("status", "severity");
CREATE INDEX "OperationalIncident_assigneeId_idx" ON "OperationalIncident"("assigneeId");
CREATE INDEX "OperationalIncident_affectedService_idx" ON "OperationalIncident"("affectedService");
CREATE INDEX "OperationalIncident_createdAt_idx" ON "OperationalIncident"("createdAt");

-- AddForeignKey: OperationalIncident → AdminUser (assignee, optional)
ALTER TABLE "OperationalIncident" ADD CONSTRAINT "OperationalIncident_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: OperationalIncident → AdminUser (creator, optional)
ALTER TABLE "OperationalIncident" ADD CONSTRAINT "OperationalIncident_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: SystemAlert
CREATE TABLE "SystemAlert" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "status" TEXT NOT NULL DEFAULT 'open',
    "message" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "meta" JSONB,
    "ackedById" INTEGER,
    "resolvedById" INTEGER,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT NOT NULL DEFAULT '',
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "lastOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemAlert_status_severity_idx" ON "SystemAlert"("status", "severity");
CREATE INDEX "SystemAlert_source_fingerprint_idx" ON "SystemAlert"("source", "fingerprint");
CREATE INDEX "SystemAlert_createdAt_idx" ON "SystemAlert"("createdAt");

-- AddForeignKey: SystemAlert → AdminUser (ackedBy, optional)
ALTER TABLE "SystemAlert" ADD CONSTRAINT "SystemAlert_ackedById_fkey" FOREIGN KEY ("ackedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: SystemAlert → AdminUser (resolvedBy, optional)
ALTER TABLE "SystemAlert" ADD CONSTRAINT "SystemAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
