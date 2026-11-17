import { assertOwnRiderOrStaff, withAuth } from "@/auth/withAuth";
import { json } from "@/lib/http";
import { getRider, getRiderOffers } from "@/services/riderService";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(
  { permission: ["riders:read", "rider:self"], lazyExpiry: true },
  async (_req, { params, principal }) => {
    const rider = await getRider(params.id);
    assertOwnRiderOrStaff(principal, rider.id);
    return json(await getRiderOffers(rider.id));
  },
);
