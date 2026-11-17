import { withAuth } from "@/auth/withAuth";
import { json } from "@/lib/http";
import { getNextActionSuggestion } from "@/services/recommendationService";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = withAuth<{ id: string }>({ permission: "ai:use" }, async (_req, { params, actor }) => {
  return json(await getNextActionSuggestion(params.id, actor));
});
