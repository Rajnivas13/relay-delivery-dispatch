import { isValidCronRequest } from "@/auth/cronAuth";
import { CRON_ACTOR } from "@/domain/types";
import { errorBody, errorResponse, json } from "@/lib/http";
import { expireOverdueAssignments } from "@/services/timeoutService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isValidCronRequest(req)) {
    return json(errorBody("UNAUTHENTICATED", "Invalid cron secret"), 401);
  }
  try {
    const started = Date.now();
    const result = await expireOverdueAssignments({ source: "cron", actor: CRON_ACTOR, limit: 500 });
    return json({ ...result, durationMs: Date.now() - started });
  } catch (err) {
    return errorResponse(err);
  }
}
