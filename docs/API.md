# RELAY API

Base URL: `http://localhost:3000/api` locally, or `https://<your-app>.vercel.app/api` when deployed.
Interactive reference: open `/docs` in the running app. It is generated from the same Zod schemas the handlers validate with (`GET /api/openapi` returns the OpenAPI 3.1 document).

All requests and responses are JSON. Timestamps are ISO-8601 UTC strings. Business times (`createdAt` of events, `offeredAt`, `expiresAt`) use the **application clock**, which equals wall-clock time unless an admin has advanced the simulated clock.

## Authentication

Every endpoint except `GET /api/health`, `/api/auth/*` and the cron endpoint requires a caller.

| Method | How | Use for |
| --- | --- | --- |
| Session cookie | Sign in at `/login` (Auth.js credentials, 8 h JWT session) | The web UI |
| API token | `Authorization: Bearer relay_xxxxxxxx...` | Scripts, integrations, rider devices |

An admin creates API tokens under **Admin → API tokens** (`POST /api/admin/api-tokens`). The plain token is shown once; only its SHA-256 hash is stored. A token acts as the user who created it, narrowed to its **scopes**: `*` grants everything the user's role allows, and a list such as `["jobs:read"]` grants only those permissions. Revoking a token or deactivating its user takes effect on the next request, because the user row is re-read every time.

The actor recorded in the audit trail always comes from the authenticated principal. Fields such as `actorId` in a request body are ignored.

Sign-in is rate limited: 5 failed attempts per email and 20 per IP in 15 minutes.

### Roles and permissions

| Permission | Admin | Dispatcher | Viewer | Rider |
| --- | :-: | :-: | :-: | :-: |
| `dashboard:read`, `jobs:read`, `riders:read` | ✓ | ✓ | ✓ | |
| `jobs:write`, `jobs:assign`, `riders:write`, `ai:use` | ✓ | ✓ | | |
| `assignments:respond`, `delivery:update` | ✓ | ✓ | | ✓ (own assignments only) |
| `rider:self` | | | | ✓ |
| `settings:read`, `docs:read` | ✓ | ✓ | ✓ | ✓ |
| `settings:write`, `users:manage`, `tokens:manage` | ✓ | | | |

Riders are additionally restricted by ownership in the service layer: they can only accept, reject, pick up or deliver assignments that belong to their own rider profile, and only read their own offers.

## Errors

Every error uses one shape:

```json
{
  "error": {
    "code": "RIDER_NOT_ELIGIBLE",
    "message": "This rider cannot take the job",
    "details": { "riderId": "cm...", "reasons": ["Rider is offline", "Needs 5 capacity units but only 2 free"] }
  }
}
```

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Malformed JSON, or a field failed validation. `details` is a list of `{ path, message }`. |
| 400 | `OVERRIDE_REASON_REQUIRED` | Assigning someone other than the recommended rider without `overrideReason` (at least 3 characters). `details.recommendedRiderId` is included. |
| 401 | `UNAUTHENTICATED` | No session or token, or the token is unknown, revoked, or belongs to a deactivated user. Also a wrong cron secret. |
| 403 | `FORBIDDEN` | The role or token scope lacks the permission, or a rider is acting on someone else's assignment. |
| 403 | `FEATURE_DISABLED` | Seeding when `ALLOW_SEED` is not `true`. |
| 404 | `NOT_FOUND` | The job, rider, assignment, user or token does not exist. |
| 409 | `CONFLICT` | The job already has a live assignment (a concurrent assign lost the race), a duplicate reference with a different body, or a uniqueness violation. |
| 409 | `STALE_VERSION` | `expectedVersion` does not match. Reload and retry. |
| 409 | `INVALID_TRANSITION` | The state machine forbids the action, for example delivering before pickup or acting on a cancelled job. |
| 409 | `ASSIGNMENT_EXPIRED` | Accept or reject after the confirmation window. The timeout has been committed and the job is now in the Manual Queue. |
| 409 | `ASSIGNMENT_NOT_PENDING` | Responding to an assignment that was already accepted, rejected or cancelled. |
| 409 | `RIDER_NOT_ELIGIBLE` | The chosen rider fails a hard rule. `details.reasons` explains why. |
| 409 | `RIDER_CAPACITY_CONFLICT` | The rider's capacity was taken by a concurrent assignment. |
| 409 | `IDEMPOTENCY_CONFLICT` | An `Idempotency-Key` was reused with a different request body. |
| 429 | `RATE_LIMITED` | Too many failed sign-ins. |
| 500 | `INTERNAL_ERROR` | Unexpected. The details are logged server-side and never returned. |

