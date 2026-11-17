import { withAuth } from "@/auth/withAuth";
import { json } from "@/lib/http";
import { lazySweep } from "@/lib/lazyExpiry";
import { getJob } from "@/services/jobService";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>({ permission: "jobs:read" }, async (_req, { params }) => {
  await lazySweep();
  return json(await getJob(params.id));
});
