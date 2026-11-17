import { withAuth } from "@/auth/withAuth";
import { json } from "@/lib/http";
import { listZones } from "@/services/riderService";

export const dynamic = "force-dynamic";

export const GET = withAuth({ permission: ["jobs:read", "rider:self"] }, async () => {
  return json({ items: await listZones() });
});
