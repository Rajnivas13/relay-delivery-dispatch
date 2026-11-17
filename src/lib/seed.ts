import type { RiderAvailability } from "@prisma/client";
import type { Actor, Priority } from "@/domain/types";
import { acceptAssignment, assignRider, rejectAssignment } from "@/services/assignmentService";
import { cancelJob, createJob, markDelivered, markPickedUp } from "@/services/jobService";
import { getRecommendations } from "@/services/recommendationService";
import { hashPassword } from "@/services/userService";
import { prisma } from "./db";
import { getNow } from "./settings";

export const DEMO_PASSWORD = "Relay@123";

export const ZONES = [
  { id: "CENTRAL", name: "Central Business District" },
  { id: "NORTH", name: "North Hub" },
  { id: "SOUTH", name: "South Residential" },
  { id: "EAST", name: "East Tech Park" },
  { id: "WEST", name: "West Industrial" },
  { id: "AIRPORT", name: "Airport Cargo" },
];

const TRAVEL: [string, string, number][] = [
  ["CENTRAL", "NORTH", 15], ["CENTRAL", "SOUTH", 18], ["CENTRAL", "EAST", 12], ["CENTRAL", "WEST", 14],
  ["CENTRAL", "AIRPORT", 25], ["NORTH", "SOUTH", 30], ["NORTH", "EAST", 20], ["NORTH", "WEST", 22],
  ["NORTH", "AIRPORT", 35], ["SOUTH", "EAST", 22], ["SOUTH", "WEST", 20], ["SOUTH", "AIRPORT", 15],
  ["EAST", "WEST", 28], ["EAST", "AIRPORT", 30], ["WEST", "AIRPORT", 28],
];

interface SeedRider {
  code: string;
  name: string;
  phone: string;
  zone: string;
  zones: string[];
  capacity: number;
  availability: RiderAvailability;
  received: number;
  accepted: number;
  maxActive?: number;
  login?: string;
}

const RIDERS: SeedRider[] = [
  { code: "R-001", name: "Arjun Kumar", phone: "+91 98400 10001", zone: "CENTRAL", zones: ["CENTRAL", "NORTH", "EAST"], capacity: 10, availability: "ONLINE", received: 40, accepted: 37, login: "arjun" },
  { code: "R-002", name: "Priya Sharma", phone: "+91 98400 10002", zone: "NORTH", zones: ["NORTH", "CENTRAL"], capacity: 8, availability: "ONLINE", received: 25, accepted: 20, login: "priya" },
  { code: "R-003", name: "Rahul Verma", phone: "+91 98400 10003", zone: "SOUTH", zones: ["SOUTH", "CENTRAL", "AIRPORT"], capacity: 15, availability: "ONLINE", received: 30, accepted: 28, login: "rahul" },
  { code: "R-004", name: "Sneha Iyer", phone: "+91 98400 10004", zone: "EAST", zones: ["EAST", "CENTRAL"], capacity: 6, availability: "ONLINE", received: 18, accepted: 12, login: "sneha" },
  { code: "R-005", name: "Vikram Singh", phone: "+91 98400 10005", zone: "WEST", zones: ["WEST", "CENTRAL", "SOUTH"], capacity: 12, availability: "ONLINE", received: 50, accepted: 41, login: "vikram" },
  { code: "R-006", name: "Anjali Nair", phone: "+91 98400 10006", zone: "AIRPORT", zones: ["AIRPORT", "SOUTH"], capacity: 20, availability: "ONLINE", received: 22, accepted: 21 },
  { code: "R-007", name: "Karthik Raja", phone: "+91 98400 10007", zone: "CENTRAL", zones: ["CENTRAL", "WEST"], capacity: 5, availability: "ON_BREAK", received: 15, accepted: 14 },
  { code: "R-008", name: "Divya Menon", phone: "+91 98400 10008", zone: "NORTH", zones: ["NORTH", "EAST"], capacity: 10, availability: "OFFLINE", received: 10, accepted: 7 },
  { code: "R-009", name: "Mohammed Faiz", phone: "+91 98400 10009", zone: "SOUTH", zones: ["SOUTH", "WEST"], capacity: 8, availability: "ONLINE", received: 12, accepted: 6 },
  { code: "R-010", name: "Lakshmi Pillai", phone: "+91 98400 10010", zone: "EAST", zones: ["EAST", "NORTH", "CENTRAL"], capacity: 10, availability: "ONLINE", received: 0, accepted: 0 },
  { code: "R-011", name: "Suresh Babu", phone: "+91 98400 10011", zone: "WEST", zones: ["WEST", "NORTH"], capacity: 15, availability: "ONLINE", received: 35, accepted: 30 },
  { code: "R-012", name: "Meera Krishnan", phone: "+91 98400 10012", zone: "CENTRAL", zones: ZONES.map((z) => z.id), capacity: 4, availability: "ONLINE", received: 60, accepted: 58 },
  { code: "R-013", name: "Ravi Teja", phone: "+91 98400 10013", zone: "AIRPORT", zones: ["AIRPORT", "CENTRAL"], capacity: 25, availability: "OFFLINE", received: 8, accepted: 8 },
  { code: "R-014", name: "Fatima Sheikh", phone: "+91 98400 10014", zone: "SOUTH", zones: ["SOUTH", "AIRPORT", "CENTRAL"], capacity: 10, availability: "ONLINE", received: 20, accepted: 19 },
  { code: "R-015", name: "Aditya Rao", phone: "+91 98400 10015", zone: "EAST", zones: ["EAST", "WEST"], capacity: 8, availability: "ON_BREAK", received: 5, accepted: 4 },
];

