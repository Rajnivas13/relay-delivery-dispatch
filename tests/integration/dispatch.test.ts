import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/domain/errors";
import { CRON_ACTOR } from "@/domain/types";
import { prisma } from "@/lib/db";
import { lazySweep } from "@/lib/lazyExpiry";
import { acceptAssignment, assignRider, rejectAssignment } from "@/services/assignmentService";
import { cancelJob, createJob, getJob, markDelivered, markPickedUp } from "@/services/jobService";
import { getRecommendations } from "@/services/recommendationService";
import { expireOverdueAssignments } from "@/services/timeoutService";
import { DISPATCHER, events, makeJob, makeRider, resetDb, riderActor, setTimeoutSeconds } from "../helpers";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
};

const inFuture = (seconds: number) => new Date(Date.now() + seconds * 1000);

beforeEach(resetDb);

describe("assignment", () => {
  it("assigns an eligible rider, reserves capacity and records history", async () => {
    const rider = await makeRider({ capacityUnits: 10 });
    const job = await makeJob({ loadUnits: 4 });
    expect(job.status).toBe("READY_FOR_ASSIGNMENT");

    const { job: assigned, assignment } = await assignRider(job.id, { riderId: rider.id }, DISPATCHER);

    expect(assigned.status).toBe("AWAITING_CONFIRMATION");
    expect(assignment.status).toBe("PENDING");
    expect(assignment.expiresAt.getTime() - assignment.offeredAt.getTime()).toBe(7200 * 1000);
    const r = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(r.reservedUnits).toBe(4);
    expect(r.activeJobCount).toBe(1);
    expect((await events(job.id)).map((e) => e.type)).toEqual(["JOB_CREATED", "STATUS_CHANGED", "RIDER_ASSIGNED"]);
  });

  it("does not recommend unavailable riders or riders without capacity", async () => {
    const ok = await makeRider({ code: "OK-1" });
    const offline = await makeRider({ code: "OFF-1", availability: "OFFLINE" });
    const full = await makeRider({ code: "FULL-1", capacityUnits: 5, reservedUnits: 4 });
    const job = await makeJob({ loadUnits: 3 });

    const rec = await getRecommendations(job.id, { useAi: false, actor: DISPATCHER });

    expect(rec.candidates.map((c) => c.riderId)).toEqual([ok.id]);
    expect(rec.ineligible.map((r) => r.riderId).sort()).toEqual([full.id, offline.id].sort());
    expect(await code(assignRider(job.id, { riderId: offline.id, overrideReason: "try anyway" }, DISPATCHER))).toBe("RIDER_NOT_ELIGIBLE");
    expect(await code(assignRider(job.id, { riderId: full.id, overrideReason: "try anyway" }, DISPATCHER))).toBe("RIDER_NOT_ELIGIBLE");
  });

  it("leaves a job with no eligible rider in the Manual Queue", async () => {
    await makeRider({ availability: "OFFLINE" });
    const job = await makeJob();
    expect(job.status).toBe("MANUAL_QUEUE");
    expect(job.manualQueueReason).toBe("NO_ELIGIBLE_RIDER");
    expect(job.currentAssignmentId).toBeNull();
    expect((await events(job.id)).at(-1)?.type).toBe("MOVED_TO_MANUAL_QUEUE");
  });

  it("requires and records a reason when overriding the recommendation", async () => {
    const best = await makeRider({ code: "BEST", currentZoneId: "CENTRAL" });
    const other = await makeRider({ code: "OTHER", currentZoneId: "NORTH", activeJobCount: 2 });
    const job = await makeJob({ pickupZoneId: "CENTRAL" });
    const rec = await getRecommendations(job.id, { useAi: false, actor: DISPATCHER });
    expect(rec.recommendedRiderId).toBe(best.id);

    expect(await code(assignRider(job.id, { riderId: other.id }, DISPATCHER))).toBe("OVERRIDE_REASON_REQUIRED");
    const res = await assignRider(job.id, { riderId: other.id, overrideReason: "Customer asked for this rider" }, DISPATCHER);
    expect(res.isOverride).toBe(true);
    expect(res.assignment.overrideReason).toBe("Customer asked for this rider");
    const override = (await events(job.id)).find((e) => e.type === "MANUAL_OVERRIDE");
    expect(override?.details).toMatchObject({ recommendedRiderId: best.id, chosenRiderId: other.id });
    expect(override?.actorName).toBe(DISPATCHER.name);
  });

  it("lets exactly one of two concurrent dispatchers assign the same job", async () => {
    const a = await makeRider({ code: "A" });
    const b = await makeRider({ code: "B" });
    const job = await makeJob();
    const results = await Promise.allSettled([
      assignRider(job.id, { riderId: a.id, overrideReason: "parallel test" }, DISPATCHER),
      assignRider(job.id, { riderId: b.id, overrideReason: "parallel test" }, DISPATCHER),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as AppError).code).toBe("CONFLICT");

    expect(await prisma.assignment.count({ where: { jobId: job.id } })).toBe(1);
    const riders = await prisma.rider.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(riders.reduce((s, r) => s + r.reservedUnits, 0)).toBe(job.loadUnits);
  });

  it("rejects a stale expectedVersion", async () => {
    const rider = await makeRider();
    const job = await makeJob();
    expect(await code(assignRider(job.id, { riderId: rider.id, expectedVersion: job.version - 1 }, DISPATCHER))).toBe("STALE_VERSION");
  });

  it("does not over-reserve a rider across concurrent jobs", async () => {
    const rider = await makeRider({ capacityUnits: 5, maxActiveJobs: 5 });
    const j1 = await makeJob({ loadUnits: 3 });
    const j2 = await makeJob({ loadUnits: 3 });
    const results = await Promise.allSettled([
      assignRider(j1.id, { riderId: rider.id }, DISPATCHER),
      assignRider(j2.id, { riderId: rider.id }, DISPATCHER),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } })).reservedUnits).toBe(3);
  });
});

