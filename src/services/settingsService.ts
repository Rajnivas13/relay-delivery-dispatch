import { prisma } from "@/lib/db";
import { lazySweep } from "@/lib/lazyExpiry";
import { getClock, getSettings } from "@/lib/settings";

export async function getSettingsView() {
  const { now, settings } = await getClock();
  return {
    confirmationTimeoutSeconds: settings.confirmationTimeoutSeconds,
    clockOffsetSeconds: settings.clockOffsetSeconds,
    now: now.toISOString(),
    realNow: new Date().toISOString(),
    lastSweep: settings.lastSweepAt
      ? { at: settings.lastSweepAt.toISOString(), source: settings.lastSweepSource, expired: settings.lastSweepExpired }
      : null,
    aiEnabled: Boolean(process.env.OPENROUTER_API_KEY),
    aiModel: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
    allowSeed: process.env.ALLOW_SEED === "true",
  };
}

/**
 * The timeout applies to new offers only; existing offers keep the deadline they were given.
 * Moving the clock triggers an immediate sweep so overdue offers expire straight away.
 */
export async function updateSettings(patch: {
  confirmationTimeoutSeconds?: number;
  clockOffsetSeconds?: number;
  advanceClockSeconds?: number;
}) {
  const current = await getSettings();
  const clockOffsetSeconds =
    patch.advanceClockSeconds !== undefined
      ? current.clockOffsetSeconds + patch.advanceClockSeconds
      : patch.clockOffsetSeconds;
  await prisma.setting.update({
    where: { id: 1 },
    data: {
      ...(patch.confirmationTimeoutSeconds !== undefined
        ? { confirmationTimeoutSeconds: patch.confirmationTimeoutSeconds }
        : {}),
      ...(clockOffsetSeconds !== undefined ? { clockOffsetSeconds } : {}),
    },
  });
  if (clockOffsetSeconds !== undefined) await lazySweep(true);
  return getSettingsView();
}