## Idempotency and concurrency

- **Job creation** accepts an `Idempotency-Key` header (8 to 128 characters). Retrying with the same key and body returns the original job with **200** and the header `Idempotent-Replayed: true`; the first call returns **201**. The same key with a different body returns `409 IDEMPOTENCY_CONFLICT`. A client-supplied `reference` is also unique and works the same way: same body returns the original, a different body returns `409 CONFLICT`. Unique indexes back both checks, so simultaneous identical requests create one job.
- **Optimistic concurrency.** Jobs and riders carry a `version` that increments on every change. Assign, cancel and rider updates accept an optional `expectedVersion` and return `409 STALE_VERSION` on a mismatch. The UI sends it so a dispatcher never acts on a stale screen.
- **Pessimistic locking.** Every job mutation runs in a transaction that locks the job row (`SELECT ... FOR UPDATE`) and first expires that job's overdue offer if there is one, so a late accept can never beat a due timeout. Two dispatchers assigning the same job are serialized: one gets 201, the other `409 CONFLICT`.

## Resources

### Jobs

#### `POST /api/jobs` (`jobs:write`)

Creates a job and triages it. It becomes `READY_FOR_ASSIGNMENT` if at least one rider is eligible, otherwise it goes straight to `MANUAL_QUEUE` with reason `NO_ELIGIBLE_RIDER`.

Headers: `Idempotency-Key: <8-128 chars>` (recommended).

| Field | Type | Notes |
| --- | --- | --- |
| `reference` | string, optional | 3 to 64 characters `[A-Za-z0-9._-]`, unique. Auto-generated (`ORD-YYMMDD-XXXXXX`) if omitted. |
| `pickupZoneId` | string | Must be a known zone (`GET /api/zones`) |
| `dropZoneId` | string | Must be a known zone |
| `loadUnits` | integer 1 to 100 | Capacity units needed |
| `priority` | `LOW` \| `NORMAL` \| `HIGH` \| `URGENT` | Default `NORMAL` |
| `deadlineAt` | ISO datetime, optional | Must be in the future |
| `customerName` | string, optional | Up to 120 characters |
| `notes` | string, optional | Up to 500 characters |

```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 7f1c2a9e-order-2001" \
  -d '{"reference":"ORD-2001","pickupZoneId":"CENTRAL","dropZoneId":"NORTH","loadUnits":2,"priority":"HIGH","deadlineAt":"2026-11-17T12:00:00Z"}'
```

`201 Created` (or `200` with `Idempotent-Replayed: true` on a replay):

```json
{
  "id": "cmwk906lp0000tp2s9mnty8r0",
  "reference": "ORD-2001",
  "status": "READY_FOR_ASSIGNMENT",
  "priority": "HIGH",
  "pickupZoneId": "CENTRAL",
  "dropZoneId": "NORTH",
  "loadUnits": 2,
  "deadlineAt": "2026-11-17T12:00:00.000Z",
  "manualQueueReason": null,
  "currentAssignmentId": null,
  "version": 1,
  "createdAt": "2026-11-17T10:46:12.000Z"
}
```

#### `GET /api/jobs` (`jobs:read`)

