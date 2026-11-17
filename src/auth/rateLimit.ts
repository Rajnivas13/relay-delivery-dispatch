import { prisma } from "@/lib/db";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_EMAIL = 5;
export const MAX_FAILURES_PER_IP = 20;

const keysFor = (email: string, ip: string) => ({ email: `email:${email.toLowerCase()}`, ip: `ip:${ip}` });

/** DB-backed so the limit holds across serverless instances. */
export async function isLoginBlocked(email: string, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const keys = keysFor(email, ip);
  const [byEmail, byIp] = await Promise.all([
    prisma.loginAttempt.count({ where: { key: keys.email, success: false, createdAt: { gte: since } } }),
    prisma.loginAttempt.count({ where: { key: keys.ip, success: false, createdAt: { gte: since } } }),
  ]);
  return byEmail >= MAX_FAILURES_PER_EMAIL || byIp >= MAX_FAILURES_PER_IP;
}

export async function recordLoginAttempt(email: string, ip: string, success: boolean): Promise<void> {
  const keys = keysFor(email, ip);
  if (success) {
    await prisma.loginAttempt.deleteMany({ where: { key: keys.email, success: false } });
    return;
  }
  await prisma.loginAttempt.createMany({
    data: [
      { key: keys.email, success: false },
      { key: keys.ip, success: false },
    ],
  });
}
