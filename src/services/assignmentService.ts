import type { Assignment, Job } from "@prisma/client";
import { AppError, notFound } from "@/domain/errors";
import { assertTransition, isAssignable } from "@/domain/jobStateMachine";
import type { Actor } from "@/domain/types";
import { isUniqueViolation, prisma, transaction, type Tx } from "@/lib/db";
import type { AssignInput } from "@/lib/schemas";
import { getClock } from "@/lib/settings";
import { moveToManualQueueLocked } from "./jobService";
import { rankForJob } from "./rankingContext";
import {
  assertCanActForRider,
  lockJob,
  recordEvent,
  releaseRiderCapacity,
  reserveRiderCapacity,
  resolveJobId,
} from "./shared";
import { sweepJobLocked } from "./timeoutService";

const RECOMMENDATION_FRESH_MS = 30 * 60 * 1000;

/** What the dispatcher was shown: the latest stored recommendation, else the live score ranking. */
async function currentRecommendedRiderId(tx: Tx, job: Job, eligibleIds: string[]): Promise<string | null> {
  const latest = await tx.recommendation.findFirst({
    where: { jobId: job.id },
    orderBy: { createdAt: "desc" },
  });
  if (
    latest?.topRiderId &&
    eligibleIds.includes(latest.topRiderId) &&
    Date.now() - latest.createdAt.getTime() < RECOMMENDATION_FRESH_MS
  ) {
    return latest.topRiderId;
  }
  return eligibleIds[0] ?? null;
}

export interface AssignResult {
  job: Job;
  assignment: Assignment;
  isOverride: boolean;
}

/**
 * Assigns or reassigns a rider. Serialised per job by the job row lock; the conditional
 * capacity update and the one-live-assignment partial unique index are the backstops.
 */
