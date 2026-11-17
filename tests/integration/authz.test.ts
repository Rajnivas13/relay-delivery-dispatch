import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));

import { GET as cronGET } from "@/app/api/cron/expire-assignments/route";
import { POST as acceptPOST } from "@/app/api/assignments/[id]/accept/route";
import { POST as assignPOST } from "@/app/api/jobs/[id]/assign/route";
import { GET as jobsGET, POST as jobsPOST } from "@/app/api/jobs/route";
import { GET as offersGET } from "@/app/api/riders/[id]/offers/route";
import { PATCH as settingsPATCH } from "@/app/api/settings/route";
import { prisma } from "@/lib/db";
import { revokeApiToken } from "@/services/userService";
import { makeJob, makeRider, makeUserWithToken, resetDb } from "../helpers";

const req = (url: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
const noParams = params({});

const jobBody = { pickupZoneId: "CENTRAL", dropZoneId: "NORTH", loadUnits: 2 };

beforeEach(resetDb);

describe("API authentication", () => {
  it("rejects requests without credentials", async () => {
    const res = await jobsGET(req("/api/jobs"), noParams);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects unknown and revoked tokens", async () => {
    expect((await jobsGET(req("/api/jobs", { token: "relay_not-a-real-token" }), noParams)).status).toBe(401);
    const { token, tokenId } = await makeUserWithToken("DISPATCHER");
    expect((await jobsGET(req("/api/jobs", { token }), noParams)).status).toBe(200);
    await revokeApiToken(tokenId);
    expect((await jobsGET(req("/api/jobs", { token }), noParams)).status).toBe(401);
  });

  it("rejects tokens of deactivated users", async () => {
    const { token, user } = await makeUserWithToken("DISPATCHER");
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect((await jobsGET(req("/api/jobs", { token }), noParams)).status).toBe(401);
  });
});

describe("API authorization", () => {
  it("lets viewers read but not write", async () => {
    const { token } = await makeUserWithToken("VIEWER");
    expect((await jobsGET(req("/api/jobs", { token }), noParams)).status).toBe(200);
    const res = await jobsPOST(req("/api/jobs", { method: "POST", token, body: jobBody }), noParams);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("limits a token to its scopes", async () => {
    const { token } = await makeUserWithToken("DISPATCHER", { scopes: ["jobs:read"] });
    expect((await jobsGET(req("/api/jobs", { token }), noParams)).status).toBe(200);
    expect((await jobsPOST(req("/api/jobs", { method: "POST", token, body: jobBody }), noParams)).status).toBe(403);
  });

  it("keeps settings admin-only", async () => {
    const dispatcher = await makeUserWithToken("DISPATCHER");
    const admin = await makeUserWithToken("ADMIN");
    const body = { confirmationTimeoutSeconds: 600 };
    expect((await settingsPATCH(req("/api/settings", { method: "PATCH", token: dispatcher.token, body }), noParams)).status).toBe(403);
    expect((await settingsPATCH(req("/api/settings", { method: "PATCH", token: admin.token, body }), noParams)).status).toBe(200);
    expect((await prisma.setting.findUniqueOrThrow({ where: { id: 1 } })).confirmationTimeoutSeconds).toBe(600);
  });

  it("keeps riders out of dispatch endpoints and other riders' offers", async () => {
    const mine = await makeRider();
    const other = await makeRider();
    const { token } = await makeUserWithToken("RIDER", { riderId: mine.id });
    const job = await makeJob();

    expect((await jobsGET(req("/api/jobs", { token }), noParams)).status).toBe(403);
    expect((await assignPOST(req(`/api/jobs/${job.id}/assign`, { method: "POST", token, body: { riderId: mine.id } }), params({ id: job.id }))).status).toBe(403);
    expect((await offersGET(req(`/api/riders/${mine.id}/offers`, { token }), params({ id: mine.id }))).status).toBe(200);
    expect((await offersGET(req(`/api/riders/${other.id}/offers`, { token }), params({ id: other.id }))).status).toBe(403);
  });

  it("only lets a rider accept their own offer and records them as the actor", async () => {
    const mine = await makeRider({ code: "MINE" });
    const other = await makeRider({ code: "OTHER" });
    const me = await makeUserWithToken("RIDER", { riderId: mine.id });
    const them = await makeUserWithToken("RIDER", { riderId: other.id });
    const dispatcher = await makeUserWithToken("DISPATCHER");
    const job = await makeJob();

    const assign = await assignPOST(
      req(`/api/jobs/${job.id}/assign`, { method: "POST", token: dispatcher.token, body: { riderId: mine.id, overrideReason: "test" } }),
      params({ id: job.id }),
    );
    expect(assign.status).toBe(201);
    const { assignment } = await assign.json();

    expect((await acceptPOST(req(`/api/assignments/${assignment.id}/accept`, { method: "POST", token: them.token }), params({ id: assignment.id }))).status).toBe(403);
    expect((await acceptPOST(req(`/api/assignments/${assignment.id}/accept`, { method: "POST", token: me.token }), params({ id: assignment.id }))).status).toBe(200);

    const events = await prisma.jobEvent.findMany({ where: { jobId: job.id }, orderBy: { id: "asc" } });
    expect(events.find((e) => e.type === "RIDER_ASSIGNED")).toMatchObject({ actorType: "API_TOKEN", actorId: dispatcher.user.id });
    expect(events.find((e) => e.type === "RIDER_CONFIRMED")).toMatchObject({ actorId: me.user.id });
  });

  it("ignores actor fields supplied in the body", async () => {
    await makeRider();
    const { token, user } = await makeUserWithToken("DISPATCHER");
    const res = await jobsPOST(req("/api/jobs", { method: "POST", token, body: { ...jobBody, actorId: "evil", createdById: "evil" } }), noParams);
    expect(res.status).toBe(201);
    const job = await res.json();
    expect(job.createdById).toBe(user.id);
  });
});

describe("job creation over HTTP", () => {
  it("replays an idempotent request with 200 and the replay header", async () => {
    await makeRider();
    const { token } = await makeUserWithToken("DISPATCHER");
    const headers = { "idempotency-key": "http-key-0001" };
    const first = await jobsPOST(req("/api/jobs", { method: "POST", token, body: jobBody, headers }), noParams);
    const second = await jobsPOST(req("/api/jobs", { method: "POST", token, body: jobBody, headers }), noParams);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
    expect((await second.json()).id).toBe((await first.json()).id);

    const changed = await jobsPOST(req("/api/jobs", { method: "POST", token, body: { ...jobBody, loadUnits: 5 }, headers }), noParams);
    expect(changed.status).toBe(409);
  });

  it("returns 400 with field issues for invalid input", async () => {
    const { token } = await makeUserWithToken("DISPATCHER");
    const res = await jobsPOST(req("/api/jobs", { method: "POST", token, body: { pickupZoneId: "CENTRAL", loadUnits: -1 } }), noParams);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("cron endpoint", () => {
  it("requires the cron secret and runs the sweep", async () => {
    expect((await cronGET(req("/api/cron/expire-assignments"))).status).toBe(401);
    expect((await cronGET(req("/api/cron/expire-assignments", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    const { token } = await makeUserWithToken("ADMIN");
    expect((await cronGET(req("/api/cron/expire-assignments", { token }))).status).toBe(401);

    const ok = await cronGET(req("/api/cron/expire-assignments", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ source: "cron", expired: 0 });
  });
});