describe("delivery lifecycle", () => {
  it("moves a confirmed assignment through pickup and delivery and releases capacity", async () => {
    const rider = await makeRider();
    const job = await makeJob({ loadUnits: 3 });
    const { assignment } = await assignRider(job.id, { riderId: rider.id }, DISPATCHER);

    expect((await acceptAssignment(assignment.id, riderActor(rider.id))).job.status).toBe("ACCEPTED");
    expect((await markPickedUp(job.id, riderActor(rider.id))).status).toBe("PICKED_UP");
    expect((await markDelivered(job.id, riderActor(rider.id))).status).toBe("DELIVERED");

    const r = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(r).toMatchObject({ reservedUnits: 0, activeJobCount: 0, currentZoneId: "NORTH" });
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status).toBe("COMPLETED");
    expect((await events(job.id)).map((e) => e.type)).toEqual([
      "JOB_CREATED",
      "STATUS_CHANGED",
      "RIDER_ASSIGNED",
      "RIDER_CONFIRMED",
      "PICKED_UP",
      "DELIVERED",
    ]);
  });

  it("blocks invalid transitions", async () => {
    const rider = await makeRider();
    const job = await makeJob();
    expect(await code(markDelivered(job.id, DISPATCHER))).toBe("INVALID_TRANSITION");

    const { assignment } = await assignRider(job.id, { riderId: rider.id }, DISPATCHER);
    expect(await code(markPickedUp(job.id, DISPATCHER))).toBe("INVALID_TRANSITION");
    await acceptAssignment(assignment.id, DISPATCHER);
    expect(await code(markDelivered(job.id, DISPATCHER))).toBe("INVALID_TRANSITION");
    expect(await code(acceptAssignment(assignment.id, DISPATCHER))).toBe("ASSIGNMENT_NOT_PENDING");
    await markPickedUp(job.id, DISPATCHER);
    expect(await code(cancelJob(job.id, "too late", DISPATCHER))).toBe("INVALID_TRANSITION");

    const other = await makeJob();
    await cancelJob(other.id, "customer cancelled", DISPATCHER);
    expect(await code(assignRider(other.id, { riderId: rider.id }, DISPATCHER))).toBe("INVALID_TRANSITION");
    expect(await code(markPickedUp(other.id, DISPATCHER))).toBe("INVALID_TRANSITION");
  });

  it("only lets the assigned rider act on their own offer", async () => {
    const mine = await makeRider();
    const someoneElse = await makeRider();
    const job = await makeJob();
    const { assignment } = await assignRider(job.id, { riderId: mine.id }, DISPATCHER);
    expect(await code(acceptAssignment(assignment.id, riderActor(someoneElse.id)))).toBe("FORBIDDEN");
    expect(await code(acceptAssignment(assignment.id, riderActor(mine.id)))).toBe("OK");
  });

  it("releases capacity when an assigned job is cancelled", async () => {
    const rider = await makeRider();
    const job = await makeJob({ loadUnits: 5 });
    await assignRider(job.id, { riderId: rider.id }, DISPATCHER);
    await cancelJob(job.id, "customer cancelled", DISPATCHER);
    expect((await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } })).reservedUnits).toBe(0);
  });
});

