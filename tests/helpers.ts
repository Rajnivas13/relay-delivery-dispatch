import type { RiderAvailability } from "@prisma/client";
import type { Actor } from "@/domain/types";
import { prisma } from "@/lib/db";
import { resetLazySweepThrottle } from "@/lib/lazyExpiry";
import { resetDatabase, seedReferenceData } from "@/lib/seed";
import { createJob } from "@/services/jobService";
import { createApiToken, hashPassword } from "@/services/userService";

export const DISPATCHER: Actor = { type: "USER", id: "u-dispatcher", name: "Test Dispatcher", role: "DISPATCHER" };

export async function resetDb() {
  await resetDatabase();
  await seedReferenceData();
  resetLazySweepThrottle();
}

let seq = 0;

export async function makeRider(
  overrides: Partial<{
    code: string;
    name: string;
    availability: RiderAvailability;
    currentZoneId: string;
    zoneIds: string[];
    capacityUnits: number;
    reservedUnits: number;
    maxActiveJobs: number;
    activeJobCount: number;
    offersReceived: number;
    offersAccepted: number;
  }> = {},
) {
  seq += 1;
  const zoneIds = overrides.zoneIds ?? ["CENTRAL", "NORTH"];
  return prisma.rider.create({
    data: {
      code: overrides.code ?? `T-${String(seq).padStart(3, "0")}`,
      name: overrides.name ?? `Rider ${seq}`,
      availability: overrides.availability ?? "ONLINE",
      currentZoneId: overrides.currentZoneId ?? zoneIds[0],
      capacityUnits: overrides.capacityUnits ?? 10,
      reservedUnits: overrides.reservedUnits ?? 0,
      maxActiveJobs: overrides.maxActiveJobs ?? 3,
      activeJobCount: overrides.activeJobCount ?? 0,
      offersReceived: overrides.offersReceived ?? 10,
      offersAccepted: overrides.offersAccepted ?? 9,
      zones: { create: zoneIds.map((zoneId) => ({ zoneId })) },
    },
  });
}

export async function makeJob(
  overrides: Partial<{ reference: string; pickupZoneId: string; dropZoneId: string; loadUnits: number; priority: "LOW" | "NORMAL" | "HIGH" | "URGENT" }> = {},
  key?: string,
) {
  seq += 1;
  const { job } = await createJob(
    {
      reference: overrides.reference ?? `TEST-${seq}`,
      pickupZoneId: overrides.pickupZoneId ?? "CENTRAL",
      dropZoneId: overrides.dropZoneId ?? "NORTH",
      loadUnits: overrides.loadUnits ?? 2,
      priority: overrides.priority ?? "NORMAL",
    },
    DISPATCHER,
    key ?? null,
  );
  return job;
}

export async function setTimeoutSeconds(seconds: number) {
  await prisma.setting.update({ where: { id: 1 }, data: { confirmationTimeoutSeconds: seconds } });
}

export async function events(jobId: string) {
  return prisma.jobEvent.findMany({ where: { jobId }, orderBy: { id: "asc" } });
}

export async function makeUserWithToken(role: "ADMIN" | "DISPATCHER" | "RIDER" | "VIEWER", opts: { riderId?: string; scopes?: string[] } = {}) {
  seq += 1;
  const user = await prisma.user.create({
    data: {
      email: `user${seq}@test.dev`,
      name: `${role} ${seq}`,
      role,
      riderId: opts.riderId ?? null,
      passwordHash: await hashPassword("password123"),
    },
  });
  const token = await createApiToken(user.id, "test", opts.scopes ?? ["*"]);
  return { user, token: token.token, tokenId: token.id };
}

export const riderActor = (riderId: string): Actor => ({ type: "USER", id: `rider-user-${riderId}`, name: "Rider", role: "RIDER", riderId });
