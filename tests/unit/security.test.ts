import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isValidCronRequest } from "@/auth/cronAuth";
import { can, roleHas } from "@/auth/permissions";

describe("permissions", () => {
  it("gives each role the expected access", () => {
    expect(roleHas("DISPATCHER", "jobs:assign")).toBe(true);
    expect(roleHas("VIEWER", "jobs:assign")).toBe(false);
    expect(roleHas("VIEWER", "jobs:read")).toBe(true);
    expect(roleHas("RIDER", "jobs:read")).toBe(false);
    expect(roleHas("RIDER", "assignments:respond")).toBe(true);
    expect(roleHas("DISPATCHER", "settings:write")).toBe(false);
    expect(roleHas("ADMIN", "users:manage")).toBe(true);
  });

  it("narrows API tokens to their scopes but never beyond the role", () => {
    expect(can({ role: "ADMIN", scopes: ["jobs:read"] }, "jobs:write")).toBe(false);
    expect(can({ role: "ADMIN", scopes: ["jobs:read"] }, "jobs:read")).toBe(true);
    expect(can({ role: "VIEWER", scopes: ["*"] }, "jobs:write")).toBe(false);
    expect(can({ role: "DISPATCHER", scopes: ["*"] }, "jobs:assign")).toBe(true);
  });
});

describe("cron authentication", () => {
  const req = (auth?: string) => new Request("http://x/api/cron/expire-assignments", { headers: auth ? { authorization: auth } : {} });
  it("requires the exact bearer secret", () => {
    expect(isValidCronRequest(req(), "s3cret")).toBe(false);
    expect(isValidCronRequest(req("Bearer wrong"), "s3cret")).toBe(false);
    expect(isValidCronRequest(req("s3cret"), "s3cret")).toBe(false);
    expect(isValidCronRequest(req("Bearer s3cret"), "s3cret")).toBe(true);
  });
  it("is closed when no secret is configured", () => {
    expect(isValidCronRequest(req("Bearer "), "")).toBe(false);
  });
});

describe("route protection", () => {
  const PUBLIC = new Set(["auth/[...nextauth]/route.ts", "health/route.ts"]);
  const CRON = new Set(["cron/expire-assignments/route.ts"]);
  const apiDir = path.resolve(__dirname, "../../src/app/api");

  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") routes.push(path.relative(apiDir, full).replace(/\\/g, "/"));
    }
  };
  walk(apiDir);

  it("finds the API routes", () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it.each(routes)("%s is protected", (route) => {
    const src = readFileSync(path.join(apiDir, route), "utf8");
    if (PUBLIC.has(route)) return;
    if (CRON.has(route)) {
      expect(src).toContain("isValidCronRequest");
      return;
    }
    const exported = [...src.matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\s*=\s*(\w+)/g)];
    expect(exported.length, `${route} should export handlers via withAuth`).toBeGreaterThan(0);
    for (const [, method, wrapper] of exported) expect(wrapper, `${method} in ${route}`).toBe("withAuth");
    expect(src).not.toMatch(/export (async )?function (GET|POST|PATCH|PUT|DELETE)/);
  });
});
