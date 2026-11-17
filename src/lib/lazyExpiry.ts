import { expireOverdueAssignments } from "@/services/timeoutService";

const MIN_INTERVAL_MS = Number(process.env.LAZY_SWEEP_INTERVAL_MS ?? 5000);

let lastRunAt = 0;
let inflight: Promise<unknown> | null = null;

/**
 * Called before queue reads. Throttled per server instance so a busy dashboard does not
 * hammer the database; write paths do their own targeted sweep under the job lock instead.
 */
export async function lazySweep(force = false): Promise<void> {
  if (inflight) {
    await inflight;
    return;
  }
  if (!force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return;
  lastRunAt = Date.now();
  inflight = expireOverdueAssignments({ source: "lazy", limit: 100 })
    .catch((err) => console.error("lazy sweep failed", err))
    .finally(() => {
      inflight = null;
    });
  await inflight;
}

export function resetLazySweepThrottle(): void {
  lastRunAt = 0;
}
