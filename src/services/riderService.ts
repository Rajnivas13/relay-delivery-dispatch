import { AppError, notFound } from "@/domain/errors";
import type { RiderAvailability } from "@/domain/types";
import { isUniqueViolation, prisma, transaction } from "@/lib/db";
import type { RiderCreateInput, RiderUpdateInput } from "@/lib/schemas";
import { getNow } from "@/lib/settings";

const riderInclude = {
  zones: { select: { zoneId: true } },
  user: { select: { id: true, email: true } },
  assignments: {
    where: { status: { in: ["PENDING", "ACCEPTED"] as ("PENDING" | "ACCEPTED")[] } },
    orderBy: { createdAt: "desc" as const },
    include: {
      job: {
        select: {
          id: true,
          reference: true,
          status: true,
          pickupZoneId: true,
          dropZoneId: true,
          loadUnits: true,
          priority: true,
          deadlineAt: true,
        },
      },
    },
  },
};

function present<T extends { zones: { zoneId: string }[]; capacityUnits: number; reservedUnits: number }>(r: T) {
  const { zones, ...rest } = r;
  return {
    ...rest,
    zoneIds: zones.map((z) => z.zoneId),
    freeUnits: r.capacityUnits - r.reservedUnits,
  };
}

export async function listRiders() {
  const riders = await prisma.rider.findMany({ include: riderInclude, orderBy: { code: "asc" } });
  return riders.map(present);
}

export async function getRider(id: string) {
  const rider = await prisma.rider.findFirst({ where: { OR: [{ id }, { code: id }] }, include: riderInclude });
  if (!rider) throw notFound("Rider", id);
  return present(rider);
}

async function assertZonesExist(zoneIds: string[]) {
  const found = await prisma.zone.findMany({ where: { id: { in: zoneIds } }, select: { id: true } });
  const missing = zoneIds.filter((z) => !found.some((f) => f.id === z));
  if (missing.length) throw new AppError("VALIDATION_ERROR", `Unknown zone(s): ${missing.join(", ")}`);
}

export async function createRider(input: RiderCreateInput) {
  await assertZonesExist([...new Set([...input.zoneIds, input.currentZoneId])]);
  const code = input.code ?? (await nextRiderCode());
  try {
    const rider = await prisma.rider.create({
      data: {
        code,
        name: input.name,
        phone: input.phone,
        availability: input.availability,
        currentZoneId: input.currentZoneId,
        capacityUnits: input.capacityUnits,
        maxActiveJobs: input.maxActiveJobs,
        zones: { create: input.zoneIds.map((zoneId) => ({ zoneId })) },
      },
    });
    return getRider(rider.id);
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("CONFLICT", `Rider code '${code}' already exists`);
    throw err;
  }
}

async function nextRiderCode(): Promise<string> {
  const last = await prisma.rider.findFirst({ where: { code: { startsWith: "R-" } }, orderBy: { code: "desc" } });
  const n = last ? Number(last.code.slice(2)) + 1 : 1;
  return `R-${String(Number.isFinite(n) ? n : Date.now() % 1000).padStart(3, "0")}`;
}

/** Capacity can only shrink down to what is already reserved; reserved units belong to live jobs. */
export async function updateRider(id: string, input: RiderUpdateInput) {
  const { zoneIds, expectedVersion, ...fields } = input;
  if (zoneIds) await assertZonesExist(zoneIds);
  if (fields.currentZoneId) await assertZonesExist([fields.currentZoneId]);

  await transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Rider" WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) throw notFound("Rider", id);
    const rider = await tx.rider.findUniqueOrThrow({ where: { id } });
    if (expectedVersion !== undefined && rider.version !== expectedVersion) {
      throw new AppError("STALE_VERSION", "Rider changed since you loaded it", { currentVersion: rider.version });
    }
    if (fields.capacityUnits !== undefined && fields.capacityUnits < rider.reservedUnits) {
      throw new AppError("CONFLICT", `Capacity cannot be below the ${rider.reservedUnits} units already reserved`);
    }
    if (fields.maxActiveJobs !== undefined && fields.maxActiveJobs < rider.activeJobCount) {
      throw new AppError("CONFLICT", `Job limit cannot be below the ${rider.activeJobCount} active jobs`);
    }
    await tx.rider.update({ where: { id }, data: { ...fields, version: { increment: 1 } } });
    if (zoneIds) {
      await tx.riderZone.deleteMany({ where: { riderId: id } });
      await tx.riderZone.createMany({ data: zoneIds.map((zoneId) => ({ riderId: id, zoneId })) });
    }
  });
  return getRider(id);
}

export async function setAvailability(id: string, availability: RiderAvailability) {
  return updateRider(id, { availability });
}

/** Rider app view: live offers with seconds left on the simulated clock. */
export async function getRiderOffers(id: string) {
  const rider = await getRider(id);
  const now = await getNow();
  const recent = await prisma.assignment.findMany({
    where: { riderId: rider.id, status: { in: ["COMPLETED", "REJECTED", "EXPIRED", "CANCELLED"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { job: { select: { id: true, reference: true, status: true, pickupZoneId: true, dropZoneId: true } } },
  });
  return {
    rider,
    now: now.toISOString(),
    active: rider.assignments.map((a) => ({
      ...a,
      secondsLeft: a.status === "PENDING" ? Math.round((a.expiresAt.getTime() - now.getTime()) / 1000) : null,
    })),
    recent,
  };
}

export async function listZones() {
  return prisma.zone.findMany({ orderBy: { id: "asc" } });
}
