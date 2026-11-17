-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DISPATCHER', 'RIDER', 'VIEWER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('NEW', 'READY_FOR_ASSIGNMENT', 'AWAITING_CONFIRMATION', 'ACCEPTED', 'PICKED_UP', 'DELIVERED', 'MANUAL_QUEUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "RiderAvailability" AS ENUM ('ONLINE', 'OFFLINE', 'ON_BREAK');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'API_TOKEN', 'SYSTEM', 'CRON');

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZoneTravelTime" (
    "fromZoneId" TEXT NOT NULL,
    "toZoneId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,

    CONSTRAINT "ZoneTravelTime_pkey" PRIMARY KEY ("fromZoneId","toZoneId")
);

-- CreateTable
CREATE TABLE "Rider" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "availability" "RiderAvailability" NOT NULL DEFAULT 'OFFLINE',
    "currentZoneId" TEXT NOT NULL,
    "capacityUnits" INTEGER NOT NULL,
    "reservedUnits" INTEGER NOT NULL DEFAULT 0,
    "activeJobCount" INTEGER NOT NULL DEFAULT 0,
    "maxActiveJobs" INTEGER NOT NULL DEFAULT 3,
    "offersReceived" INTEGER NOT NULL DEFAULT 0,
    "offersAccepted" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderZone" (
    "riderId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,

    CONSTRAINT "RiderZone_pkey" PRIMARY KEY ("riderId","zoneId")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL,
    "pickupZoneId" TEXT NOT NULL,
    "dropZoneId" TEXT NOT NULL,
    "loadUnits" INTEGER NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "deadlineAt" TIMESTAMP(3),
    "customerName" TEXT,
    "notes" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'NEW',
    "manualQueueReason" TEXT,
    "manualQueuedAt" TIMESTAMP(3),
    "currentAssignmentId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "reservedUnits" INTEGER NOT NULL,
    "offeredAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "recommendedRiderId" TEXT,
    "score" DOUBLE PRECISION,
    "assignedByType" "ActorType" NOT NULL,
    "assignedById" TEXT,
    "assignedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" "JobStatus",
    "toStatus" "JobStatus",
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "assignmentId" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "topRiderId" TEXT,
    "candidates" JSONB NOT NULL,
    "ai" JSONB,
    "aiModel" TEXT,
    "aiLatencyMs" INTEGER,
    "usedFallback" BOOLEAN NOT NULL DEFAULT false,
    "fallbackReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "confirmationTimeoutSeconds" INTEGER NOT NULL DEFAULT 7200,
    "clockOffsetSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastSweepAt" TIMESTAMP(3),
    "lastSweepSource" TEXT,
    "lastSweepExpired" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "riderId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rider_code_key" ON "Rider"("code");

-- CreateIndex
CREATE INDEX "Rider_availability_idx" ON "Rider"("availability");

-- CreateIndex
CREATE INDEX "RiderZone_zoneId_idx" ON "RiderZone"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_reference_key" ON "Job"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Job_idempotencyKey_key" ON "Job"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Job_currentAssignmentId_key" ON "Job"("currentAssignmentId");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_status_pickupZoneId_idx" ON "Job"("status", "pickupZoneId");

-- CreateIndex
CREATE INDEX "Job_status_manualQueuedAt_idx" ON "Job"("status", "manualQueuedAt");

-- CreateIndex
CREATE INDEX "Assignment_jobId_createdAt_idx" ON "Assignment"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "Assignment_riderId_status_idx" ON "Assignment"("riderId", "status");

-- CreateIndex
CREATE INDEX "Assignment_status_expiresAt_idx" ON "Assignment"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "JobEvent_jobId_id_idx" ON "JobEvent"("jobId", "id");

-- CreateIndex
CREATE INDEX "JobEvent_type_createdAt_idx" ON "JobEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_jobId_createdAt_idx" ON "Recommendation"("jobId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_riderId_key" ON "User"("riderId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- CreateIndex
CREATE INDEX "LoginAttempt_key_createdAt_idx" ON "LoginAttempt"("key", "createdAt");

-- AddForeignKey
ALTER TABLE "RiderZone" ADD CONSTRAINT "RiderZone_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderZone" ADD CONSTRAINT "RiderZone_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Business-rule guards that Prisma's schema language cannot express.
ALTER TABLE "Rider" ADD CONSTRAINT "rider_capacity_bounds"
  CHECK ("reservedUnits" >= 0 AND "reservedUnits" <= "capacityUnits" AND "capacityUnits" > 0);
ALTER TABLE "Rider" ADD CONSTRAINT "rider_active_jobs_bounds"
  CHECK ("activeJobCount" >= 0 AND "maxActiveJobs" > 0);
ALTER TABLE "Job" ADD CONSTRAINT "job_load_positive" CHECK ("loadUnits" > 0);
ALTER TABLE "Assignment" ADD CONSTRAINT "assignment_reserved_positive" CHECK ("reservedUnits" > 0);

-- A job can never have more than one live (pending or accepted) assignment.
CREATE UNIQUE INDEX "assignment_one_live_per_job"
  ON "Assignment" ("jobId") WHERE "status" IN ('PENDING', 'ACCEPTED');

-- Sweeper lookup: only pending rows are ever scanned for expiry.
CREATE INDEX "assignment_pending_expiry" ON "Assignment" ("expiresAt") WHERE "status" = 'PENDING';
