import { withAuth } from "@/auth/withAuth";
import { json, parseBody } from "@/lib/http";
import { TokenCreateSchema } from "@/lib/schemas";
import { createApiToken, listApiTokens } from "@/services/userService";

export const dynamic = "force-dynamic";

export const GET = withAuth({ permission: "tokens:manage" }, async () => json({ items: await listApiTokens() }));

export const POST = withAuth({ permission: "tokens:manage" }, async (req, { principal }) => {
  const { name, scopes } = await parseBody(req, TokenCreateSchema);
  return json(await createApiToken(principal.userId, name, scopes), 201);
});
