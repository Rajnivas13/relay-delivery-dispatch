import { withAuth } from "@/auth/withAuth";
import { json } from "@/lib/http";
import { expireOverdueAssignments } from "@/services/timeoutService";

export const dynamic = "force-dynamic";

export const POST = withAuth({ permission: ["settings:write", "jobs:assign"] }, async (_req, { actor }) => {
  return json(await expireOverdueAssignments({ source: "manual", actor, limit: 500 }));
});