describe("timeouts and the manual queue", () => {
  it("moves an overdue assignment to the Manual Queue, releases capacity and keeps history", async () => {
    await setTimeoutSeconds(60);
    const rider = await makeRider();
    const job = await makeJob({ loadUnits: 4 });
    const { assignment } = await assignRider(job.id, { riderId: rider.id }, DISPATCHER);

    const notYet = await expireOverdueAssignments({ source: "cron", actor: CRON_ACTOR });
    expect(notYet.expired).toBe(0);

    const res = await expireOverdueAssignments({ source: "cron", actor: CRON_ACTOR, now: inFuture(61) });
    expect(res.expired).toBe(1);

    const after = await getJob(job.id);
    expect(after.status).toBe("MANUAL_QUEUE");
    expect(after.manualQueueReason).toBe("CONFIRMATION_TIMEOUT");
    expect(after.currentAssignmentId).toBeNull();
    expect(after.assignments.find((a) => a.id === assignment.id)?.status).toBe("EXPIRED");
    expect((await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } })).reservedUnits).toBe(0);

    const types = (await events(job.id)).map((e) => e.type);
    expect(types.slice(-2)).toEqual(["ASSIGNMENT_TIMEOUT", "MOVED_TO_MANUAL_QUEUE"]);
    const timeout = (await events(job.id)).find((e) => e.type === "ASSIGNMENT_TIMEOUT");
    expect(timeout?.actorType).toBe("CRON");
    expect(timeout?.details).toMatchObject({ thresholdSeconds: 60, releasedUnits: 4 });
  });

  it("uses the simulated clock and lazy expiry on reads", async () => {
    await setTimeoutSeconds(30);
    const rider = await makeRider();
    const job = await makeJob();
    await assignRider(job.id, { riderId: rider.id }, DISPATCHER);

    await prisma.setting.update({ where: { id: 1 }, data: { clockOffsetSeconds: 31 } });
    await lazySweep(true);
    expect((await getJob(job.id)).status).toBe("MANUAL_QUEUE");
    expect((await events(job.id)).find((e) => e.type === "ASSIGNMENT_TIMEOUT")?.actorType).toBe("SYSTEM");
  });

  it("rejects a late accept and commits the timeout first", async () => {
    await setTimeoutSeconds(30);
    const rider = await makeRider();
    const job = await makeJob();
    const { assignment } = await assignRider(job.id, { riderId: rider.id }, DISPATCHER);
    await prisma.setting.update({ where: { id: 1 }, data: { clockOffsetSeconds: 40 } });

    expect(await code(acceptAssignment(assignment.id, riderActor(rider.id)))).toBe("ASSIGNMENT_EXPIRED");
    expect((await getJob(job.id)).status).toBe("MANUAL_QUEUE");
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status).toBe("EXPIRED");
  });

  it("expires an assignment exactly once when cron and lazy sweeps race", async () => {
    await setTimeoutSeconds(10);
    const riders = await Promise.all([makeRider(), makeRider(), makeRider()]);
    const jobs = [];
    for (const r of riders) {
      const j = await makeJob({ loadUnits: 2 });
      await assignRider(j.id, { riderId: r.id }, DISPATCHER);
      jobs.push(j);
    }
    const at = inFuture(11);
    const results = await Promise.all([
      expireOverdueAssignments({ source: "cron", actor: CRON_ACTOR, now: at }),
      expireOverdueAssignments({ source: "lazy", now: at }),
      expireOverdueAssignments({ source: "manual", now: at }),
    ]);
    expect(results.reduce((s, r) => s + r.expired, 0)).toBe(3);
    for (const j of jobs) {
      expect((await events(j.id)).filter((e) => e.type === "ASSIGNMENT_TIMEOUT")).toHaveLength(1);
    }
    for (const r of riders) {
      expect((await prisma.rider.findUniqueOrThrow({ where: { id: r.id } })).reservedUnits).toBe(0);
    }
  });

  it("sends a rejected job to the Manual Queue and excludes that rider afterwards", async () => {
    const first = await makeRider({ code: "FIRST" });
    const second = await makeRider({ code: "SECOND", currentZoneId: "NORTH" });
    const job = await makeJob();
    const { assignment } = await assignRider(job.id, { riderId: first.id }, DISPATCHER);

    const { job: rejected } = await rejectAssignment(assignment.id, "Vehicle issue", riderActor(first.id));
    expect(rejected.status).toBe("MANUAL_QUEUE");
    expect(rejected.manualQueueReason).toBe("RIDER_REJECTED");
    expect((await prisma.rider.findUniqueOrThrow({ where: { id: first.id } })).reservedUnits).toBe(0);

    const rec = await getRecommendations(job.id, { useAi: false, actor: DISPATCHER });
    expect(rec.candidates.map((c) => c.riderId)).toEqual([second.id]);
    expect(rec.ineligible.find((r) => r.riderId === first.id)?.reasons).toContain("Already rejected this job");
  });

  it("reassigns a job from the Manual Queue and completes it", async () => {
    await setTimeoutSeconds(10);
    const slow = await makeRider({ code: "SLOW" });
    const job = await makeJob();
    await assignRider(job.id, { riderId: slow.id }, DISPATCHER);
    await expireOverdueAssignments({ source: "cron", actor: CRON_ACTOR, now: inFuture(11) });
    expect((await getJob(job.id)).status).toBe("MANUAL_QUEUE");

    const fresh = await makeRider({ code: "FRESH" });
    const rec = await getRecommendations(job.id, { useAi: false, actor: DISPATCHER });
    const pick = rec.recommendedRiderId!;
    expect(rec.candidates.find((c) => c.riderId === slow.id)?.warnings.join(" ")).toMatch(/expire/);

    const { assignment } = await assignRider(job.id, { riderId: pick }, DISPATCHER);
    await acceptAssignment(assignment.id, DISPATCHER);
    await markPickedUp(job.id, DISPATCHER);
    await markDelivered(job.id, DISPATCHER);

    const final = await getJob(job.id);
    expect(final.status).toBe("DELIVERED");
    expect(final.assignments.map((a) => a.status).sort()).toEqual(["COMPLETED", "EXPIRED"]);
    expect((await events(job.id)).some((e) => e.type === "RIDER_REASSIGNED")).toBe(true);
    expect(fresh.id).toBeTruthy();
  });
});

