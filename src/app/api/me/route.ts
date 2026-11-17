import { withAuth } from "@/auth/withAuth";
import { PERMISSION_KEYS, can } from "@/auth/permissions";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = withAuth({ permission: "docs:read" }, async (_req, { principal }) => {
  return json({
    ...principal,
    permissions: PERMISSION_KEYS.filter((p) => can(principal, p)),
  });
});
