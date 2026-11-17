import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Compared in constant time. */
export function isValidCronRequest(req: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}