describe("idempotent job creation", () => {
  const input = { reference: "DUP-1", pickupZoneId: "CENTRAL", dropZoneId: "NORTH", loadUnits: 2, priority: "NORMAL" as const };

  it("returns the original job for a repeated submission", async () => {
    await makeRider();
    const first = await createJob(input, DISPATCHER, "key-12345678");
    const again = await createJob(input, DISPATCHER, "key-12345678");
    const sameRefNoKey = await createJob(input, DISPATCHER, null);
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, job: { id: first.job.id } });
    expect(sameRefNoKey.job.id).toBe(first.job.id);
    expect(await prisma.job.count()).toBe(1);
    expect(await prisma.jobEvent.count({ where: { type: "JOB_CREATED" } })).toBe(1);
  });

  it("rejects reuse of a key or reference with a different body", async () => {
    await createJob(input, DISPATCHER, "key-abcdefgh");
    expect(await code(createJob({ ...input, loadUnits: 9 }, DISPATCHER, "key-abcdefgh"))).toBe("IDEMPOTENCY_CONFLICT");
    expect(await code(createJob({ ...input, loadUnits: 9 }, DISPATCHER, null))).toBe("CONFLICT");
  });

  it("creates one job when identical requests race", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createJob({ ...input, reference: undefined }, DISPATCHER, "race-key-0001")),
    );
    expect(new Set(results.map((r) => r.job.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await prisma.job.count()).toBe(1);
  });

  it("validates zones and deadlines", async () => {
    expect(await code(createJob({ ...input, reference: "Z-1", pickupZoneId: "MARS" }, DISPATCHER))).toBe("VALIDATION_ERROR");
    expect(await code(createJob({ ...input, reference: "Z-2", deadlineAt: new Date(Date.now() - 60_000).toISOString() }, DISPATCHER))).toBe("VALIDATION_ERROR");
  });
});

