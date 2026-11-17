# RELAY: Delivery Dispatch Desk

RELAY helps an operations team move delivery jobs from intake to doorstep. It recommends riders with an explainable score that AI refines, lets dispatchers assign or override with a recorded reason, and automatically sends an offer to the **Manual Queue** when a rider does not confirm within the configured threshold (2 hours by default). Every step is written to an append-only audit trail.

| Document | What it covers |
| --- | --- |
| [docs/API.md](docs/API.md) | Every endpoint, payloads, errors, auth, idempotency |
| [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) | Architecture, data model, workflows, concurrency |
| [docs/ENGINEERING_NOTES.md](docs/ENGINEERING_NOTES.md) | Assumptions, limitations, next improvements |
| [docs/one-pager.pdf](docs/one-pager.pdf) | One-page solution summary (source: `docs/one-pager.html`) |
| `/docs` in the running app | Interactive OpenAPI reference (Scalar) |

## Stack

Next.js 15 (App Router, route handlers), TypeScript, PostgreSQL 16, Prisma 6, Auth.js v5, Tailwind CSS v4, TanStack Query, Zod 4, OpenRouter (optional), Vitest and Playwright. It deploys as a single app on Vercel with Neon Postgres and Vercel Cron.

## Prerequisites

- Node.js 20.18 or newer (developed on Node 22)
- Docker Desktop, for the local Postgres container. Any Postgres 14+ works if you point the URLs at it.

## Quick start

```bash
cd relay
npm install                    # also runs prisma generate
cp .env.example .env           # Windows: copy .env.example .env
#   set AUTH_SECRET and CRON_SECRET to random strings (npx auth secret)
#   optionally set OPENROUTER_API_KEY to turn on AI re-ranking
npm run db:up                  # Postgres 16 on localhost:5433 (+ relay_test database)
npm run db:migrate             # apply migrations
npm run db:seed                # zones, travel matrix, 15 riders, 9 users, 12 jobs in every state
npm run dev                    # http://localhost:3000
```

Sign in with any demo account. The password for all of them is **`Relay@123`**, and the login page has one-click buttons for each.

| Account | Role | Can do |
| --- | --- | --- |
| `admin@relay.dev` | Admin | Everything, including settings, the simulated clock, users and API tokens |
| `dispatcher@relay.dev`, `ops2@relay.dev` | Dispatcher | Create, assign, override, reassign, cancel, and simulate rider actions |
| `viewer@relay.dev` | Viewer | Read-only dashboard, jobs and riders |
| `arjun@`, `priya@`, `rahul@`, `sneha@`, `vikram@relay.dev` | Rider | Only their own offers and deliveries, in the mobile rider app |

To reset the demo data at any time, run `npm run db:seed` again. With `ALLOW_SEED=true` you can also use **Settings → Reset demo data** as an admin. No manual database edits are ever needed.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection. On Neon use the pooled URL. |
| `DIRECT_URL` | yes | Non-pooled URL that Prisma migrations use. Same as `DATABASE_URL` locally. |
| `TEST_DATABASE_URL` | tests | Separate database for `npm test`. docker-compose creates `relay_test`. |
| `AUTH_SECRET` | yes | Signs session JWTs. |
| `AUTH_TRUST_HOST` | yes | `true` behind Vercel or another proxy. |
| `CRON_SECRET` | yes | Bearer secret for `GET /api/cron/expire-assignments`. Vercel sends it automatically. |
| `OPENROUTER_API_KEY` | no | Turns on AI re-ranking and Manual Queue suggestions. Without it, the deterministic scorer is used. |
| `OPENROUTER_MODEL` | no | Defaults to `openai/gpt-4o-mini`. Any OpenRouter model with JSON-schema output works. |
| `AI_TIMEOUT_MS` | no | AI call timeout, default 8000. On timeout the app falls back to the score ranking. |
| `LAZY_SWEEP_INTERVAL_MS` | no | Throttle for the read-path timeout sweep, default 5000. |
| `DEMO_MODE` | no | Shows the demo account buttons on the login page. |
| `ALLOW_SEED` | no | Enables `POST /api/admin/seed` (admin only). Turn it off in production after seeding. |

## Tests

```bash
npm test             # Vitest: 100+ unit + integration tests against a real Postgres (relay_test)
npm run test:e2e     # Playwright: full dispatch flow in Chromium (needs a seeded dev DB; starts `npm run dev` if needed)
npm run typecheck && npm run lint
```

The integration tests call the real services and route handlers against Postgres, because the important guarantees live in SQL: row locks, conditional updates, the partial unique index, and the check constraints. They cover every scenario the brief requires and more:

- Eligible assignment and capacity reservation. Unavailable or full riders are not recommended and cannot be force-assigned.
- A job with no eligible rider goes to the Manual Queue. A confirmed job runs through pickup and delivery and releases capacity.
- A timeout moves the job to the Manual Queue, releases capacity and keeps the expired attempt. The test covers both cron and the lazy sweep on reads with a simulated clock.
- An accept that arrives after the deadline is rejected, and the timeout is committed first.
- When cron, the lazy sweep and a manual sweep race, each offer expires exactly once.
- Duplicate submissions: same key, same reference, and 5 identical requests in parallel all produce one job. A reused key with a different body is rejected.
- Invalid transitions, stale `expectedVersion`, and two dispatchers assigning at once (exactly one wins). A rider is never over-reserved across concurrent jobs.
- Overrides require a reason and are recorded. A rejecting rider is excluded from future recommendations. Reassignment from the Manual Queue completes the job.
- AI: a valid re-rank is used; an unknown rider, duplicate, bad JSON, timeout, HTTP error, or missing key falls back to the score ranking.
- Authorization: 401 without credentials, for revoked tokens, and for deactivated users. Viewers get 403 on writes, scoped tokens get 403 outside their scopes, and settings are admin-only. A rider gets 403 on other riders' offers and on dispatch endpoints. The actor is always the authenticated principal, never the request body. The cron secret is enforced.
- A static check fails the build if any API route is not wrapped in `withAuth` (except health, auth and the cron endpoint).

## Demo walkthrough (about 10 minutes)

The seed leaves jobs in every state, so each feature can be shown immediately.

1. **Dashboard** (`dispatcher@relay.dev`). The KPI cards show the workload. *Needs attention* lists Manual Queue jobs, offers close to expiring, deadlines at risk, and jobs that have sat unassigned. **ORD-1009** was seeded with an already-overdue offer, so the first page load times it out (*Confirmation timed out*).
2. **Recommendations.** Open **ORD-1001**. Eligible riders are ranked with a score out of 100, a factor breakdown, an acceptance probability and an ETA. *Why other riders were excluded* lists the hard-rule failures (offline, wrong zone, no capacity, at job limit). With an OpenRouter key, the top 5 are re-ranked by the model, with a one-line reason each and a summary.
3. **Assign or override.** Click **Assign** on the top rider, or pick another rider; the app then requires an override reason, which is stored on the assignment and in the audit trail. The job becomes *Awaiting rider* with a live countdown.
4. **Confirm or reject.** Use **Rider accepts / Rider rejects** on the job page, or sign in as the rider (for example `sneha@relay.dev`, who has a pending urgent offer on ORD-1003) and respond in the rider app. A rejection releases capacity, sends the job to the Manual Queue and excludes that rider from future recommendations for the job.
5. **Timeout without waiting 2 hours.** As `admin@relay.dev`, go to **Settings**. Either lower the threshold (for example to 60 seconds) for new offers, or use the simulated clock buttons (+15 min / +1 hour / +2 hours). Advancing the clock runs a sweep immediately, and overdue offers move to the Manual Queue with reason *Confirmation timed out*. Their reserved capacity is released and the expired attempt stays in the history.
6. **Manual Queue.** Jobs are grouped by reason (timed out, rejected, no eligible rider, released), oldest first. **Suggest** asks the AI, or deterministic rules without a key, for the next action: reassign to a specific rider, wait, cancel, or escalate. **Investigate & reassign** opens the job, where the rider who let it expire carries a warning and a -10 penalty.
7. **Complete the delivery.** After acceptance, use **Mark picked up** and then **Mark delivered**. The rider's capacity is freed and their location moves to the drop zone.
8. **Audit trail.** Every job page shows the full timeline: creation, triage, recommendations (strategy and model), assignment, overrides, confirmation, rejection, timeout, Manual Queue moves, reassignment, pickup, delivery and cancellation. Each entry has an actor and a details payload. The same data is available from `GET /api/jobs/{id}/events`.
9. **API.** Open `/docs` for the interactive reference. As admin, create a scoped API token under **Admin → API tokens** and call the API with `Authorization: Bearer relay_...`.

## Deploying to Vercel and Neon

1. Create a Neon project. Copy the **pooled** connection string into `DATABASE_URL` (append `?pgbouncer=true&connection_limit=1`) and the **direct** one into `DIRECT_URL`.
2. Import the repository in Vercel and set the root directory to `relay`. Add the environment variables from the table above, using fresh random values for `AUTH_SECRET` and `CRON_SECRET`.
3. Deploy. `vercel.json` runs `npm run vercel-build` (`prisma migrate deploy` then `next build`) and registers the cron job.
4. Seed once. Set `ALLOW_SEED=true`, sign in as admin and use **Settings → Reset demo data**. Alternatively, run `npm run db:seed` locally with `DATABASE_URL` pointing at Neon. Then set `ALLOW_SEED=false`.

**Cron frequency.** The Vercel Hobby plan only allows daily cron jobs, so `vercel.json` ships with `0 0 * * *`. Correctness does not depend on cron, because every read of a queue or job runs a throttled lazy sweep and every write sweeps the job it locks. On Vercel Pro, change the schedule to `* * * * *` so offers expire within a minute even when nobody has the app open.

## Assumptions and limitations

These are summarized here; the full list is in [docs/ENGINEERING_NOTES.md](docs/ENGINEERING_NOTES.md).

- Locations are zones with a symmetric travel-time matrix. There is no GPS or live traffic.
- Capacity is a single integer unit (parcels), and riders also have a maximum number of active jobs.
- A rejection sends the job to the Manual Queue rather than auto-offering it to the next rider, so a human sees every failure. The rejecting rider is excluded for that job.
- A change to the confirmation threshold applies to new offers; existing offers keep the deadline they were given.
- The simulated clock is a global offset for demos. It shifts "now" for the whole app.
- The UI refreshes by polling (5 seconds on the dashboard and queues) rather than WebSockets.
