import { z } from "zod";
import { withAuth } from "@/auth/withAuth";
import { json, parseBody } from "@/lib/http";
import { ReasonSchema } from "@/lib/schemas";
import { cancelJob } from "@/services/jobService";

export const dynamic = "force-dynamic";

const CancelSchema = ReasonSchema.extend({ expectedVersion: z.number().int().min(0).optional() });

export const POST = withAuth<{ id: string }>({ permission: "jobs:write" }, async (req, { params, actor }) => {
  const { reason, expectedVersion } = await parseBody(req, CancelSchema);
  return json(await cancelJob(params.id, reason, actor, expectedVersion));
});
