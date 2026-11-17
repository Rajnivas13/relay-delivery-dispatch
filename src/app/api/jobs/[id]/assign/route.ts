import { withAuth } from "@/auth/withAuth";
import { json, parseBody } from "@/lib/http";
import { AssignSchema } from "@/lib/schemas";
import { assignRider } from "@/services/assignmentService";

export const dynamic = "force-dynamic";

export const POST = withAuth<{ id: string }>({ permission: "jobs:assign" }, async (req, { params, actor }) => {
  const input = await parseBody(req, AssignSchema);
  return json(await assignRider(params.id, input, actor), 201);
});