export async function assignRider(idOrReference: string, input: AssignInput, actor: Actor): Promise<AssignResult> {
  const jobId = await resolveJobId(prisma, idOrReference);
  const { now, settings } = await getClock();

  try {
    return await transaction(async (tx) => {
      const locked = await lockJob(tx, jobId);
      const { job } = await sweepJobLocked(tx, locked, now);

      if (input.expectedVersion !== undefined && job.version !== input.expectedVersion) {
        throw new AppError("STALE_VERSION", "The job changed since you loaded it. Refresh and try again.", {
          expectedVersion: input.expectedVersion,
          currentVersion: job.version,
          status: job.status,
        });
      }
      if (job.status === "AWAITING_CONFIRMATION" || job.status === "ACCEPTED") {
        throw new AppError("CONFLICT", "Job already has an active assignment", {
          status: job.status,
          currentAssignmentId: job.currentAssignmentId,
        });
      }
      if (!isAssignable(job.status)) {
        throw new AppError("INVALID_TRANSITION", `A job in ${job.status} cannot be assigned`, { status: job.status });
      }

      const ranking = await rankForJob(tx, job, now);
      const candidate = ranking.eligible.find((c) => c.riderId === input.riderId);
      if (!candidate) {
        const rider = await tx.rider.findUnique({ where: { id: input.riderId }, select: { id: true } });
        if (!rider) throw notFound("Rider", input.riderId);
        const why = ranking.ineligible.find((r) => r.riderId === input.riderId);
        throw new AppError("RIDER_NOT_ELIGIBLE", "This rider cannot take the job", {
          riderId: input.riderId,
          reasons: why?.reasons ?? [],
        });
      }

      const recommendedRiderId = await currentRecommendedRiderId(
        tx,
        job,
        ranking.eligible.map((c) => c.riderId),
      );
      const isOverride = recommendedRiderId !== null && recommendedRiderId !== input.riderId;
      const overrideReason = input.overrideReason?.trim() || null;
      if (isOverride && (!overrideReason || overrideReason.length < 3)) {
        throw new AppError(
          "OVERRIDE_REASON_REQUIRED",
          "Choosing a rider other than the recommended one requires a reason",
          { recommendedRiderId },
        );
      }

      const reserved = await reserveRiderCapacity(tx, input.riderId, job.loadUnits);
      if (!reserved) {
        throw new AppError("RIDER_CAPACITY_CONFLICT", "Rider no longer has capacity for this job", {
          riderId: input.riderId,
        });
      }

      const previousAttempts = await tx.assignment.count({ where: { jobId } });
      const assignment = await tx.assignment.create({
        data: {
          jobId,
          riderId: input.riderId,
          status: "PENDING",
          reservedUnits: job.loadUnits,
          offeredAt: now,
          expiresAt: new Date(now.getTime() + settings.confirmationTimeoutSeconds * 1000),
          isOverride,
          overrideReason: isOverride ? overrideReason : null,
          recommendedRiderId,
          score: candidate.score,
          assignedByType: actor.type,
          assignedById: actor.id ?? null,
          assignedByName: actor.name ?? null,
          createdAt: now,
        },
      });

      assertTransition(job.status, "AWAITING_CONFIRMATION");
      const updated = await tx.job.update({
        where: { id: jobId },
        data: {
          status: "AWAITING_CONFIRMATION",
          currentAssignmentId: assignment.id,
          manualQueueReason: null,
          version: { increment: 1 },
        },
      });

      await recordEvent(tx, {
        jobId,
        type: previousAttempts > 0 ? "RIDER_REASSIGNED" : "RIDER_ASSIGNED",
        actor,
        at: now,
        fromStatus: job.status,
        toStatus: "AWAITING_CONFIRMATION",
        assignmentId: assignment.id,
        details: {
          riderId: candidate.riderId,
          riderCode: candidate.code,
          riderName: candidate.name,
          score: candidate.score,
          rank: candidate.rank,
          reasons: candidate.reasons,
          attempt: previousAttempts + 1,
          expiresAt: assignment.expiresAt.toISOString(),
          timeoutSeconds: settings.confirmationTimeoutSeconds,
          reservedUnits: job.loadUnits,
        },
      });
      if (isOverride) {
        await recordEvent(tx, {
          jobId,
          type: "MANUAL_OVERRIDE",
          actor,
          at: now,
          assignmentId: assignment.id,
          details: { recommendedRiderId, chosenRiderId: candidate.riderId, reason: overrideReason },
        });
      }
      return { job: updated, assignment, isOverride };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError("CONFLICT", "Another dispatcher assigned this job at the same time");
    }
    throw err;
  }
}

async function loadAssignment(assignmentId: string): Promise<Assignment> {
  const a = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!a) throw notFound("Assignment", assignmentId);
  return a;
}

type RespondOutcome = { kind: "ok"; job: Job; assignment: Assignment } | { kind: "expired"; expiresAt: Date };

/**
 * Shared accept/reject path. The job lock plus the targeted sweep means a response that arrives
 * after the deadline commits the timeout first and then reports ASSIGNMENT_EXPIRED.
 */
async function respond(
  assignmentId: string,
  actor: Actor,
  handle: (tx: Tx, job: Job, assignment: Assignment, now: Date) => Promise<{ job: Job; assignment: Assignment }>,
) {
  const initial = await loadAssignment(assignmentId);
  assertCanActForRider(actor, initial.riderId);
  const { now } = await getClock();

  const outcome = await transaction<RespondOutcome>(async (tx) => {
    const locked = await lockJob(tx, initial.jobId);
    const { job, expiredAssignmentId } = await sweepJobLocked(tx, locked, now);
    if (expiredAssignmentId === assignmentId) return { kind: "expired", expiresAt: initial.expiresAt };

    const assignment = await tx.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    if (assignment.status === "EXPIRED") return { kind: "expired", expiresAt: assignment.expiresAt };
    if (assignment.status !== "PENDING" || job.currentAssignmentId !== assignment.id) {
      throw new AppError("ASSIGNMENT_NOT_PENDING", `Assignment is already ${assignment.status}`, {
        status: assignment.status,
        jobStatus: job.status,
      });
    }
    return { kind: "ok", ...(await handle(tx, job, assignment, now)) };
  });

  if (outcome.kind === "expired") {
    throw new AppError("ASSIGNMENT_EXPIRED", "The confirmation window closed; the job moved to the Manual Queue", {
      expiresAt: outcome.expiresAt.toISOString(),
    });
  }
  return { job: outcome.job, assignment: outcome.assignment };
}

