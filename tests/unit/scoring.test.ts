import { describe, expect, it } from "vitest";
import { checkEligibility, type JobSnapshot, type RiderSnapshot } from "@/domain/eligibility";
import { acceptanceRate, makeTravelFn, rankRiders, scoreRider } from "@/domain/scoring";

const travel = makeTravelFn([
  { fromZoneId: "A", toZoneId: "B", minutes: 20 },
  { fromZoneId: "A", toZoneId: "C", minutes: 40 },
  { fromZoneId: "B", toZoneId: "C", minutes: 25 },
]);
const now = new Date("2026-01-01T10:00:00Z");

const rider = (o: Partial<RiderSnapshot> = {}): RiderSnapshot => ({
  id: o.id ?? "r1",
  code: o.code ?? "R-1",
  name: o.name ?? "Rider",
  availability: "ONLINE",
  currentZoneId: "A",
  zoneIds: ["A", "B"],
  capacityUnits: 10,
  reservedUnits: 0,
  activeJobCount: 0,
  maxActiveJobs: 3,
  offersReceived: 10,
  offersAccepted: 9,
  ...o,
});
const job: JobSnapshot = { pickupZoneId: "A", dropZoneId: "B", loadUnits: 3, priority: "NORMAL", deadlineAt: null };

describe("eligibility", () => {
  it("accepts an online rider covering both zones with capacity", () => {
    expect(checkEligibility(rider(), job)).toEqual({ eligible: true, reasons: [] });
  });

  it.each([
    ["offline", { availability: "OFFLINE" as const }, /offline/i],
    ["on break", { availability: "ON_BREAK" as const }, /on break/i],
    ["no pickup zone", { zoneIds: ["B"] }, /pickup zone/],
    ["no delivery zone", { zoneIds: ["A"] }, /delivery zone/],
    ["insufficient capacity", { reservedUnits: 8 }, /only 2 free/],
    ["at job limit", { activeJobCount: 3 }, /job limit/],
  ])("rejects a rider who is %s", (_label, override, reason) => {
    const res = checkEligibility(rider(override), job);
    expect(res.eligible).toBe(false);
    expect(res.reasons.join(" ")).toMatch(reason);
  });

  it("excludes a rider who already rejected this job", () => {
    const res = checkEligibility(rider(), job, { rejectedRiderIds: new Set(["r1"]), expiredRiderIds: new Set() });
    expect(res.reasons).toContain("Already rejected this job");
  });
});

describe("scoring and ranking", () => {
  it("ranks closer, less loaded riders higher and explains why", () => {
    const near = rider({ id: "near", code: "R-NEAR", currentZoneId: "A" });
    const far = rider({ id: "far", code: "R-FAR", currentZoneId: "C", zoneIds: ["A", "B", "C"], activeJobCount: 2 });
    const { eligible } = rankRiders([far, near], job, travel, now);
    expect(eligible.map((c) => c.riderId)).toEqual(["near", "far"]);
    expect(eligible[0].rank).toBe(1);
    expect(eligible[0].reasons.length).toBeGreaterThan(0);
    expect(eligible[0].breakdown.reduce((s, f) => s + f.max, 0)).toBe(100);
  });

  it("never ranks ineligible riders and lists why they were excluded", () => {
    const { eligible, ineligible } = rankRiders(
      [rider({ id: "ok" }), rider({ id: "off", code: "R-OFF", availability: "OFFLINE" }), rider({ id: "full", code: "R-FULL", reservedUnits: 9 })],
      job,
      travel,
      now,
    );
    expect(eligible.map((c) => c.riderId)).toEqual(["ok"]);
    expect(ineligible.map((r) => r.riderId).sort()).toEqual(["full", "off"]);
  });

  it("flags riders who would miss the deadline", () => {
    const tight = { ...job, deadlineAt: new Date(now.getTime() + 10 * 60_000) };
    const c = scoreRider(rider(), tight, travel, now);
    expect(c.warnings.join(" ")).toMatch(/miss the deadline/);
    expect(c.breakdown.find((f) => f.key === "deadline")!.points).toBe(0);
  });

  it("penalises a rider who let an earlier offer expire", () => {
    const base = scoreRider(rider(), job, travel, now);
    const penalised = scoreRider(rider(), job, travel, now, { rejectedRiderIds: new Set(), expiredRiderIds: new Set(["r1"]) });
    expect(penalised.score).toBeLessThan(base.score);
    expect(penalised.acceptProbability).toBeLessThan(base.acceptProbability);
  });

  it("weights travel more heavily for urgent jobs", () => {
    const urgent = scoreRider(rider(), { ...job, priority: "URGENT" }, travel, now);
    expect(urgent.breakdown.find((f) => f.key === "travel")!.max).toBe(45);
  });

  it("is deterministic with a stable tie-break", () => {
    const a = rider({ id: "a", code: "R-A" });
    const b = rider({ id: "b", code: "R-B" });
    expect(rankRiders([b, a], job, travel, now).eligible.map((c) => c.code)).toEqual(["R-A", "R-B"]);
  });

  it("smooths acceptance rate for new riders", () => {
    expect(acceptanceRate({ offersAccepted: 0, offersReceived: 0 })).toBe(0.5);
  });
});
