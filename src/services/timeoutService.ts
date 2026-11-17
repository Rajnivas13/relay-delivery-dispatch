import type { Assignment, Job } from "@prisma/client";
import { assertTransition } from "@/domain/jobStateMachine";
import { SYSTEM_ACTOR, type Actor } from "@/domain/types";
import { prisma, transaction, type Tx } from "@/lib/db";
import { getClock } from "@/lib/settings";
import { recordEvent, releaseRiderCapacity, tryLockJob } from "./shared";

export type SweepSource = "lazy" | "cron" | "manual" | "targeted";

/** Expires one assignment. Caller must hold the job lock and have checked it is still PENDING. */
async function expireLocked(tx: Tx, job: Job, assignment: Assignment, now: Date, actor: Actor) {
  assertTransition(job.status, "MANUAL_QUEUE");
  const rider = await tx.rider.findUnique({ where: { id: assignment.riderId }, select: { code: true } });

  await tx.assignment.update({
    where: { id: assignment.id },
    data: { status: "EXPIRED", endedAt: now, endReason: "CONFIRMATION_TIMEOUT" },
  });
  await releaseRiderCapacity(tx, assignment.riderId, assignment.reservedUnits);
  await tx.job.update({
    where: { id: job.id },
    data: {
      status: "MANUAL_QUEUE",
      manualQueueReason: "CONFIRMATION_TIMEOUT",
      manualQueuedAt: now,
      currentAssignmentId: null,
      version: { increment: 1 },
    },
  });

  const waitedSeconds = Math.round((assignment.expiresAt.getTime() - assignment.offeredAt.getTime()) / 1000);
  await recordEvent(tx, {
    jobId: job.id,
    type: "ASSIGNMENT_TIMEOUT",
    actor,
    at: now,
    assignmentId: assignment.id,
    details: {
      riderId: assignment.riderId,
      riderCode: rider?.code,
      offeredAt: assignment.offeredAt.toISOString(),
      expiresAt: assignment.expiresAt.toISOString(),
      thresholdSeconds: waitedSeconds,
      releasedUnits: assignment.reservedUnits,
    },
  });
  await recordEvent(tx, {
    jobId: job.id,
    type: "MOVED_TO_MANUAL_QUEUE",
    actor,
    at: now,
    fromStatus: job.status,
    toStatus: "MANUAL_QUEUE",
    assignmentId: assignment.id,
    details: {
      reason: "CONFIRMATION_TIMEOUT",
      message: `Rider ${rider?.code ?? assignment.riderId} did not confirm before ${assignment.expiresAt.toISOString()}`,
    },
  });
}

/**
 * Expires the job's pending assignment if it is overdue. Must be called while holding the job
 * lock; write paths call this first so a late accept can never win against a due timeout.
 */
export async function sweepJobLocked(
  tx: Tx,
  job: Job,
  now: Date,
  actor: Actor = SYSTEM_ACTOR,
): Promise<{ job: Job; expiredAssignmentId: string | null }> {
  if (job.status !== "AWAITING_CONFIRMATION") return { job, expiredAssignmentId: null };
  const overdue = await tx.assignment.findFirst({
    where: { jobId: job.id, status: "PENDING", expiresAt: { lte: now } },
  });
  if (!overdue) return { job, expiredAssignmentId: null };

  await expireLocked(tx, job, overdue, now, actor);
  const refreshed = await tx.job.findUniqueOrThrow({ where: { id: job.id } });
  return { job: refreshed, expiredAssignmentId: overdue.id };
}

export interface SweepResult {
  checked: number;
  expired: number;
  skippedLocked: number;
  expiredAssignmentIds: string[];
  at: string;
  source: SweepSource;
}

/**
 * Global sweep used by Vercel Cron, the lazy hook and the admin button. Safe to run
 * concurrently: each job is claimed with SKIP LOCKED and re-checked under the lock, so an
 * assignment is expired exactly once.
 */
export async function expireOverdueAssignments(
  opts: { source: SweepSource; actor?: Actor; limit?: number; now?: Date } = { source: "manual" },
): Promise<SweepResult> {
  const { now: clockNow } = await getClock();
  const now = opts.now ?? clockNow;
  const actor = opts.actor ?? SYSTEM_ACTOR;

  const due = await prisma.assignment.findMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    select: { jobId: true },
    orderBy: { expiresAt: "asc" },
    take: opts.limit ?? 100,
  });

  const expiredAssignmentIds: string[] = [];
  let skippedLocked = 0;
  for (const { jobId } of due) {
    const outcome = await transaction(async (tx) => {
      const job = await tryLockJob(tx, jobId);
      if (!job) return "locked" as const;
      const res = await sweepJobLocked(tx, job, now, actor);
      return res.expiredAssignmentId;
    });
    if (outcome === "locked") skippedLocked++;
    else if (outcome) expiredAssignmentIds.push(outcome);
  }

  if (opts.source !== "lazy" || expiredAssignmentIds.length > 0) {
    await prisma.setting.upsert({
      where: { id: 1 },
      update: { lastSweepAt: now, lastSweepSource: opts.source, lastSweepExpired: expiredAssignmentIds.length },
      create: { id: 1, lastSweepAt: now, lastSweepSource: opts.source, lastSweepExpired: expiredAssignmentIds.length },
    });
  }

  return {
    checked: due.length,
    expired: expiredAssignmentIds.length,
    skippedLocked,
    expiredAssignmentIds,
    at: now.toISOString(),
    source: opts.source,
  };
}
