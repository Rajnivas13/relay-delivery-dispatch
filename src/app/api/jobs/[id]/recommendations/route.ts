import { withAuth } from "@/auth/withAuth";
import { json } from "@/lib/http";
import { getRecommendations } from "@/services/recommendationService";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = withAuth<{ id: string }>(
  { permission: ["jobs:assign", "jobs:read"], lazyExpiry: true },
  async (req, { params, actor, principal }) => {
    const wantsAi = new URL(req.url).searchParams.get("ai") !== "false";
    const canUseAi = principal.role === "ADMIN" || principal.role === "DISPATCHER";
    return json(await getRecommendations(params.id, { useAi: wantsAi && canUseAi, actor }));
  },
);
