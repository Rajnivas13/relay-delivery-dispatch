import type { Job } from "@prisma/client";
import type { JobSnapshot, RiderSnapshot } from "@/domain/eligibility";
import { makeTravelFn, rankRiders, type RankingResult, type TravelTimeFn } from "@/domain/scoring";
import type { Db } from "@/lib/db";

export function toJobSnapshot(job: Job): JobSnapshot {
  return {
    id: job.id,
    pickupZoneId: job.pickupZoneId,
    dropZoneId: job.dropZoneId,
    loadUnits: job.loadUnits,
    priority: job.priority,
    deadlineAt: job.deadlineAt,
  };
}

export async function loadTravelFn(db: Db): Promise<TravelTimeFn> {
  return makeTravelFn(await db.zoneTravelTime.findMany());
}

export async function loadRiderSnapshots(db: Db): Promise<RiderSnapshot[]> {
  const riders = await db.rider.findMany({ include: { zones: { select: { zoneId: true } } } });
  return riders.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    availability: r.availability,
    currentZoneId: r.currentZoneId,
    zoneIds: r.zones.map((z) => z.zoneId),
    capacityUnits: r.capacityUnits,
    reservedUnits: r.reservedUnits,
    activeJobCount: r.activeJobCount,
    maxActiveJobs: r.maxActiveJobs,
    offersReceived: r.offersReceived,
    offersAccepted: r.offersAccepted,
  }));
}

/** Loads riders, travel data and this job's past attempts, then ranks with the pure domain scorer. */
export async function rankForJob(db: Db, job: Job, now: Date): Promise<RankingResult> {
  const riders = await loadRiderSnapshots(db);
  const travel = await loadTravelFn(db);
  const past = await db.assignment.findMany({
    where: { jobId: job.id, status: { in: ["REJECTED", "EXPIRED"] } },
    select: { riderId: true, status: true },
  });
  return rankRiders(riders, toJobSnapshot(job), travel, now, {
    rejectedRiderIds: new Set(past.filter((p) => p.status === "REJECTED").map((p) => p.riderId)),
    expiredRiderIds: new Set(past.filter((p) => p.status === "EXPIRED").map((p) => p.riderId)),
  });
}
