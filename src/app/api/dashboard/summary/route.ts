import { withAuth } from "@/auth/withAuth";
import { json } from "@/lib/http";
import { getDashboardSummary } from "@/services/dashboardService";

export const dynamic = "force-dynamic";

export const GET = withAuth({ permission: "dashboard:read", lazyExpiry: true }, async () => {
  return json(await getDashboardSummary());
});
