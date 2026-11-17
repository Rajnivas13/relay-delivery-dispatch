import { z, type ZodType } from "zod";
import { PERMISSIONS, type Permission } from "@/auth/permissions";
import {
  AssignSchema,
  AvailabilitySchema,
  CreateJobSchema,
  ReasonSchema,
  RiderCreateSchema,
  RiderUpdateSchema,
  SettingsPatchSchema,
  TokenCreateSchema,
  UserCreateSchema,
  UserUpdateSchema,
} from "./schemas";

const ERROR_CODES: Record<string, string> = {
  "400": "VALIDATION_ERROR, OVERRIDE_REASON_REQUIRED",
  "401": "UNAUTHENTICATED: missing/invalid session or token",
  "403": "FORBIDDEN: role or token scope does not allow this, or rider is not the owner",
  "404": "NOT_FOUND",
  "409": "CONFLICT, STALE_VERSION, INVALID_TRANSITION, ASSIGNMENT_EXPIRED, ASSIGNMENT_NOT_PENDING, RIDER_NOT_ELIGIBLE, RIDER_CAPACITY_CONFLICT, IDEMPOTENCY_CONFLICT",
  "422": "NO_ELIGIBLE_RIDER",
  "429": "RATE_LIMITED",
};

const schema = (s: ZodType) => z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;

interface Op {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  tag: string;
  summary: string;
  description?: string;
  permission?: Permission | Permission[];
  body?: ZodType;
  query?: { name: string; description: string; schema?: Record<string, unknown> }[];
  headers?: { name: string; description: string; required?: boolean }[];
  success?: string;
  errors?: string[];
  security?: "cron" | "none";
}

