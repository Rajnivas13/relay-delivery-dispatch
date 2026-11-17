import { createHash, randomBytes } from "node:crypto";
import type { Job, Prisma } from "@prisma/client";
import { AppError, notFound } from "@/domain/errors";
import { assertTransition } from "@/domain/jobStateMachine";
import { SYSTEM_ACTOR, type Actor, type JobStatus } from "@/domain/types";
import { isUniqueViolation, prisma, transaction, type Tx } from "@/lib/db";
import type { CreateJobInput, JobListQuery } from "@/lib/schemas";
import { getClock, getNow } from "@/lib/settings";
import { rankForJob } from "./rankingContext";
import {
  assertCanActForRider,
  lockJob,
  recordEvent,
  releaseRiderCapacity,
  resolveJobId,
} from "./shared";
import { sweepJobLocked } from "./timeoutService";

export function generateReference(now: Date): string {
  const d = now.toISOString().slice(2, 10).replace(/-/g, "");
  return `ORD-${d}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/** Hash of the client-supplied fields only, so a retried request matches its original. */
export function hashJobRequest(input: CreateJobInput): string {
  const normalized = {
    reference: input.reference ?? null,
    pickupZoneId: input.pickupZoneId,
    dropZoneId: input.dropZoneId,
    loadUnits: input.loadUnits,
    priority: input.priority ?? "NORMAL",
    deadlineAt: input.deadlineAt ? new Date(input.deadlineAt).toISOString() : null,
    customerName: input.customerName ?? null,
    notes: input.notes ?? null,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export interface CreateJobResult {
  job: Job;
  created: boolean;
}

async function findDuplicate(
  input: CreateJobInput,
  idempotencyKey: string | null,
  requestHash: string,
): Promise<Job | null> {
  if (idempotencyKey) {
    const byKey = await prisma.job.findUnique({ where: { idempotencyKey } });
    if (byKey) {
      if (byKey.requestHash !== requestHash) {
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "This Idempotency-Key was already used with a different request body",
          { jobId: byKey.id, reference: byKey.reference },
        );
      }
      return byKey;
    }
  }
  if (input.reference) {
    const byRef = await prisma.job.findUnique({ where: { reference: input.reference } });
    if (byRef) {
      if (byRef.requestHash !== requestHash) {
        throw new AppError("CONFLICT", `Job reference '${input.reference}' already exists with different details`, {
          jobId: byRef.id,
        });
      }
      return byRef;
    }
  }
  return null;
}

/**
 * Creates a job exactly once. A retry with the same Idempotency-Key or reference and the same
 * body returns the original job; a different body is rejected. Unique constraints back this up
 * when two identical requests race.
 */
export async function createJob(
  input: CreateJobInput,
  actor: Actor,
  idempotencyKey: string | null = null,
): Promise<CreateJobResult> {
  const requestHash = hashJobRequest(input);
  const existing = await findDuplicate(input, idempotencyKey, requestHash);
  if (existing) return { job: existing, created: false };

  const zones = await prisma.zone.findMany({
    where: { id: { in: [input.pickupZoneId, input.dropZoneId] } },
    select: { id: true },
  });
  const known = new Set(zones.map((z) => z.id));
  const unknown = [input.pickupZoneId, input.dropZoneId].filter((z) => !known.has(z));
  if (unknown.length) {
    throw new AppError("VALIDATION_ERROR", `Unknown zone(s): ${[...new Set(unknown)].join(", ")}`, {
      fields: { pickupZoneId: input.pickupZoneId, dropZoneId: input.dropZoneId },
    });
  }

  const now = await getNow();
  if (input.deadlineAt && new Date(input.deadlineAt) <= now) {
    throw new AppError("VALIDATION_ERROR", "Delivery deadline must be in the future", {
      fields: { deadlineAt: input.deadlineAt },
    });
  }

  try {
    const job = await transaction(async (tx) => {
      const created = await tx.job.create({
        data: {
          reference: input.reference ?? generateReference(now),
          idempotencyKey,
          requestHash,
          pickupZoneId: input.pickupZoneId,
          dropZoneId: input.dropZoneId,
          loadUnits: input.loadUnits,
          priority: input.priority ?? "NORMAL",
          deadlineAt: input.deadlineAt ? new Date(input.deadlineAt) : null,
          customerName: input.customerName,
          notes: input.notes,
          status: "NEW",
          createdById: actor.id ?? null,
          createdAt: now,
        },
      });
      await recordEvent(tx, {
        jobId: created.id,
        type: "JOB_CREATED",
        actor,
        at: now,
        toStatus: "NEW",
        details: {
          reference: created.reference,
          pickupZoneId: created.pickupZoneId,
          dropZoneId: created.dropZoneId,
          loadUnits: created.loadUnits,
          priority: created.priority,
          deadlineAt: created.deadlineAt?.toISOString() ?? null,
          idempotencyKey,
        },
      });
      return triageNewJob(tx, created, now);
    });
    return { job, created: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raced = await findDuplicate(input, idempotencyKey, requestHash);
      if (raced) return { job: raced, created: false };
    }
    throw err;
  }
}

/** NEW -> READY_FOR_ASSIGNMENT, and straight on to the Manual Queue if nobody can take it. */
async function triageNewJob(tx: Tx, job: Job, now: Date): Promise<Job> {
  assertTransition(job.status, "READY_FOR_ASSIGNMENT");
  let current = await tx.job.update({
    where: { id: job.id },
    data: { status: "READY_FOR_ASSIGNMENT", version: { increment: 1 } },
  });
  const ranking = await rankForJob(tx, current, now);
  await recordEvent(tx, {
    jobId: job.id,
    type: "STATUS_CHANGED",
    actor: SYSTEM_ACTOR,
    at: now,
    fromStatus: "NEW",
    toStatus: "READY_FOR_ASSIGNMENT",
    details: { eligibleRiders: ranking.eligible.length },
  });
  if (ranking.eligible.length === 0) {
    current = await moveToManualQueueLocked(tx, current, now, "NO_ELIGIBLE_RIDER", SYSTEM_ACTOR, {
      message: "No rider can currently service this job",
      ineligible: ranking.ineligible.slice(0, 10).map((r) => ({ code: r.code, reasons: r.reasons })),
    });
  }
  return current;
}

export async function moveToManualQueueLocked(
  tx: Tx,
  job: Job,
  now: Date,
  reason: string,
  actor: Actor,
  details: Record<string, unknown> = {},
): Promise<Job> {
  assertTransition(job.status, "MANUAL_QUEUE");
  const updated = await tx.job.update({
    where: { id: job.id },
    data: {
      status: "MANUAL_QUEUE",
      manualQueueReason: reason,
      manualQueuedAt: now,
      currentAssignmentId: null,
      version: { increment: 1 },
    },
  });
  await recordEvent(tx, {
    jobId: job.id,
    type: "MOVED_TO_MANUAL_QUEUE",
    actor,
    at: now,
    fromStatus: job.status,
    toStatus: "MANUAL_QUEUE",
    details: { reason, ...details },
  });
  return updated;
}

const jobInclude = {
  assignments: {
    orderBy: { createdAt: "desc" },
    include: { rider: { select: { id: true, code: true, name: true, phone: true } } },
  },
} satisfies Prisma.JobInclude;

export type JobWithAssignments = Prisma.JobGetPayload<{ include: typeof jobInclude }>;

export async function getJob(idOrReference: string) {
  const id = await resolveJobId(prisma, idOrReference);
  const job = await prisma.job.findUniqueOrThrow({ where: { id }, include: jobInclude });
  const current = job.assignments.find((a) => a.id === job.currentAssignmentId) ?? null;
  return { ...job, currentAssignment: current };
}

export async function getJobEvents(idOrReference: string) {
  const id = await resolveJobId(prisma, idOrReference);
  return prisma.jobEvent.findMany({ where: { jobId: id }, orderBy: { id: "asc" } });
}

export async function listJobs(query: JobListQuery) {
  const where: Prisma.JobWhereInput = {};
  if (query.status?.length) where.status = { in: query.status };
  if (query.priority) where.priority = query.priority;
  if (query.zone) where.OR = [{ pickupZoneId: query.zone }, { dropZoneId: query.zone }];
  if (query.q) {
    const q = { contains: query.q, mode: "insensitive" as const };
    where.AND = [{ OR: [{ reference: q }, { id: query.q }, { customerName: q }] }];
  }
  const [total, items] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        assignments: {
          where: { status: { in: ["PENDING", "ACCEPTED", "COMPLETED"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { rider: { select: { id: true, code: true, name: true } } },
        },
      },
    }),
  ]);
  return {
    items: items.map(({ assignments, ...job }) => ({ ...job, latestAssignment: assignments[0] ?? null })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

async function loadLockedWithSweep(tx: Tx, jobId: string, now: Date) {
  const locked = await lockJob(tx, jobId);
  return (await sweepJobLocked(tx, locked, now)).job;
}

function assertExpectedVersion(job: Job, expectedVersion?: number) {
  if (expectedVersion !== undefined && job.version !== expectedVersion) {
    throw new AppError("STALE_VERSION", "The job changed since you loaded it. Refresh and try again.", {
      expectedVersion,
      currentVersion: job.version,
      status: job.status,
    });
  }
}

export async function cancelJob(idOrReference: string, reason: string, actor: Actor, expectedVersion?: number) {
  const jobId = await resolveJobId(prisma, idOrReference);
  const { now } = await getClock();
  return transaction(async (tx) => {
    const job = await loadLockedWithSweep(tx, jobId, now);
    assertExpectedVersion(job, expectedVersion);
    assertTransition(job.status, "CANCELLED");

    const live = await tx.assignment.findFirst({
      where: { jobId, status: { in: ["PENDING", "ACCEPTED"] } },
    });
    if (live) {
      await tx.assignment.update({
        where: { id: live.id },
        data: { status: "CANCELLED", endedAt: now, endReason: "JOB_CANCELLED" },
      });
      await releaseRiderCapacity(tx, live.riderId, live.reservedUnits);
    }
    const updated = await tx.job.update({
      where: { id: jobId },
      data: { status: "CANCELLED", currentAssignmentId: null, manualQueueReason: null, version: { increment: 1 } },
    });
    await recordEvent(tx, {
      jobId,
      type: "CANCELLED",
      actor,
      at: now,
      fromStatus: job.status,
      toStatus: "CANCELLED",
      assignmentId: live?.id,
      details: { reason, releasedRiderId: live?.riderId ?? null, releasedUnits: live?.reservedUnits ?? 0 },
    });
    return updated;
  });
}

async function advanceDelivery(
  idOrReference: string,
  actor: Actor,
  to: Extract<JobStatus, "PICKED_UP" | "DELIVERED">,
) {
  const jobId = await resolveJobId(prisma, idOrReference);
  const { now } = await getClock();
  return transaction(async (tx) => {
    const job = await loadLockedWithSweep(tx, jobId, now);
    assertTransition(job.status, to);
    if (!job.currentAssignmentId) throw new AppError("CONFLICT", "Job has no active assignment");
    const assignment = await tx.assignment.findUniqueOrThrow({ where: { id: job.currentAssignmentId } });
    if (assignment.status !== "ACCEPTED") {
      throw new AppError("CONFLICT", `Assignment is ${assignment.status}, expected ACCEPTED`);
    }
    assertCanActForRider(actor, assignment.riderId);

    if (to === "PICKED_UP") {
      await tx.rider.update({ where: { id: assignment.riderId }, data: { currentZoneId: job.pickupZoneId } });
    } else {
      await tx.assignment.update({
        where: { id: assignment.id },
        data: { status: "COMPLETED", endedAt: now, endReason: "DELIVERED" },
      });
      await releaseRiderCapacity(tx, assignment.riderId, assignment.reservedUnits);
      await tx.rider.update({ where: { id: assignment.riderId }, data: { currentZoneId: job.dropZoneId } });
    }

    const updated = await tx.job.update({
      where: { id: jobId },
      data: {
        status: to,
        version: { increment: 1 },
        ...(to === "DELIVERED" ? { currentAssignmentId: null } : {}),
      },
    });
    await recordEvent(tx, {
      jobId,
      type: to,
      actor,
      at: now,
      fromStatus: job.status,
      toStatus: to,
      assignmentId: assignment.id,
      details: {
        riderId: assignment.riderId,
        ...(to === "DELIVERED"
          ? {
              releasedUnits: assignment.reservedUnits,
              onTime: job.deadlineAt ? now <= job.deadlineAt : null,
            }
          : {}),
      },
    });
    return updated;
  });
}

export const markPickedUp = (id: string, actor: Actor) => advanceDelivery(id, actor, "PICKED_UP");
export const markDelivered = (id: string, actor: Actor) => advanceDelivery(id, actor, "DELIVERED");

export async function listManualQueue() {
  const jobs = await prisma.job.findMany({
    where: { status: "MANUAL_QUEUE" },
    orderBy: [{ manualQueuedAt: "asc" }],
    include: {
      assignments: {
        orderBy: { createdAt: "desc" },
        include: { rider: { select: { id: true, code: true, name: true } } },
      },
    },
  });
  const { now } = await getClock();
  return jobs.map(({ assignments, ...job }) => ({
    ...job,
    attempts: assignments.length,
    lastAssignment: assignments[0] ?? null,
    waitingSeconds: job.manualQueuedAt ? Math.max(0, Math.round((now.getTime() - job.manualQueuedAt.getTime()) / 1000)) : 0,
  }));
}

export async function getJobOrThrow(id: string): Promise<Job> {
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) throw notFound("Job", id);
  return job;
}