describe("AI recommendation fallback", () => {
  it("falls back to the score ranking when the AI names an ineligible rider", async () => {
    const rider = await makeRider();
    const job = await makeJob();
    const fetchImpl = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ranking: [{ riderId: "not-a-rider", acceptProbability: 0.9, etaMinutes: 5, reason: "x" }], summary: "", riskNote: null }) } }] }));
    const rec = await getRecommendations(job.id, { useAi: true, actor: DISPATCHER, aiOptions: { apiKey: "k", fetchImpl } });
    expect(rec).toMatchObject({ strategy: "SCORE", usedFallback: true, fallbackReason: "AI_UNKNOWN_RIDER", recommendedRiderId: rider.id });
    const stored = await prisma.recommendation.findFirstOrThrow({ where: { jobId: job.id } });
    expect(stored.usedFallback).toBe(true);
  });

  it("uses the AI order when valid and stores it for override detection", async () => {
    const a = await makeRider({ code: "AA", currentZoneId: "CENTRAL" });
    const b = await makeRider({ code: "BB", currentZoneId: "NORTH" });
    const job = await makeJob({ pickupZoneId: "CENTRAL" });
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ranking: [
                    { riderId: b.id, acceptProbability: 0.95, etaMinutes: 40, reason: "Always accepts" },
                    { riderId: a.id, acceptProbability: 0.6, etaMinutes: 25, reason: "Often ignores offers" },
                  ],
                  summary: "Prefer BB",
                  riskNote: null,
                }),
              },
            },
          ],
        }),
      );
    const rec = await getRecommendations(job.id, { useAi: true, actor: DISPATCHER, aiOptions: { apiKey: "k", fetchImpl } });
    expect(rec.strategy).toBe("AI_RERANK");
    expect(rec.recommendedRiderId).toBe(b.id);
    expect(rec.scoreTopRiderId).toBe(a.id);

    expect(await code(assignRider(job.id, { riderId: a.id }, DISPATCHER))).toBe("OVERRIDE_REASON_REQUIRED");
    expect(await code(assignRider(job.id, { riderId: b.id }, DISPATCHER))).toBe("OK");
  });
});
