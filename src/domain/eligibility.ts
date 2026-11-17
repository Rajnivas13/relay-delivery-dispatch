import type { Priority, RiderAvailability } from "./types";

export interface RiderSnapshot {
  id: string;
  code: string;
  name: string;
  availability: RiderAvailability;
  currentZoneId: string;
  zoneIds: string[];
  capacityUnits: number;
  reservedUnits: number;
  activeJobCount: number;
  maxActiveJobs: number;
  offersReceived: number;
  offersAccepted: number;
}

export interface JobSnapshot {
  id?: string;
  pickupZoneId: string;
  dropZoneId: string;
  loadUnits: number;
  priority: Priority;
  deadlineAt: Date | null;
}

/** Per-job history that changes a rider's eligibility or score for that specific job. */
export interface JobRiderHistory {
  rejectedRiderIds: ReadonlySet<string>;
  expiredRiderIds: ReadonlySet<string>;
}

export const EMPTY_HISTORY: JobRiderHistory = {
  rejectedRiderIds: new Set(),
  expiredRiderIds: new Set(),
};

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export function freeUnits(rider: Pick<RiderSnapshot, "capacityUnits" | "reservedUnits">): number {
  return rider.capacityUnits - rider.reservedUnits;
}

/**
 * Hard rules. A rider failing any of these is never recommended and cannot be assigned,
 * including by a dispatcher override.
 */
export function checkEligibility(
  rider: RiderSnapshot,
  job: JobSnapshot,
  history: JobRiderHistory = EMPTY_HISTORY,
): EligibilityResult {
  const reasons: string[] = [];

  if (rider.availability !== "ONLINE") {
    reasons.push(`Rider is ${rider.availability.replace("_", " ").toLowerCase()}`);
  }
  if (!rider.zoneIds.includes(job.pickupZoneId)) {
    reasons.push(`Does not service pickup zone ${job.pickupZoneId}`);
  }
  if (!rider.zoneIds.includes(job.dropZoneId)) {
    reasons.push(`Does not service delivery zone ${job.dropZoneId}`);
  }
  const free = freeUnits(rider);
  if (free < job.loadUnits) {
    reasons.push(`Needs ${job.loadUnits} capacity units but only ${Math.max(free, 0)} free`);
  }
  if (rider.activeJobCount >= rider.maxActiveJobs) {
    reasons.push(`At active job limit (${rider.activeJobCount}/${rider.maxActiveJobs})`);
  }
  if (history.rejectedRiderIds.has(rider.id)) {
    reasons.push("Already rejected this job");
  }

  return { eligible: reasons.length === 0, reasons };
}
