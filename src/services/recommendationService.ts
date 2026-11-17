import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AiCallOptions } from "@/ai/openrouter";
import { isAiEnabled } from "@/ai/openrouter";
import { AI_TOP_N, rerankWithAi, type AiRankItem } from "@/ai/reranker";
import { suggestNextAction, type Suggestion } from "@/ai/suggest";
import { isAssignable } from "@/domain/jobStateMachine";
import type { ScoredCandidate } from "@/domain/scoring";
import { SYSTEM_ACTOR, type Actor } from "@/domain/types";
import { prisma, transaction } from "@/lib/db";
import { getClock } from "@/lib/settings";
import { moveToManualQueueLocked } from "./jobService";
import { rankForJob, toJobSnapshot } from "./rankingContext";
import { lockJob, recordEvent, resolveJobId } from "./shared";

const REUSE_WINDOW_MS = 5 * 60 * 1000;

export type Strategy = "AI_RERANK" | "SCORE";

export interface RecommendedCandidate extends ScoredCandidate {
  finalRank: number;
  ai: AiRankItem | null;
}

export interface RecommendationView {
  jobId: string;
  reference: string;
  jobStatus: string;
  assignable: boolean;
  generatedAt: string;
  strategy: Strategy;
  aiRequested: boolean;
  aiEnabled: boolean;
  usedFallback: boolean;
  fallbackReason: string | null;
  model: string | null;
  latencyMs: number | null;
  cached: boolean;
  summary: string | null;
  riskNote: string | null;
  recommendedRiderId: string | null;
  scoreTopRiderId: string | null;
  candidates: RecommendedCandidate[];
  ineligible: { riderId: string; code: string; name: string; reasons: string[] }[];
}

interface StoredAi {
  ranking: AiRankItem[];
  summary: string;
  riskNote: string | null;
}

function fingerprint(jobId: string, version: number, candidates: ScoredCandidate[], wantAi: boolean): string {
  const raw = `${jobId}|${version}|${wantAi}|${candidates.map((c) => `${c.riderId}:${c.score}`).join(",")}`;
  return createHash("sha1").update(raw).digest("hex");
}

function merge(candidates: ScoredCandidate[], ai: StoredAi | null): RecommendedCandidate[] {
  if (!ai) return candidates.map((c) => ({ ...c, finalRank: c.rank, ai: null }));
  const byId = new Map(candidates.map((c) => [c.riderId, c]));
  const ordered: RecommendedCandidate[] = [];
  ai.ranking.forEach((item) => {
    const c = byId.get(item.riderId);
    if (c) ordered.push({ ...c, finalRank: ordered.length + 1, ai: item });
  });
  const placed = new Set(ordered.map((c) => c.riderId));
  for (const c of candidates) {
    if (!placed.has(c.riderId)) ordered.push({ ...c, finalRank: ordered.length + 1, ai: null });
  }
  return ordered;
}

/**
 * Hybrid recommendation: hard rules and a deterministic score decide who is eligible and the
 * baseline order; the LLM optionally re-ranks the top candidates and predicts acceptance.
 * Each new result is stored so overrides can be measured against what the dispatcher saw.
 */