export function acceptAssignment(assignmentId: string, actor: Actor) {
  return respond(assignmentId, actor, async (tx, job, assignment, now) => {
    assertTransition(job.status, "ACCEPTED");
    const accepted = await tx.assignment.update({
      where: { id: assignment.id },
      data: { status: "ACCEPTED", respondedAt: now },
    });
    await tx.rider.update({ where: { id: assignment.riderId }, data: { offersAccepted: { increment: 1 } } });
    const updated = await tx.job.update({
      where: { id: job.id },
      data: { status: "ACCEPTED", version: { increment: 1 } },
    });
    await recordEvent(tx, {
      jobId: job.id,
      type: "RIDER_CONFIRMED",
      actor,
      at: now,
      fromStatus: job.status,
      toStatus: "ACCEPTED",
      assignmentId: assignment.id,
      details: {
        riderId: assignment.riderId,
        responseSeconds: Math.round((now.getTime() - assignment.offeredAt.getTime()) / 1000),
      },
    });
    return { job: updated, assignment: accepted };
  });
}

/**
 * Rejection frees the rider's capacity and sends the job to the Manual Queue. The rejecting
 * rider is excluded from future recommendations for this job.
 */
export function rejectAssignment(assignmentId: string, reason: string, actor: Actor) {
  return respond(assignmentId, actor, async (tx, job, assignment, now) => {
    const rejected = await tx.assignment.update({
      where: { id: assignment.id },
      data: { status: "REJECTED", respondedAt: now, endedAt: now, endReason: reason },
    });
    await releaseRiderCapacity(tx, assignment.riderId, assignment.reservedUnits);
    await recordEvent(tx, {
      jobId: job.id,
      type: "RIDER_REJECTED",
      actor,
      at: now,
      assignmentId: assignment.id,
      details: { riderId: assignment.riderId, reason, releasedUnits: assignment.reservedUnits },
    });
    const updated = await moveToManualQueueLocked(tx, job, now, "RIDER_REJECTED", actor, {
      message: `Rider rejected: ${reason}`,
    });
    return { job: updated, assignment: rejected };
  });
}

/** Dispatcher takes an accepted (not yet picked up) job away from its rider. */
export async function releaseAssignment(idOrReference: string, reason: string, actor: Actor) {
  const jobId = await resolveJobId(prisma, idOrReference);
  const { now } = await getClock();
  return transaction(async (tx) => {
    const locked = await lockJob(tx, jobId);
    const { job } = await sweepJobLocked(tx, locked, now);
    if (job.status !== "ACCEPTED" && job.status !== "AWAITING_CONFIRMATION") {
      throw new AppError("INVALID_TRANSITION", `Cannot release a rider from a job in ${job.status}`);
    }
    const live = await tx.assignment.findFirstOrThrow({
      where: { jobId, status: { in: ["PENDING", "ACCEPTED"] } },
    });
    await tx.assignment.update({
      where: { id: live.id },
      data: { status: "CANCELLED", endedAt: now, endReason: `RELEASED: ${reason}` },
    });
    await releaseRiderCapacity(tx, live.riderId, live.reservedUnits);
    await recordEvent(tx, {
      jobId,
      type: "ASSIGNMENT_RELEASED",
      actor,
      at: now,
      assignmentId: live.id,
      details: { riderId: live.riderId, reason, releasedUnits: live.reservedUnits },
    });
    return moveToManualQueueLocked(tx, job, now, "RELEASED_BY_DISPATCHER", actor, { message: reason });
  });
}
