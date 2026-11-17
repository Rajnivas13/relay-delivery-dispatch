# Engineering Notes

## Assumptions

- **Geography is simulated.** There are six zones (CENTRAL, NORTH, SOUTH, EAST, WEST, AIRPORT) with a symmetric travel-time matrix in minutes. A rider's position is the zone they are in. It is updated on pickup (to the pickup zone) and on delivery (to the drop zone).
- **Capacity is one integer dimension** ("units", roughly parcels), plus a separate limit on concurrent active jobs. Weight and volume are not modelled separately.
- **A rider must service both the pickup and drop zones.** Cross-zone handovers are out of scope.
- **The confirmation threshold is global** (default 2 hours) and is fixed on each offer when it is made. Changing it affects new offers only, which is fairer to riders and makes the history unambiguous.
- **A rejection goes to a human.** A rejected offer moves the job to the Manual Queue instead of auto-offering to the next rider, and the rejecting rider is excluded for that job. A rider who lets an offer expire is *not* excluded, because they may have been out of signal, but they take a -10 score penalty and a warning.
- **Rider actions can be simulated by dispatchers** (accept, reject, pickup, deliver) for demos. These are logged under the dispatcher's name, so the audit trail stays honest. Real riders use the rider app with their own login.
- **Pickup is the point of no return.** After `PICKED_UP` a job can only be delivered. Returns and failed deliveries would be a separate flow.
- **The simulated clock is global.** Advancing it shifts "now" for the whole app, which suits a single-tenant demo desk.
- **AI is an enhancement, never a dependency.** Without `OPENROUTER_API_KEY`, or on any AI failure, the deterministic ranking and rule-based suggestions are used, and the UI says so.

## Known limitations

- **Timeout freshness on Vercel Hobby.** Cron runs at most daily there. Lazy expiry ensures nobody can *see or act on* an overdue offer, but the database row stays `PENDING` until the next read, write or cron run. On Pro, set the cron schedule to every minute.
- **Polling, not push.** Dashboards and queues poll every 5 seconds and the rider app every 5 to 10 seconds. That is fine for a desk of this size, but it is not instant and it generates steady read load.
- **The lazy sweep throttle is per serverless instance.** Several warm instances may each sweep within the same 5 seconds. This is harmless (`SKIP LOCKED` makes it idempotent) but slightly wasteful.
- **Ranking loads all riders** so the UI can explain why each one was excluded. This is fine for hundreds of riders; at thousands it should pre-filter in SQL.
- **No rider notifications.** Riders see offers when they open or refresh the rider app. There are no SMS or push messages.
- **Login rate limiting** is keyed on email and on IP as reported by the proxy (`x-forwarded-for`). It is adequate behind Vercel but not a full bot defence.
- **The AI acceptance probability is a model estimate**, anchored on the scorer's baseline. It is not a trained, calibrated model yet.
- **Single region and tenant.** There are no per-city settings, timezones or tenancy keys.
- **Playwright e2e** needs a seeded development database and covers the main dispatch flow and access control. The Vitest suite covers the rest at the service and route level.

## Incomplete or intentionally out of scope

- No real maps, GPS or routing API (the brief allows a simulation).
- No proof of delivery (photo or signature), customer notifications, or return-to-sender flow.
- No bulk import of jobs or riders (create them one at a time through the UI or API).
- User self-service (password reset, SSO) is not implemented; admins manage accounts.

## Three improvements I would make next

1. **Push-based scheduling and real-time updates.** Schedule each offer's expiry precisely with a delayed-message queue (Upstash QStash or SQS) at `expiresAt`, so timeouts are exact even with zero traffic. Stream job and queue changes to the UI over SSE fed by a Postgres outbox, replacing polling. Send riders a push or SMS when an offer arrives.
2. **A learned acceptance model with an evaluation loop.** The `Assignment` table already records every offer's features (score breakdown, ETA, workload), outcome and response time. I would train a small gradient-boosted model to predict acceptance and on-time delivery, use it as the baseline instead of the hand-tuned weights, keep the LLM for natural-language explanations and Manual Queue triage, and track override rate, timeout rate and time-to-assign on the dashboard to measure whether recommendations improve.
3. **Operational depth for multiple cities.** Per-region settings (thresholds, working hours, timezone), tenancy keys on zones, riders and jobs, shift scheduling (planned availability rather than just a toggle), automatic re-offer policies configurable per priority (for example, URGENT jobs auto-offer to the next best rider once before going to the Manual Queue), and SLA alerts when a job waits in the Manual Queue too long.
