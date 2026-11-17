import { withAuth } from "@/auth/withAuth";
import { json } from "@/lib/http";
import { getJobEvents } from "@/services/jobService";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>({ permission: "jobs:read", lazyExpiry: true }, async (_req, { params }) => {
  const events = await getJobEvents(params.id);
  return json({ jobId: params.id, count: events.length, events });
});