Query parameters: `status` (comma-separated, for example `MANUAL_QUEUE,AWAITING_CONFIRMATION`), `zone` (matches pickup or drop), `priority`, `q` (reference, id or customer, case-insensitive), `page` (default 1), `pageSize` (default 25, max 100).

```json
{
  "items": [ { "id": "...", "reference": "ORD-1003", "status": "AWAITING_CONFIRMATION", "latestAssignment": { "riderId": "...", "status": "PENDING", "expiresAt": "...", "rider": { "code": "R-004", "name": "Sneha Iyer" } } } ],
  "page": 1, "pageSize": 25, "total": 12, "totalPages": 1
}
```

#### `GET /api/jobs/{idOrReference}` (`jobs:read`)

Returns the job with every assignment attempt (newest first, each including its rider) and `currentAssignment`. Both the internal id and the order reference are accepted.

#### `GET /api/jobs/{idOrReference}/events` (`jobs:read`)

The append-only audit trail in chronological order.

```json
[
  { "id": 101, "type": "JOB_CREATED", "toStatus": "NEW", "actorType": "USER", "actorName": "Dev Dispatcher", "createdAt": "...", "details": { "reference": "ORD-2001", "idempotencyKey": "7f1c..." } },
  { "id": 102, "type": "STATUS_CHANGED", "fromStatus": "NEW", "toStatus": "READY_FOR_ASSIGNMENT", "actorType": "SYSTEM", "details": { "eligibleRiders": 4 } },
  { "id": 103, "type": "RECOMMENDATION_GENERATED", "details": { "strategy": "AI_RERANK", "model": "openai/gpt-4o-mini", "top": [ { "code": "R-002", "score": 85.7, "acceptProbability": 0.82 } ] } },
  { "id": 104, "type": "RIDER_ASSIGNED", "fromStatus": "READY_FOR_ASSIGNMENT", "toStatus": "AWAITING_CONFIRMATION", "assignmentId": "...", "details": { "riderCode": "R-010", "score": 82, "expiresAt": "...", "timeoutSeconds": 7200, "reservedUnits": 2, "attempt": 1 } },
  { "id": 105, "type": "MANUAL_OVERRIDE", "details": { "recommendedRiderId": "...", "chosenRiderId": "...", "reason": "Customer requested this rider" } },
  { "id": 106, "type": "ASSIGNMENT_TIMEOUT", "actorType": "CRON", "details": { "riderCode": "R-010", "thresholdSeconds": 7200, "releasedUnits": 2 } },
  { "id": 107, "type": "MOVED_TO_MANUAL_QUEUE", "fromStatus": "AWAITING_CONFIRMATION", "toStatus": "MANUAL_QUEUE", "details": { "reason": "CONFIRMATION_TIMEOUT" } }
]
```

The event types are `JOB_CREATED`, `STATUS_CHANGED`, `RECOMMENDATION_GENERATED`, `RIDER_ASSIGNED`, `RIDER_REASSIGNED`, `MANUAL_OVERRIDE`, `RIDER_CONFIRMED`, `RIDER_REJECTED`, `ASSIGNMENT_TIMEOUT`, `ASSIGNMENT_RELEASED`, `MOVED_TO_MANUAL_QUEUE`, `PICKED_UP`, `DELIVERED`, `CANCELLED` and `AI_SUGGESTION`. The actor types are `USER`, `API_TOKEN`, `SYSTEM` (lazy sweep and triage) and `CRON`.

#### `GET /api/jobs/{id}/recommendations?ai=true|false` (`jobs:read` or `jobs:assign`)

Returns eligible riders ranked best first, plus the riders excluded and why. Admins and dispatchers get AI re-ranking when `OPENROUTER_API_KEY` is set and `ai` is not `false`. Every response from the AI is validated; anything invalid falls back to the score order with `usedFallback: true` and a `fallbackReason`. Results are cached for 5 minutes per job version and candidate set.

