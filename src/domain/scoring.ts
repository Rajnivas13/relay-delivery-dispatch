import {
  checkEligibility,
  EMPTY_HISTORY,
  freeUnits,
  type JobRiderHistory,
  type JobSnapshot,
  type RiderSnapshot,
} from "./eligibility";
import type { Priority } from "./types";

export type TravelTimeFn = (fromZoneId: string, toZoneId: string) => number;

export type FactorKey = "travel" | "capacity" | "workload" | "deadline" | "reliability";

export type Weights = Record<FactorKey, number>;

/** Weights sum to 100 so a score reads as "points out of 100". */
export const DEFAULT_WEIGHTS: Weights = {
  travel: 35,
  capacity: 20,
  workload: 20,
  deadline: 15,
  reliability: 10,
};

/** Urgent work cares more about getting there fast than about balancing load. */
export const URGENT_WEIGHTS: Weights = {
  travel: 45,
  capacity: 10,
  workload: 15,
  deadline: 20,
  reliability: 10,
};

export const MAX_USEFUL_TRAVEL_MINUTES = 60;
export const COMFORTABLE_SLACK_MINUTES = 60;
export const HANDLING_MINUTES = 5;
export const EXPIRED_OFFER_PENALTY = 10;

export function weightsFor(priority: Priority): Weights {
  return priority === "HIGH" || priority === "URGENT" ? URGENT_WEIGHTS : DEFAULT_WEIGHTS;
}

