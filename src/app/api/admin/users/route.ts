import { withAuth } from "@/auth/withAuth";
import { json, parseBody } from "@/lib/http";
import { UserCreateSchema } from "@/lib/schemas";
import { createUser, listUsers } from "@/services/userService";

export const dynamic = "force-dynamic";

export const GET = withAuth({ permission: "users:manage" }, async () => json({ items: await listUsers() }));

export const POST = withAuth({ permission: "users:manage" }, async (req) => {
  return json(await createUser(await parseBody(req, UserCreateSchema)), 201);
});