```json
{
  "jobId": "...", "reference": "ORD-1001", "jobStatus": "READY_FOR_ASSIGNMENT", "assignable": true,
  "strategy": "AI_RERANK", "aiEnabled": true, "usedFallback": false, "fallbackReason": null,
  "model": "openai/gpt-4o-mini", "latencyMs": 1430, "cached": false,
  "summary": "Priya is closest with spare capacity; Meera is the most reliable backup.",
  "riskNote": null,
  "recommendedRiderId": "cm...priya", "scoreTopRiderId": "cm...priya",
  "candidates": [
    {
      "riderId": "cm...priya", "code": "R-002", "name": "Priya Sharma",
      "rank": 1, "finalRank": 1, "score": 85.7,
      "etaToPickupMinutes": 8, "etaTotalMinutes": 28, "freeUnitsAfter": 7,
      "activeJobs": 0, "maxActiveJobs": 3, "acceptProbability": 0.79,
      "breakdown": [
        { "key": "travel", "label": "Travel time", "points": 30.3, "max": 35, "detail": "8 min to pickup from CENTRAL" },
        { "key": "capacity", "label": "Spare capacity", "points": 14, "max": 20, "detail": "7/10 units free after this job" },
        { "key": "workload", "label": "Workload", "points": 20, "max": 20, "detail": "0/3 active jobs" },
        { "key": "deadline", "label": "Deadline fit", "points": 15, "max": 15, "detail": "No delivery deadline" },
        { "key": "reliability", "label": "Reliability", "points": 7.9, "max": 10, "detail": "79% historical acceptance (37/47)" }
      ],
      "reasons": ["0/3 active jobs", "No delivery deadline", "8 min to pickup from CENTRAL"],
      "warnings": [],
      "ai": { "riderId": "cm...priya", "acceptProbability": 0.84, "etaMinutes": 27, "reason": "Closest rider, idle, accepts most offers." }
    }
  ],
  "ineligible": [ { "riderId": "...", "code": "R-007", "name": "...", "reasons": ["Rider is offline"] } ]
}
```

