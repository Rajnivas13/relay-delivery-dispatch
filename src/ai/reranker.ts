import { z } from "zod";
import type { JobSnapshot } from "@/domain/eligibility";
import type { ScoredCandidate } from "@/domain/scoring";
import { chatJson, type AiCallOptions } from "./openrouter";

export const AI_TOP_N = 5;

export interface AiRankItem {
  riderId: string;
  acceptProbability: number;
  etaMinutes: number;
  reason: string;
}

export type RerankOutcome =
  | {
      ok: true;
      ranking: AiRankItem[];
      summary: string;
      riskNote: string | null;
      model: string;
      latencyMs: number;
    }
  | { ok: false; fallbackReason: string; model: string; latencyMs: number };

const ResponseSchema = z.object({
  ranking: z
    .array(
      z.object({
        riderId: z.string(),
        acceptProbability: z.number(),
        etaMinutes: z.number(),
        reason: z.string().min(1).max(400),
      }),
    )
    .min(1),
  summary: z.string().max(600),
  riskNote: z.string().max(400).nullable(),
});

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ranking", "summary", "riskNote"],
  properties: {
    ranking: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["riderId", "acceptProbability", "etaMinutes", "reason"],
        properties: {
          riderId: { type: "string", description: "Must be one of the provided candidate ids" },
          acceptProbability: { type: "number", description: "0..1 predicted chance the rider accepts in time" },
          etaMinutes: { type: "number", description: "Predicted minutes from now to delivery" },
          reason: { type: "string", description: "One sentence a dispatcher can read" },
        },
      },
    },
    summary: { type: "string" },
    riskNote: { type: ["string", "null"] },
  },
} as const;

const SYSTEM_PROMPT = `You are the rider-prediction engine of a delivery dispatch desk.
You receive one delivery job and a short list of riders that already passed every hard eligibility rule.
Predict, for each rider, the probability they accept the offer within the confirmation window and complete the delivery on time.
Re-rank them from best to worst. Weigh: travel time to pickup, deadline slack, current workload, historical acceptance,
and any warnings (for example a rider who previously let this job expire). The deterministic score is a strong prior;
deviate from it only with a concrete reason.
Rules: use ONLY the provided riderId values, include every candidate exactly once, keep each reason to one short sentence,
and reply with JSON matching the schema.`;

export function buildRerankPrompt(job: JobSnapshot & { reference?: string }, candidates: ScoredCandidate[], now: Date) {
  return JSON.stringify(
    {
      now: now.toISOString(),
      job: {
        reference: job.reference,
        pickupZone: job.pickupZoneId,
        dropZone: job.dropZoneId,
        loadUnits: job.loadUnits,
        priority: job.priority,
        deadline: job.deadlineAt?.toISOString() ?? null,
        minutesToDeadline: job.deadlineAt ? Math.round((job.deadlineAt.getTime() - now.getTime()) / 60000) : null,
      },
      candidates: candidates.map((c) => ({
        riderId: c.riderId,
        name: c.name,
        deterministicScore: c.score,
        deterministicRank: c.rank,
        etaToPickupMinutes: c.etaToPickupMinutes,
        etaTotalMinutes: c.etaTotalMinutes,
        activeJobs: `${c.activeJobs}/${c.maxActiveJobs}`,
        freeUnitsAfterJob: c.freeUnitsAfter,
        baselineAcceptProbability: c.acceptProbability,
        factors: Object.fromEntries(c.breakdown.map((f) => [f.key, `${f.points}/${f.max} (${f.detail})`])),
        warnings: c.warnings,
      })),
    },
    null,
    2,
  );
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n > 1 && n <= 100 ? n / 100 : n));

/**
 * Asks the LLM to re-rank already-eligible candidates. Any output that is malformed, names a
 * rider outside the candidate list, or repeats a rider is discarded in favour of the score order.
 */
export async function rerankWithAi(
  job: JobSnapshot & { reference?: string },
  candidates: ScoredCandidate[],
  now: Date,
  opts: AiCallOptions = {},
): Promise<RerankOutcome> {
  const top = candidates.slice(0, AI_TOP_N);
  if (top.length === 0) return { ok: false, fallbackReason: "NO_CANDIDATES", model: "", latencyMs: 0 };

  const res = await chatJson(
    { system: SYSTEM_PROMPT, user: buildRerankPrompt(job, top, now), schemaName: "rider_ranking", schema: JSON_SCHEMA },
    opts,
  );
  if (!res.ok) return { ok: false, fallbackReason: res.reason, model: res.model, latencyMs: res.latencyMs };

  const parsed = ResponseSchema.safeParse(res.data);
  if (!parsed.success) {
    return { ok: false, fallbackReason: "AI_SCHEMA_MISMATCH", model: res.model, latencyMs: res.latencyMs };
  }

  const allowed = new Set(top.map((c) => c.riderId));
  const seen = new Set<string>();
  for (const item of parsed.data.ranking) {
    if (!allowed.has(item.riderId)) {
      return { ok: false, fallbackReason: "AI_UNKNOWN_RIDER", model: res.model, latencyMs: res.latencyMs };
    }
    if (seen.has(item.riderId)) {
      return { ok: false, fallbackReason: "AI_DUPLICATE_RIDER", model: res.model, latencyMs: res.latencyMs };
    }
    seen.add(item.riderId);
  }

  const ranking: AiRankItem[] = parsed.data.ranking.map((r) => ({
    riderId: r.riderId,
    acceptProbability: Math.round(clamp01(r.acceptProbability) * 100) / 100,
    etaMinutes: Math.max(0, Math.round(r.etaMinutes)),
    reason: r.reason.trim(),
  }));
  // Candidates the model skipped keep their score order after the ones it ranked.
  for (const c of top) {
    if (!seen.has(c.riderId)) {
      ranking.push({
        riderId: c.riderId,
        acceptProbability: c.acceptProbability,
        etaMinutes: c.etaTotalMinutes,
        reason: "Not ranked by the model; kept in score order.",
      });
    }
  }

  return {
    ok: true,
    ranking,
    summary: parsed.data.summary.trim(),
    riskNote: parsed.data.riskNote?.trim() || null,
    model: res.model,
    latencyMs: res.latencyMs,
  };
}
