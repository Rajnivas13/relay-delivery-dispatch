import type { Job, Prisma } from "@prisma/client";
import { AppError, notFound } from "@/domain/errors";
import type { Actor, EventType, JobStatus } from "@/domain/types";
import type { Db, Tx } from "@/lib/db";

/** Row lock on the job. Every write path locks the job first, then assignment, then rider. */
export async function lockJob(tx: Tx, jobId: string): Promise<Job> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Job" WHERE id = ${jobId} FOR UPDATE`;
  if (rows.length === 0) throw notFound("Job", jobId);
  return tx.job.findUniqueOrThrow({ where: { id: jobId } });
}

/** Non-blocking variant for the sweeper: if someone else holds the job, they will sweep it. */
export async function tryLockJob(tx: Tx, jobId: string): Promise<Job | null> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "Job" WHERE id = ${jobId} FOR UPDATE SKIP LOCKED`;
  if (rows.length === 0) return null;
  return tx.job.findUnique({ where: { id: jobId } });
}

export async function resolveJobId(db: Db, idOrReference: string): Promise<string> {
  const job = await db.job.findFirst({
    where: { OR: [{ id: idOrReference }, { reference: idOrReference }] },
    select: { id: true },
  });
  if (!job) throw notFound("Job", idOrReference);
  return job.id;
}

export interface EventInput {
  jobId: string;
  type: EventType;
  actor: Actor;
  at: Date;
  fromStatus?: JobStatus | null;
  toStatus?: JobStatus | null;
  assignmentId?: string | null;
  details?: Record<string, unknown>;
}

export async function recordEvent(tx: Tx, e: EventInput): Promise<void> {
  await tx.jobEvent.create({
    data: {
      jobId: e.jobId,
      type: e.type,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      actorType: e.actor.type,
      actorId: e.actor.id ?? null,
      actorName: e.actor.name ?? null,
      assignmentId: e.assignmentId ?? null,
      details: (e.details ?? {}) as Prisma.InputJsonValue,
      createdAt: e.at,
    },
  });
}

export async function releaseRiderCapacity(tx: Tx, riderId: string, units: number): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Rider"
       SET "reservedUnits" = GREATEST("reservedUnits" - ${units}, 0),
           "activeJobCount" = GREATEST("activeJobCount" - 1, 0),
           "version" = "version" + 1,
           "updatedAt" = NOW()
     WHERE id = ${riderId}`;
}

/**
 * Atomically reserves capacity. The WHERE clause re-checks every capacity rule so two
 * concurrent assignments to the same rider cannot both succeed.
 */
export async function reserveRiderCapacity(tx: Tx, riderId: string, units: number): Promise<boolean> {
  const updated = await tx.$executeRaw`
    UPDATE "Rider"
       SET "reservedUnits" = "reservedUnits" + ${units},
           "activeJobCount" = "activeJobCount" + 1,
           "offersReceived" = "offersReceived" + 1,
           "version" = "version" + 1,
           "updatedAt" = NOW()
     WHERE id = ${riderId}
       AND "availability" = 'ONLINE'
       AND "capacityUnits" - "reservedUnits" >= ${units}
       AND "activeJobCount" < "maxActiveJobs"`;
  return updated === 1;
}

/** Riders may only act on their own assignments; dispatchers and admins may act for anyone. */
export function assertCanActForRider(actor: Actor, riderId: string): void {
  if (actor.type === "SYSTEM" || actor.type === "CRON") return;
  if (actor.role === "ADMIN" || actor.role === "DISPATCHER") return;
  if (actor.role === "RIDER" && actor.riderId === riderId) return;
  throw new AppError("FORBIDDEN", "You can only act on assignments offered to you");
}

export function actorLabel(actor: Actor): string {
  return actor.name ?? actor.type.toLowerCase();
}
