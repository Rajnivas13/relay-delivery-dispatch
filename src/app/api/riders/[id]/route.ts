import { withAuth } from "@/auth/withAuth";
import { json, parseBody } from "@/lib/http";
import { RiderUpdateSchema } from "@/lib/schemas";
import { getRider, updateRider } from "@/services/riderService";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>({ permission: "riders:read" }, async (_req, { params }) => {
  return json(await getRider(params.id));
});

export const PATCH = withAuth<{ id: string }>({ permission: "riders:write" }, async (req, { params }) => {
  const rider = await getRider(params.id);
  return json(await updateRider(rider.id, await parseBody(req, RiderUpdateSchema)));
});
