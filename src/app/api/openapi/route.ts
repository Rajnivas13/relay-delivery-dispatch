import { withAuth } from "@/auth/withAuth";
import { json } from "@/lib/http";
import { buildOpenApi } from "@/lib/openapi";

export const dynamic = "force-dynamic";

export const GET = withAuth({ permission: "docs:read" }, async (req) => {
  return json(buildOpenApi(new URL(req.url).origin));
});
