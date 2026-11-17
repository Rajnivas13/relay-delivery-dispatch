import { withAuth } from "@/auth/withAuth";
import { json, parseBody } from "@/lib/http";
import { ReasonSchema } from "@/lib/schemas";
import { releaseAssignment } from "@/services/assignmentService";

export const dynamic = "force-dynamic";

export const POST = withAuth<{ id: string }>({ permission: "jobs:assign" }, async (req, { params, actor }) => {
  const { reason } = await parseBody(req, ReasonSchema);
  return json(await releaseAssignment(params.id, reason, actor));
});