export interface ScoreFactor {
  key: FactorKey;
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface ScoredCandidate {
  riderId: string;
  code: string;
  name: string;
  rank: number;
  score: number;
  etaToPickupMinutes: number;
  etaTotalMinutes: number;
  freeUnitsAfter: number;
  activeJobs: number;
  maxActiveJobs: number;
  acceptProbability: number;
  breakdown: ScoreFactor[];
  reasons: string[];
  warnings: string[];
}

export interface IneligibleRider {
  riderId: string;
  code: string;
  name: string;
  reasons: string[];
}

export interface RankingResult {
  eligible: ScoredCandidate[];
  ineligible: IneligibleRider[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Laplace-smoothed so new riders start at 50% rather than 0% or 100%. */
export function acceptanceRate(rider: Pick<RiderSnapshot, "offersAccepted" | "offersReceived">): number {
  return (rider.offersAccepted + 1) / (rider.offersReceived + 2);
}

export function baselineAcceptProbability(rider: RiderSnapshot, previouslyExpired: boolean): number {
  const loadFactor = 1 - 0.15 * (rider.activeJobCount / Math.max(rider.maxActiveJobs, 1));
  const p = acceptanceRate(rider) * loadFactor - (previouslyExpired ? 0.2 : 0);
  return round1(clamp(p, 0.05, 0.99) * 100) / 100;
}

export function scoreRider(
  rider: RiderSnapshot,
  job: JobSnapshot,
  travel: TravelTimeFn,
  now: Date,
  history: JobRiderHistory = EMPTY_HISTORY,
): Omit<ScoredCandidate, "rank"> {
  const w = weightsFor(job.priority);
  const etaToPickup = travel(rider.currentZoneId, job.pickupZoneId);
  const etaTotal = etaToPickup + HANDLING_MINUTES + travel(job.pickupZoneId, job.dropZoneId);
  const freeAfter = freeUnits(rider) - job.loadUnits;
  const previouslyExpired = history.expiredRiderIds.has(rider.id);
  const warnings: string[] = [];

  const travelRatio = clamp(1 - etaToPickup / MAX_USEFUL_TRAVEL_MINUTES, 0, 1);
  const capacityRatio = clamp(freeAfter / rider.capacityUnits, 0, 1);
  const workloadRatio = clamp(1 - rider.activeJobCount / rider.maxActiveJobs, 0, 1);
  const rate = acceptanceRate(rider);

  let deadlineRatio = 1;
  let deadlineDetail = "No delivery deadline";
  if (job.deadlineAt) {
    const minutesLeft = (job.deadlineAt.getTime() - now.getTime()) / 60000;
    const slack = minutesLeft - etaTotal;
    if (slack < 0) {
      deadlineRatio = 0;
      deadlineDetail = `Likely to miss the deadline by ${Math.ceil(-slack)} min`;
      warnings.push(deadlineDetail);
    } else {
      deadlineRatio = clamp(slack / COMFORTABLE_SLACK_MINUTES, 0, 1);
      deadlineDetail = `${Math.floor(slack)} min of slack before the deadline`;
    }
  }

  const breakdown: ScoreFactor[] = [
    {
      key: "travel",
      label: "Travel time",
      points: round1(w.travel * travelRatio),
      max: w.travel,
      detail: `${etaToPickup} min to pickup from ${rider.currentZoneId}`,
    },
    {
      key: "capacity",
      label: "Spare capacity",
      points: round1(w.capacity * capacityRatio),
      max: w.capacity,
      detail: `${freeAfter}/${rider.capacityUnits} units free after this job`,
    },
    {
      key: "workload",
      label: "Workload",
      points: round1(w.workload * workloadRatio),
      max: w.workload,
      detail: `${rider.activeJobCount}/${rider.maxActiveJobs} active jobs`,
    },
    {
      key: "deadline",
      label: "Deadline fit",
      points: round1(w.deadline * deadlineRatio),
      max: w.deadline,
      detail: deadlineDetail,
    },
    {
      key: "reliability",
      label: "Reliability",
      points: round1(w.reliability * rate),
      max: w.reliability,
      detail: `${Math.round(rate * 100)}% historical acceptance (${rider.offersAccepted}/${rider.offersReceived})`,
    },
  ];

  let score = breakdown.reduce((sum, f) => sum + f.points, 0);
  if (previouslyExpired) {
    score -= EXPIRED_OFFER_PENALTY;
    warnings.push(`Let an earlier offer for this job expire (-${EXPIRED_OFFER_PENALTY})`);
  }

  const reasons = [...breakdown]
    .sort((a, b) => b.points / b.max - a.points / a.max)
    .slice(0, 3)
    .map((f) => f.detail);

  return {
    riderId: rider.id,
    code: rider.code,
    name: rider.name,
    score: round1(clamp(score, 0, 100)),
    etaToPickupMinutes: etaToPickup,
    etaTotalMinutes: etaTotal,
    freeUnitsAfter: freeAfter,
    activeJobs: rider.activeJobCount,
    maxActiveJobs: rider.maxActiveJobs,
    acceptProbability: baselineAcceptProbability(rider, previouslyExpired),
    breakdown,
    reasons,
    warnings,
  };
}

/**
 * Filters out ineligible riders, scores the rest and orders them deterministically:
 * score desc, then ETA to pickup asc, then rider code asc.
 */
export function rankRiders(
  riders: RiderSnapshot[],
  job: JobSnapshot,
  travel: TravelTimeFn,
  now: Date,
  history: JobRiderHistory = EMPTY_HISTORY,
): RankingResult {
  const ineligible: IneligibleRider[] = [];
  const scored: Omit<ScoredCandidate, "rank">[] = [];

  for (const rider of riders) {
    const check = checkEligibility(rider, job, history);
    if (!check.eligible) {
      ineligible.push({ riderId: rider.id, code: rider.code, name: rider.name, reasons: check.reasons });
      continue;
    }
    scored.push(scoreRider(rider, job, travel, now, history));
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.etaToPickupMinutes - b.etaToPickupMinutes ||
      a.code.localeCompare(b.code),
  );

  return {
    eligible: scored.map((c, i) => ({ ...c, rank: i + 1 })),
    ineligible: ineligible.sort((a, b) => a.code.localeCompare(b.code)),
  };
}

export function makeTravelFn(
  matrix: { fromZoneId: string; toZoneId: string; minutes: number }[],
  sameZoneMinutes = 8,
  unknownMinutes = 45,
): TravelTimeFn {
  const map = new Map(matrix.map((m) => [`${m.fromZoneId}|${m.toZoneId}`, m.minutes]));
  return (from, to) => {
    const direct = map.get(`${from}|${to}`) ?? map.get(`${to}|${from}`);
    if (direct !== undefined) return direct;
    return from === to ? sameZoneMinutes : unknownMinutes;
  };
}
