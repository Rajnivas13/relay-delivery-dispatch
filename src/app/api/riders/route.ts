import { withAuth } from "@/auth/withAuth";
import { json, parseBody } from "@/lib/http";
import { RiderCreateSchema } from "@/lib/schemas";
import { createRider, listRiders } from "@/services/riderService";

export const dynamic = "force-dynamic";

export const GET = withAuth({ permission: "riders:read", lazyExpiry: true }, async () => {
  const riders = await listRiders();
  return json({ count: riders.length, items: riders });
});

export const POST = withAuth({ permission: "riders:write" }, async (req) => {
  return json(await createRider(await parseBody(req, RiderCreateSchema)), 201);
});