Hard rules (a rider failing any of them is listed in `ineligible`, and assigning them returns `RIDER_NOT_ELIGIBLE` even with an override): the rider must be `ONLINE`, service both the pickup and drop zones, have `capacityUnits - reservedUnits >= loadUnits`, be below `maxActiveJobs`, and not have rejected this job before. See [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md#rider-recommendation) for the scoring formula.

#### `POST /api/jobs/{id}/assign` (`jobs:assign`)

Assigns a rider to a job in `READY_FOR_ASSIGNMENT` or `MANUAL_QUEUE`. A job in the Manual Queue counts as a reassignment. The call reserves the rider's capacity, creates a `PENDING` assignment with `expiresAt = now + confirmationTimeoutSeconds`, and moves the job to `AWAITING_CONFIRMATION`.

```json
{ "riderId": "cm...", "overrideReason": "Customer requested this rider", "expectedVersion": 3 }
```

`overrideReason` is required when `riderId` differs from the latest recommendation shown for the job (or from the live score leader if no recommendation was generated in the last 30 minutes).

`201`:

```json
{ "job": { "status": "AWAITING_CONFIRMATION", "currentAssignmentId": "...", "version": 4 }, "assignment": { "id": "...", "status": "PENDING", "offeredAt": "...", "expiresAt": "...", "reservedUnits": 2, "isOverride": true, "overrideReason": "..." }, "isOverride": true }
```

Errors: `CONFLICT` (already assigned), `INVALID_TRANSITION`, `RIDER_NOT_ELIGIBLE`, `RIDER_CAPACITY_CONFLICT`, `OVERRIDE_REASON_REQUIRED`, `STALE_VERSION`.

#### `POST /api/jobs/{id}/release` (`jobs:assign`)

Body: `{ "reason": "Rider's bike broke down" }`. Takes the job away from its rider while it is `AWAITING_CONFIRMATION` or `ACCEPTED` (before pickup). The assignment is marked `CANCELLED`, capacity is released, and the job goes to the Manual Queue with reason `RELEASED_BY_DISPATCHER`.

#### `POST /api/jobs/{id}/pickup` and `POST /api/jobs/{id}/deliver` (`delivery:update`)

No body. Pickup requires `ACCEPTED` and delivery requires `PICKED_UP`; anything else returns `INVALID_TRANSITION`. Riders may only call these for their own assignment. Delivery completes the assignment, releases capacity and moves the rider's current zone to the drop zone.

#### `POST /api/jobs/{id}/cancel` (`jobs:write`)

Body: `{ "reason": "Customer cancelled", "expectedVersion": 5 }`. This is allowed from any state before `PICKED_UP`. Any live assignment is cancelled and its capacity released.

#### `POST /api/jobs/{id}/suggestion` (`ai:use`)

This is the next-action helper for jobs in the Manual Queue. It returns one of `REASSIGN` (with a rider), `WAIT`, `CANCEL` or `ESCALATE`, together with a rationale and a confidence. The source is `AI` or `RULES`; the rules are the fallback when the AI is off or invalid. The suggestion is advisory only and is logged as an `AI_SUGGESTION` event.

```json
{ "action": "REASSIGN", "riderId": "cm...", "riderCode": "R-010", "riderName": "Lakshmi Pillai", "rationale": "...", "confidence": 0.78, "source": "AI", "model": "openai/gpt-4o-mini" }
```

### Assignments (rider confirmation)

#### `POST /api/assignments/{assignmentId}/accept` (`assignments:respond`)

Moves the job from `AWAITING_CONFIRMATION` to `ACCEPTED`. Returns `{ job, assignment }`. If the window has passed, the timeout is committed and the call returns `409 ASSIGNMENT_EXPIRED`.

#### `POST /api/assignments/{assignmentId}/reject` (`assignments:respond`)

Body: `{ "reason": "Vehicle issue" }`. Marks the assignment `REJECTED`, releases capacity and moves the job to `MANUAL_QUEUE` with reason `RIDER_REJECTED`. That rider becomes ineligible for this job.

### Manual queue

#### `GET /api/manual-queue` (`jobs:read`)

Lists jobs in `MANUAL_QUEUE`, oldest first, each with `manualQueueReason` (`CONFIRMATION_TIMEOUT`, `RIDER_REJECTED`, `NO_ELIGIBLE_RIDER` or `RELEASED_BY_DISPATCHER`), `attempts`, `lastAssignment` (with rider) and `waitingSeconds`. To reassign, call `GET /recommendations`, then `POST /assign`.

### Riders

| Endpoint | Permission | Description |
| --- | --- | --- |
| `GET /api/riders` | `riders:read` | All riders with `zoneIds`, `availability`, `capacityUnits`, `reservedUnits`, `freeUnits`, `activeJobCount`, `maxActiveJobs`, and their live assignments with job summaries |
| `GET /api/riders/{idOrCode}` | `riders:read` | One rider (by id or code such as `R-004`) |
| `POST /api/riders` | `riders:write` | Create: `{ name, phone?, availability?, currentZoneId, zoneIds[], capacityUnits, maxActiveJobs?, code? }` |
| `PATCH /api/riders/{id}` | `riders:write` | Partial update, including `expectedVersion`. Capacity cannot drop below the units already reserved, and `maxActiveJobs` cannot drop below the active job count. |
| `GET /api/riders/{id}/offers` | `riders:read`, or `rider:self` for their own profile | Rider app feed: `{ rider, now, active: [assignment + job + secondsLeft], recent: [...] }` |
| `GET /api/me` | any | The current principal and, for riders, their profile |
| `PATCH /api/me/availability` | `rider:self` | `{ "availability": "ONLINE" \| "OFFLINE" \| "ON_BREAK" }` |
| `GET /api/zones` | `jobs:read` or `rider:self` | Service zones |

### Dashboard and settings

| Endpoint | Permission | Description |
| --- | --- | --- |
| `GET /api/dashboard/summary` | `dashboard:read` | KPIs, counts by status, open jobs per zone, rider capacity, and the *Needs attention* lists (Manual Queue, pending offers inside the last quarter of their window (at least 1 minute), deadlines under 60 minutes, jobs ready for more than 10 minutes), plus the last sweep |
| `GET /api/settings` | `settings:read` | `confirmationTimeoutSeconds`, `clockOffsetSeconds`, application `now`, `realNow`, `lastSweep`, `aiEnabled`, `aiModel`, `allowSeed` |
| `PATCH /api/settings` | `settings:write` | Any of `{ confirmationTimeoutSeconds (10 to 604800), clockOffsetSeconds, advanceClockSeconds }`. Moving the clock triggers an immediate sweep. |
| `POST /api/admin/sweep` | `settings:write` or `jobs:assign` | Runs the timeout sweep now. Returns `{ checked, expired, skippedLocked, expiredAssignmentIds, at, source }`. |
| `POST /api/admin/seed` | `settings:write` | Resets to the demo scenario. Requires `ALLOW_SEED=true`. |
| `GET/POST /api/admin/users`, `PATCH /api/admin/users/{id}` | `users:manage` | Manage logins: `{ email, name, password, role, riderId? }`. Rider accounts must link to a rider. The last active admin cannot be removed. |
| `GET/POST /api/admin/api-tokens`, `DELETE /api/admin/api-tokens/{id}` | `tokens:manage` | `POST { name, scopes: ["*"] \| ["jobs:read", ...] }` returns the plain token once. `DELETE` revokes it. |

### System

| Endpoint | Auth | Description |
| --- | --- | --- |
| `GET /api/health` | public | `{ status, database, time }` |
| `GET /api/cron/expire-assignments` | `Authorization: Bearer $CRON_SECRET` | Vercel Cron entry point. Runs the same sweep as the lazy path and returns `{ checked, expired, skippedLocked, durationMs, ... }`. |
| `GET /api/openapi` | `docs:read` | OpenAPI 3.1 document |

## Job state machine

```
NEW ──► READY_FOR_ASSIGNMENT ──► AWAITING_CONFIRMATION ──► ACCEPTED ──► PICKED_UP ──► DELIVERED
 │            │      ▲                   │                   │
 │            │      └──── assign ───────┤ timeout / reject  │ release
 │            ▼                          ▼                   ▼
 │       MANUAL_QUEUE ◄──────────────────┴───────────────────┘
 │            │ assign (reassign) ──► AWAITING_CONFIRMATION
 ▼            ▼
CANCELLED ◄── (from any state before PICKED_UP)
```

`DELIVERED` and `CANCELLED` are terminal. Every other transition returns `409 INVALID_TRANSITION`.

## End-to-end example (curl)

```bash
H="Authorization: Bearer $TOKEN"; J="Content-Type: application/json"
JOB=$(curl -s -X POST localhost:3000/api/jobs -H "$H" -H "$J" -H "Idempotency-Key: demo-0001" \
  -d '{"pickupZoneId":"CENTRAL","dropZoneId":"NORTH","loadUnits":1}' | jq -r .id)
RIDER=$(curl -s "localhost:3000/api/jobs/$JOB/recommendations" -H "$H" | jq -r .recommendedRiderId)
ASG=$(curl -s -X POST "localhost:3000/api/jobs/$JOB/assign" -H "$H" -H "$J" -d "{\"riderId\":\"$RIDER\"}" | jq -r .assignment.id)
curl -s -X POST "localhost:3000/api/assignments/$ASG/accept" -H "$H"
curl -s -X POST "localhost:3000/api/jobs/$JOB/pickup" -H "$H"
curl -s -X POST "localhost:3000/api/jobs/$JOB/deliver" -H "$H"
curl -s "localhost:3000/api/jobs/$JOB/events" -H "$H" | jq '.[].type'
```
