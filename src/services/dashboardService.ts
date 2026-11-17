import { prisma } from "@/lib/db";
import { getClock } from "@/lib/settings";

const DEADLINE_RISK_MINUTES = 60;
const STALE_READY_MINUTES = 10;

export async function getDashboardSummary() {
  const { now, settings } = await getClock();
  const [byStatus, byZone, riders, expiringSoon, deadlineRisk, staleReady, manualQueue] = await Promise.all([
    prisma.job.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.job.groupBy({
      by: ["pickupZoneId", "status"],
      where: { status: { notIn: ["DELIVERED", "CANCELLED"] } },
      _count: { _all: true },
    }),
    prisma.rider.groupBy({ by: ["availability"], _count: { _all: true }, _sum: { capacityUnits: true, reservedUnits: true } }),
    prisma.assignment.findMany({
      where: {
        status: "PENDING",
        expiresAt: { lte: new Date(now.getTime() + Math.max(settings.confirmationTimeoutSeconds * 250, 60_000)) },
      },
      orderBy: { expiresAt: "asc" },
      take: 10,
      include: {
        job: { select: { id: true, reference: true, priority: true } },
        rider: { select: { code: true, name: true } },
      },
    }),
    prisma.job.findMany({
      where: {
        status: { notIn: ["DELIVERED", "CANCELLED"] },
        deadlineAt: { not: null, lte: new Date(now.getTime() + DEADLINE_RISK_MINUTES * 60_000) },
      },
      orderBy: { deadlineAt: "asc" },
      take: 10,
      select: { id: true, reference: true, status: true, deadlineAt: true, priority: true },
    }),
    prisma.job.findMany({
      where: { status: "READY_FOR_ASSIGNMENT", createdAt: { lte: new Date(now.getTime() - STALE_READY_MINUTES * 60_000) } },
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { id: true, reference: true, createdAt: true, priority: true },
    }),
    prisma.job.findMany({
      where: { status: "MANUAL_QUEUE" },
      orderBy: { manualQueuedAt: "asc" },
      take: 10,
      select: { id: true, reference: true, manualQueueReason: true, manualQueuedAt: true, priority: true },
    }),
  ]);

  const count = (...statuses: string[]) =>
    byStatus.filter((s) => statuses.includes(s.status)).reduce((n, s) => n + s._count._all, 0);
  const statusCounts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));

  const zones = new Map<string, { zoneId: string; active: number; waiting: number }>();
  for (const z of byZone) {
    const entry = zones.get(z.pickupZoneId) ?? { zoneId: z.pickupZoneId, active: 0, waiting: 0 };
    entry.active += z._count._all;
    if (["NEW", "READY_FOR_ASSIGNMENT", "MANUAL_QUEUE"].includes(z.status)) entry.waiting += z._count._all;
    zones.set(z.pickupZoneId, entry);
  }

  const online = riders.find((r) => r.availability === "ONLINE");

  return {
    now: now.toISOString(),
    timeoutSeconds: settings.confirmationTimeoutSeconds,
    clockOffsetSeconds: settings.clockOffsetSeconds,
    lastSweep: settings.lastSweepAt
      ? { at: settings.lastSweepAt.toISOString(), source: settings.lastSweepSource, expired: settings.lastSweepExpired }
      : null,
    kpis: {
      totalReceived: count(...Object.keys(statusCounts)),
      awaitingAssignment: count("NEW", "READY_FOR_ASSIGNMENT"),
      awaitingConfirmation: count("AWAITING_CONFIRMATION"),
      inProgress: count("ACCEPTED", "PICKED_UP"),
      manualQueue: count("MANUAL_QUEUE"),
      delivered: count("DELIVERED"),
      cancelled: count("CANCELLED"),
    },
    statusCounts,
    zones: [...zones.values()].sort((a, b) => b.active - a.active),
    riders: {
      online: online?._count._all ?? 0,
      total: riders.reduce((n, r) => n + r._count._all, 0),
      onlineFreeUnits: (online?._sum.capacityUnits ?? 0) - (online?._sum.reservedUnits ?? 0),
    },
    attention: {
      expiringSoon: expiringSoon.map((a) => ({
        assignmentId: a.id,
        jobId: a.job.id,
        reference: a.job.reference,
        priority: a.job.priority,
        riderCode: a.rider.code,
        riderName: a.rider.name,
        expiresAt: a.expiresAt.toISOString(),
        secondsLeft: Math.round((a.expiresAt.getTime() - now.getTime()) / 1000),
      })),
      deadlineRisk: deadlineRisk.map((j) => ({
        ...j,
        minutesLeft: Math.round((j.deadlineAt!.getTime() - now.getTime()) / 60000),
      })),
      staleReady: staleReady.map((j) => ({
        ...j,
        waitingMinutes: Math.round((now.getTime() - j.createdAt.getTime()) / 60000),
      })),
      manualQueue: manualQueue.map((j) => ({
        ...j,
        waitingMinutes: j.manualQueuedAt ? Math.round((now.getTime() - j.manualQueuedAt.getTime()) / 60000) : 0,
      })),
    },
  };
}
