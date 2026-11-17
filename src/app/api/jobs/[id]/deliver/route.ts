import { withAuth } from "@/auth/withAuth";
import { json } from "@/lib/http";
import { markDelivered } from "@/services/jobService";

export const dynamic = "force-dynamic";

export const POST = withAuth<{ id: string }>({ permission: "delivery:update" }, async (_req, { params, actor }) => {
  return json(await markDelivered(params.id, actor));
});
