import { withAuth } from "@/auth/withAuth";
import { json } from "@/lib/http";
import { listManualQueue } from "@/services/jobService";

export const dynamic = "force-dynamic";

export const GET = withAuth({ permission: "jobs:read", lazyExpiry: true }, async () => {
  const items = await listManualQueue();
  return json({ count: items.length, items });
});
