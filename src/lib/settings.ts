import type { Setting } from "@prisma/client";
import { prisma, type Db } from "./db";

export const DEFAULT_TIMEOUT_SECONDS = 2 * 60 * 60;

export async function getSettings(db: Db = prisma): Promise<Setting> {
  const existing = await db.setting.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return db.setting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

/**
 * The application clock. `clockOffsetSeconds` lets a reviewer jump forward in time to see
 * timeouts fire without waiting; every service reads time through here.
 */
export async function getNow(db: Db = prisma): Promise<Date> {
  const settings = await getSettings(db);
  return new Date(Date.now() + settings.clockOffsetSeconds * 1000);
}

export async function getClock(db: Db = prisma): Promise<{ now: Date; settings: Setting }> {
  const settings = await getSettings(db);
  return { now: new Date(Date.now() + settings.clockOffsetSeconds * 1000), settings };
}