const OPS: Op[] = [
  { method: "get", path: "/api/health", tag: "System", summary: "Health check", security: "none" },
  {
    method: "get",
    path: "/api/cron/expire-assignments",
    tag: "System",
    summary: "Expire overdue assignments (Vercel Cron)",
    description: "Called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`. Idempotent and safe to run concurrently with lazy sweeps.",
    security: "cron",
    errors: ["401"],
  },
  { method: "get", path: "/api/me", tag: "Auth", summary: "Current principal and effective permissions", permission: "docs:read" },
  {
    method: "get",
    path: "/api/jobs",
    tag: "Jobs",
    summary: "List and filter jobs",
    permission: "jobs:read",
    query: [
      { name: "status", description: "Comma-separated statuses, e.g. MANUAL_QUEUE,AWAITING_CONFIRMATION" },
      { name: "zone", description: "Pickup or drop zone id" },
      { name: "priority", description: "LOW | NORMAL | HIGH | URGENT" },
      { name: "q", description: "Search reference, id or customer" },
      { name: "page", description: "1-based page (default 1)" },
      { name: "pageSize", description: "1-100 (default 25)" },
    ],
  },
  {
    method: "post",
    path: "/api/jobs",
    tag: "Jobs",
    summary: "Create a job (idempotent)",
    description:
      "Returns 201 on creation. Replaying the same Idempotency-Key or reference with the same body returns the original job with 200 and `Idempotent-Replayed: true`. A different body returns 409.",
    permission: "jobs:write",
    body: CreateJobSchema,
    headers: [{ name: "Idempotency-Key", description: "8-128 chars, unique per logical request" }],
    success: "201",
    errors: ["400", "409"],
  },
  { method: "get", path: "/api/jobs/{id}", tag: "Jobs", summary: "Get a job with all assignment attempts", description: "`id` may be the job id or its reference.", permission: "jobs:read", errors: ["404"] },
  { method: "get", path: "/api/jobs/{id}/events", tag: "Jobs", summary: "Chronological audit trail", permission: "jobs:read", errors: ["404"] },
  { method: "post", path: "/api/jobs/{id}/cancel", tag: "Delivery", summary: "Cancel a job (releases capacity)", permission: "jobs:write", body: ReasonSchema.extend({ expectedVersion: z.number().int().optional() }), errors: ["400", "404", "409"] },
  { method: "post", path: "/api/jobs/{id}/pickup", tag: "Delivery", summary: "Record pickup (assigned rider or dispatcher)", permission: "delivery:update", errors: ["403", "404", "409"] },
  { method: "post", path: "/api/jobs/{id}/deliver", tag: "Delivery", summary: "Record delivery (releases capacity)", permission: "delivery:update", errors: ["403", "404", "409"] },
  {
    method: "get",
    path: "/api/jobs/{id}/recommendations",
    tag: "Recommendations",
    summary: "Eligible riders, ranked, with reasons",
    description:
      "Hard rules filter riders; a deterministic score (travel, capacity, workload, deadline, reliability) ranks them; with `ai=true` the top 5 are re-ranked by the OpenRouter model, which predicts acceptance probability. Falls back to the score order if the AI fails.",
    permission: ["jobs:read", "jobs:assign"],
    query: [{ name: "ai", description: "true (default) or false" }],
    errors: ["404"],
  },
  {
    method: "post",
    path: "/api/jobs/{id}/assign",
    tag: "Assignment",
    summary: "Assign or reassign an eligible rider",
    description:
      "Reserves capacity atomically and creates a PENDING assignment that expires after the configured threshold. Choosing someone other than the recommended rider requires `overrideReason`. Concurrent assigns: exactly one wins, others get 409.",
    permission: "jobs:assign",
    body: AssignSchema,
    success: "201",
    errors: ["400", "404", "409"],
  },
  { method: "post", path: "/api/jobs/{id}/release", tag: "Assignment", summary: "Take a job back from its rider (before pickup)", permission: "jobs:assign", body: ReasonSchema, errors: ["404", "409"] },
  { method: "post", path: "/api/jobs/{id}/suggestion", tag: "Manual queue", summary: "AI next-action suggestion for a stuck job", permission: "ai:use", errors: ["404"] },
  {
    method: "post",
    path: "/api/assignments/{id}/accept",
    tag: "Confirmation",
    summary: "Rider accepts a pending assignment",
    description: "Riders may only accept their own offers. After the deadline the timeout is committed first and 409 ASSIGNMENT_EXPIRED is returned.",
    permission: "assignments:respond",
    errors: ["403", "404", "409"],
  },
  { method: "post", path: "/api/assignments/{id}/reject", tag: "Confirmation", summary: "Rider rejects (job moves to Manual Queue)", permission: "assignments:respond", body: ReasonSchema, errors: ["400", "403", "404", "409"] },
  { method: "get", path: "/api/manual-queue", tag: "Manual queue", summary: "Jobs needing intervention, oldest first", permission: "jobs:read" },
  { method: "get", path: "/api/riders", tag: "Riders", summary: "List riders with capacity and workload", permission: "riders:read" },
  { method: "post", path: "/api/riders", tag: "Riders", summary: "Create a rider", permission: "riders:write", body: RiderCreateSchema, success: "201", errors: ["400", "409"] },
  { method: "get", path: "/api/riders/{id}", tag: "Riders", summary: "Rider detail (id or code)", permission: "riders:read", errors: ["404"] },
  { method: "patch", path: "/api/riders/{id}", tag: "Riders", summary: "Update rider (availability, zones, capacity)", permission: "riders:write", body: RiderUpdateSchema, errors: ["400", "404", "409"] },
  { method: "get", path: "/api/riders/{id}/offers", tag: "Riders", summary: "Rider app feed (own profile only for riders)", permission: ["riders:read", "rider:self"], errors: ["403", "404"] },
  { method: "patch", path: "/api/me/availability", tag: "Riders", summary: "Rider sets own availability", permission: "rider:self", body: AvailabilitySchema },
  { method: "get", path: "/api/zones", tag: "Riders", summary: "Service zones", permission: ["jobs:read", "rider:self"] },
  { method: "get", path: "/api/dashboard/summary", tag: "Dashboard", summary: "KPIs and needs-attention lists", permission: "dashboard:read" },
  { method: "get", path: "/api/settings", tag: "Settings", summary: "Timeout threshold, simulated clock, last sweep", permission: "settings:read" },
  {
    method: "patch",
    path: "/api/settings",
    tag: "Settings",
    summary: "Change timeout or move the simulated clock",
    description: "`advanceClockSeconds` moves the clock forward and triggers a sweep immediately.",
    permission: "settings:write",
    body: SettingsPatchSchema,
    errors: ["400"],
  },
  { method: "post", path: "/api/admin/sweep", tag: "Settings", summary: "Run the timeout sweep now", permission: ["settings:write", "jobs:assign"] },
  { method: "post", path: "/api/admin/seed", tag: "Admin", summary: "Reset and load demo data (ALLOW_SEED=true only)", permission: "settings:write", errors: ["403"] },
  { method: "get", path: "/api/admin/users", tag: "Admin", summary: "List users", permission: "users:manage" },
  { method: "post", path: "/api/admin/users", tag: "Admin", summary: "Create user", permission: "users:manage", body: UserCreateSchema, success: "201", errors: ["400", "409"] },
  { method: "patch", path: "/api/admin/users/{id}", tag: "Admin", summary: "Update role, status or password", permission: "users:manage", body: UserUpdateSchema, errors: ["400", "404", "409"] },
  { method: "get", path: "/api/admin/api-tokens", tag: "Admin", summary: "List API tokens", permission: "tokens:manage" },
  { method: "post", path: "/api/admin/api-tokens", tag: "Admin", summary: "Create API token (plain value returned once)", permission: "tokens:manage", body: TokenCreateSchema, success: "201" },
  { method: "delete", path: "/api/admin/api-tokens/{id}", tag: "Admin", summary: "Revoke API token", permission: "tokens:manage", errors: ["404"] },
];

