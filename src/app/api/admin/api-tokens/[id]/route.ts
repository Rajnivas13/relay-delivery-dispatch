import { withAuth } from "@/auth/withAuth";
import { json } from "@/lib/http";
import { revokeApiToken } from "@/services/userService";

export const dynamic = "force-dynamic";

export const DELETE = withAuth<{ id: string }>({ permission: "tokens:manage" }, async (_req, { params }) => {
  const token = await revokeApiToken(params.id);
  return json({ id: token.id, revokedAt: token.revokedAt });
});
