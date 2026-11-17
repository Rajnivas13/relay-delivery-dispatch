import { withAuth } from "@/auth/withAuth";
import { json, parseBody } from "@/lib/http";
import { UserUpdateSchema } from "@/lib/schemas";
import { updateUser } from "@/services/userService";

export const dynamic = "force-dynamic";

export const PATCH = withAuth<{ id: string }>({ permission: "users:manage" }, async (req, { params, principal }) => {
  return json(await updateUser(params.id, await parseBody(req, UserUpdateSchema), principal.userId));
});