const STAFF = [
  { email: "admin@relay.dev", name: "Asha Admin", role: "ADMIN" as const },
  { email: "dispatcher@relay.dev", name: "Dev Dispatcher", role: "DISPATCHER" as const },
  { email: "ops2@relay.dev", name: "Nisha Night-shift", role: "DISPATCHER" as const },
  { email: "viewer@relay.dev", name: "Vimal Viewer", role: "VIEWER" as const },
];

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "JobEvent", "Recommendation", "Assignment", "Job", "ApiToken", "User", "RiderZone", "Rider",
              "ZoneTravelTime", "Zone", "Setting", "LoginAttempt" RESTART IDENTITY CASCADE`,
  );
}

export async function seedReferenceData() {
  await prisma.zone.createMany({ data: ZONES });
  await prisma.zoneTravelTime.createMany({
    data: [
      ...TRAVEL.flatMap(([a, b, m]) => [
        { fromZoneId: a, toZoneId: b, minutes: m },
        { fromZoneId: b, toZoneId: a, minutes: m },
      ]),
      ...ZONES.map((z) => ({ fromZoneId: z.id, toZoneId: z.id, minutes: 8 })),
    ],
  });
  await prisma.setting.create({ data: { id: 1 } });
}

export async function seedDatabase({ reset }: { reset: boolean } = { reset: true }) {
  if (reset) await resetDatabase();
  await seedReferenceData();

  const riderIds: Record<string, string> = {};
  for (const r of RIDERS) {
    const rider = await prisma.rider.create({
      data: {
        code: r.code,
        name: r.name,
        phone: r.phone,
        availability: r.availability,
        currentZoneId: r.zone,
        capacityUnits: r.capacity,
        maxActiveJobs: r.maxActive ?? 3,
        offersReceived: r.received,
        offersAccepted: r.accepted,
        zones: { create: r.zones.map((zoneId) => ({ zoneId })) },
      },
    });
    riderIds[r.code] = rider.id;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users: Record<string, { id: string; name: string }> = {};
  for (const s of STAFF) {
    const u = await prisma.user.create({ data: { ...s, passwordHash } });
    users[s.email] = { id: u.id, name: u.name };
  }
  for (const r of RIDERS.filter((x) => x.login)) {
    await prisma.user.create({
      data: { email: `${r.login}@relay.dev`, name: r.name, role: "RIDER", riderId: riderIds[r.code], passwordHash },
    });
  }

  const dispatcher: Actor = {
    type: "USER",
    id: users["dispatcher@relay.dev"].id,
    name: users["dispatcher@relay.dev"].name,
    role: "DISPATCHER",
  };
  const riderActor = (code: string): Actor => ({
    type: "USER",
    id: null,
    name: RIDERS.find((r) => r.code === code)!.name,
    role: "RIDER",
    riderId: riderIds[code],
  });

  const now = await getNow();
  const inMinutes = (m: number) => new Date(now.getTime() + m * 60_000).toISOString();

  const mk = (reference: string, pickupZoneId: string, dropZoneId: string, loadUnits: number, priority: Priority, extra: { deadlineAt?: string; customerName?: string; notes?: string } = {}) =>
    createJob({ reference, pickupZoneId, dropZoneId, loadUnits, priority, ...extra }, dispatcher, `seed-${reference}`).then((r) => r.job);

  /** Assigns through the real service so the history and overrides are genuine. */
  const assignTo = async (jobId: string, code: string) => {
    const rec = await getRecommendations(jobId, { useAi: false, actor: dispatcher });
    const riderId = riderIds[code];
    return assignRider(
      jobId,
      { riderId, overrideReason: rec.recommendedRiderId === riderId ? undefined : "Demo: rider already near the pickup" },
      dispatcher,
    );
  };

  await mk("ORD-1001", "CENTRAL", "NORTH", 3, "NORMAL", { customerName: "Saravana Stores", notes: "Two boxes, fragile" });
  await mk("ORD-1002", "SOUTH", "AIRPORT", 8, "HIGH", { deadlineAt: inMinutes(90), customerName: "BlueDart Transfer" });

  const j3 = await mk("ORD-1003", "EAST", "CENTRAL", 2, "URGENT", { deadlineAt: inMinutes(45), customerName: "Apollo Pharmacy" });
  await assignTo(j3.id, "R-004");

  const j4 = await mk("ORD-1004", "WEST", "SOUTH", 4, "NORMAL", { customerName: "Hari Hardware" });
  const a4 = await assignTo(j4.id, "R-005");
  await acceptAssignment(a4.assignment.id, riderActor("R-005"));

  const j5 = await mk("ORD-1005", "CENTRAL", "EAST", 2, "NORMAL", { customerName: "Chai Point" });
  const a5 = await assignTo(j5.id, "R-001");
  await acceptAssignment(a5.assignment.id, riderActor("R-001"));
  await markPickedUp(j5.id, riderActor("R-001"));

  const j6 = await mk("ORD-1006", "NORTH", "CENTRAL", 3, "NORMAL", { customerName: "Kumar Textiles" });
  const a6 = await assignTo(j6.id, "R-002");
  await acceptAssignment(a6.assignment.id, riderActor("R-002"));
  await markPickedUp(j6.id, riderActor("R-002"));
  await markDelivered(j6.id, riderActor("R-002"));

  const j7 = await mk("ORD-1007", "SOUTH", "CENTRAL", 5, "HIGH", { customerName: "Grand Sweets" });
  const a7 = await assignTo(j7.id, "R-003");
  await rejectAssignment(a7.assignment.id, "Vehicle needs a tyre change", riderActor("R-003"));

  await mk("ORD-1008", "AIRPORT", "NORTH", 30, "NORMAL", { customerName: "Freight Forwarders", notes: "Pallet load, needs van" });

  // Replays an already-overdue offer: the first dashboard load or cron tick times it out.
  const j9 = await mk("ORD-1009", "CENTRAL", "WEST", 2, "NORMAL", { customerName: "Book Nook" });
  const a9 = await assignTo(j9.id, "R-012");
  await prisma.assignment.update({
    where: { id: a9.assignment.id },
    data: { expiresAt: new Date(now.getTime() - 60_000) },
  });

  const j10 = await mk("ORD-1010", "EAST", "NORTH", 1, "LOW", { customerName: "Daily Fresh" });
  await cancelJob(j10.id, "Customer cancelled the order", dispatcher);

  await mk("ORD-1011", "WEST", "NORTH", 6, "NORMAL", { deadlineAt: inMinutes(180), customerName: "Metro Electricals" });
  await mk("ORD-1012", "CENTRAL", "CENTRAL", 1, "HIGH", { customerName: "Law Chambers", notes: "Documents, signature required" });

  return {
    zones: ZONES.length,
    riders: RIDERS.length,
    users: STAFF.length + RIDERS.filter((r) => r.login).length,
    jobs: await prisma.job.count(),
    password: DEMO_PASSWORD,
  };
}