const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" }, details: {} },
    },
  },
};

export function buildOpenApi(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPS) {
    const perms = op.permission ? (Array.isArray(op.permission) ? op.permission : [op.permission]) : [];
    const roles = [...new Set(perms.flatMap((p) => PERMISSIONS[p]))];
    const params = [
      ...(op.path.includes("{id}") ? [{ name: "id", in: "path", required: true, schema: { type: "string" } }] : []),
      ...(op.query ?? []).map((q) => ({ name: q.name, in: "query", required: false, description: q.description, schema: q.schema ?? { type: "string" } })),
      ...(op.headers ?? []).map((h) => ({ name: h.name, in: "header", required: h.required ?? false, description: h.description, schema: { type: "string" } })),
    ];
    const errors = ["401", "403", ...(op.errors ?? [])].filter((c, i, a) => a.indexOf(c) === i && (op.security !== "none" || !["401", "403"].includes(c)));
    paths[op.path] ??= {};
    paths[op.path][op.method] = {
      tags: [op.tag],
      summary: op.summary,
      description: [op.description, perms.length ? `**Permission:** ${perms.join(" or ")} (roles: ${roles.join(", ")})` : null].filter(Boolean).join("\n\n"),
      parameters: params,
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: schema(op.body) } } } } : {}),
      security: op.security === "none" ? [] : op.security === "cron" ? [{ cronSecret: [] }] : [{ sessionCookie: [] }, { bearerToken: [] }],
      responses: {
        [op.success ?? "200"]: { description: "Success", content: { "application/json": { schema: { type: "object" } } } },
        ...Object.fromEntries(
          errors.map((code) => [code, { description: ERROR_CODES[code] ?? "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }]),
        ),
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Project RELAY Dispatch API",
      version: "1.0.0",
      description:
        "REST API for the RELAY dispatch desk. Authenticate with the browser session cookie (sign in at /login) or an API token: `Authorization: Bearer relay_...`. All errors use `{ error: { code, message, details } }`.",
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "authjs.session-token" },
        bearerToken: { type: "http", scheme: "bearer", description: "API token created under Admin > API tokens" },
        cronSecret: { type: "http", scheme: "bearer", description: "CRON_SECRET (Vercel Cron only)" },
      },
      schemas: { Error: errorSchema },
    },
    paths,
  };
}