export async function getRecommendations(
  idOrReference: string,
  opts: { useAi: boolean; actor: Actor; aiOptions?: AiCallOptions },
): Promise<RecommendationView> {
  const jobId = await resolveJobId(prisma, idOrReference);
  const { now } = await getClock();
  let job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  let ranking = await rankForJob(prisma, job, now);

  if (job.status === "READY_FOR_ASSIGNMENT" && ranking.eligible.length === 0) {
    job = await transaction(async (tx) => {
      const locked = await lockJob(tx, jobId);
      if (locked.status !== "READY_FOR_ASSIGNMENT") return locked;
      const fresh = await rankForJob(tx, locked, now);
      if (fresh.eligible.length > 0) return locked;
      return moveToManualQueueLocked(tx, locked, now, "NO_ELIGIBLE_RIDER", SYSTEM_ACTOR, {
        message: "No eligible rider when recommendations were requested",
      });
    });
    ranking = await rankForJob(prisma, job, now);
  }

  const assignable = isAssignable(job.status);
  const wantAi = opts.useAi && assignable && ranking.eligible.length > 0;
  const fp = fingerprint(jobId, job.version, ranking.eligible, wantAi);

  const base = {
    jobId,
    reference: job.reference,
    jobStatus: job.status,
    assignable,
    aiRequested: opts.useAi,
    aiEnabled: isAiEnabled(),
    scoreTopRiderId: ranking.eligible[0]?.riderId ?? null,
    ineligible: ranking.ineligible,
  };

  if (!assignable) {
    const candidates = merge(ranking.eligible, null);
    return {
      ...base,
      generatedAt: now.toISOString(),
      strategy: "SCORE",
      usedFallback: false,
      fallbackReason: null,
      model: null,
      latencyMs: null,
      cached: false,
      summary: null,
      riskNote: null,
      recommendedRiderId: candidates[0]?.riderId ?? null,
      candidates,
    };
  }

  const reusable = await prisma.recommendation.findFirst({
    where: { jobId, fingerprint: fp, createdAt: { gte: new Date(Date.now() - REUSE_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
  });
  if (reusable) {
    const ai = (reusable.ai as unknown as StoredAi | null) ?? null;
    const candidates = merge(ranking.eligible, ai);
    return {
      ...base,
      generatedAt: reusable.createdAt.toISOString(),
      strategy: reusable.strategy as Strategy,
      usedFallback: reusable.usedFallback,
      fallbackReason: reusable.fallbackReason,
      model: reusable.aiModel,
      latencyMs: reusable.aiLatencyMs,
      cached: true,
      summary: ai?.summary ?? null,
      riskNote: ai?.riskNote ?? null,
      recommendedRiderId: candidates[0]?.riderId ?? null,
      candidates,
    };
  }

  let ai: StoredAi | null = null;
  let usedFallback = false;
  let fallbackReason: string | null = null;
  let model: string | null = null;
  let latencyMs: number | null = null;
  if (wantAi) {
    const res = await rerankWithAi(
      { ...toJobSnapshot(job), reference: job.reference },
      ranking.eligible.slice(0, AI_TOP_N),
      now,
      opts.aiOptions,
    );
    model = res.model || null;
    latencyMs = res.latencyMs;
    if (res.ok) ai = { ranking: res.ranking, summary: res.summary, riskNote: res.riskNote };
    else {
      usedFallback = true;
      fallbackReason = res.fallbackReason;
    }
  }

  const strategy: Strategy = ai ? "AI_RERANK" : "SCORE";
  const candidates = merge(ranking.eligible, ai);
  const topRiderId = candidates[0]?.riderId ?? null;

  await transaction(async (tx) => {
    await tx.recommendation.create({
      data: {
        jobId,
        fingerprint: fp,
        strategy,
        topRiderId,
        candidates: ranking.eligible.map((c) => ({
          riderId: c.riderId,
          code: c.code,
          score: c.score,
          rank: c.rank,
          reasons: c.reasons,
        })) as Prisma.InputJsonValue,
        ai: (ai ?? undefined) as Prisma.InputJsonValue | undefined,
        aiModel: model,
        aiLatencyMs: latencyMs,
        usedFallback,
        fallbackReason,
        createdAt: now,
      },
    });
    await recordEvent(tx, {
      jobId,
      type: "RECOMMENDATION_GENERATED",
      actor: opts.actor,
      at: now,
      details: {
        strategy,
        usedFallback,
        fallbackReason,
        model,
        eligibleCount: ranking.eligible.length,
        ineligibleCount: ranking.ineligible.length,
        top: candidates.slice(0, 3).map((c) => ({
          code: c.code,
          score: c.score,
          acceptProbability: c.ai?.acceptProbability ?? c.acceptProbability,
        })),
      },
    });
  });

  return {
    ...base,
    generatedAt: now.toISOString(),
    strategy,
    usedFallback,
    fallbackReason,
    model,
    latencyMs,
    cached: false,
    summary: ai?.summary ?? null,
    riskNote: ai?.riskNote ?? null,
    recommendedRiderId: topRiderId,
    candidates,
  };
}

export async function getNextActionSuggestion(
  idOrReference: string,
  actor: Actor,
  aiOptions?: AiCallOptions,
): Promise<Suggestion & { riderCode: string | null; riderName: string | null }> {
  const jobId = await resolveJobId(prisma, idOrReference);
  const { now } = await getClock();
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      assignments: { orderBy: { createdAt: "asc" }, include: { rider: { select: { code: true } } } },
      events: { orderBy: { id: "desc" }, take: 15 },
    },
  });
  const ranking = await rankForJob(prisma, job, now);

  const suggestion = await suggestNextAction(
    {
      job,
      minutesInQueue: job.manualQueuedAt ? Math.round((now.getTime() - job.manualQueuedAt.getTime()) / 60000) : 0,
      attempts: job.assignments.map((a) => ({ riderCode: a.rider.code, status: a.status, endReason: a.endReason })),
      recentEvents: [...job.events].reverse().map((e) => ({ type: e.type, at: e.createdAt.toISOString(), details: e.details })),
      candidates: ranking.eligible,
      now,
    },
    aiOptions,
  );

  const rider = suggestion.riderId ? ranking.eligible.find((c) => c.riderId === suggestion.riderId) : undefined;
  await transaction((tx) =>
    recordEvent(tx, {
      jobId,
      type: "AI_SUGGESTION",
      actor,
      at: now,
      details: {
        action: suggestion.action,
        riderCode: rider?.code ?? null,
        source: suggestion.source,
        confidence: suggestion.confidence,
        rationale: suggestion.rationale,
        fallbackReason: suggestion.fallbackReason ?? null,
      },
    }),
  );

  return { ...suggestion, riderCode: rider?.code ?? null, riderName: rider?.name ?? null };
}
