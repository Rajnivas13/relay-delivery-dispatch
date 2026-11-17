import { withAuth } from "@/auth/withAuth";
import { json } from "@/lib/http";
import { acceptAssignment } from "@/services/assignmentService";

export const dynamic = "force-dynamic";

export const POST = withAuth<{ id: string }>({ permission: "assignments:respond" }, async (_req, { params, actor }) => {
  return json(await acceptAssignment(params.id, actor));
});
