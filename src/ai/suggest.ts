import { z } from "zod";
import type { ScoredCandidate } from "@/domain/scoring";
import { chatJson, type AiCallOptions } from "./openrouter";

export const SUGGESTED_ACTIONS = ["REASSIGN", "WAIT", "CANCEL", "ESCALATE"] as const;
export type SuggestedAction = (typeof SUGGESTED_ACTIONS)[number];

export interface Suggestion {
  action: SuggestedAction;
  riderId: string | null;
  rationale: string;
  confidence: number;
  source: "AI" | "RULES";
  model?: string;
  fallbackReason?: string;
}

export interface SuggestionContext {
  job: {
    reference: string;
    status: string;
    manualQueueReason: string | null;
    priority: string;
    pickupZoneId: string;
    dropZoneId: string;
    loadUnits: number;
    deadlineAt: Date | null;
  };
  minutesInQueue: number;
  attempts: { riderCode: string; status: string; endReason: string | null }[];
  recentEvents: { type: string; at: string; details: unknown }[];
  candidates: ScoredCandidate[];
  now: Date;
}

const ResponseSchema = z.object({
  action: z.enum(SUGGESTED_ACTIONS),
  riderId: z.string().nullable(),
  rationale: z.string().min(1).max(600),
  confidence: z.number(),
});

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "riderId", "rationale", "confidence"],
  properties: {
    action: { type: "string", enum: SUGGESTED_ACTIONS },
    riderId: { type: ["string", "null"], description: "Required when action is REASSIGN; must be a candidate id" },
    rationale: { type: "string" },
    confidence: { type: "number", description: "0..1" },
  },
} as const;

const SYSTEM_PROMPT = `You assist a delivery dispatcher working the Manual Queue.
Given a stuck job, its assignment history and the currently eligible riders, recommend ONE next action:
REASSIGN (pick a riderId from candidates), WAIT (no good rider now but one is likely soon), CANCEL (job cannot be fulfilled),
or ESCALATE (needs a human decision, e.g. deadline already missed or repeated failures).
Avoid riders who already rejected or let this job expire unless no one else is available. Be concise and practical.`;

/** Deterministic fallback so the button always returns something useful. */
export function ruleBasedSuggestion(ctx: SuggestionContext, fallbackReason?: string): Suggestion {
  const deadlinePassed = ctx.job.deadlineAt ? ctx.job.deadlineAt <= ctx.now : false;
  const best = ctx.candidates[0];
  if (deadlinePassed) {
    return {
      action: "ESCALATE",
      riderId: best?.riderId ?? null,
      rationale: "The delivery deadline has already passed; confirm with the customer before reassigning.",
      confidence: 0.7,
      source: "RULES",
      fallbackReason,
    };
  }
  if (best) {
    return {
      action: "REASSIGN",
      riderId: best.riderId,
      rationale: `${best.name} is the top-scored eligible rider (${best.score}/100): ${best.reasons.slice(0, 2).join("; ")}.`,
      confidence: Math.min(0.9, best.score / 100),
      source: "RULES",
      fallbackReason,
    };
  }
  return {
    action: ctx.attempts.length >= 3 ? "ESCALATE" : "WAIT",
    riderId: null,
    rationale:
      ctx.attempts.length >= 3
        ? "Several riders have already failed this job and nobody else is eligible."
        : "No rider is eligible right now; wait for a rider to come online or free capacity.",
    confidence: 0.6,
    source: "RULES",
    fallbackReason,
  };
}

export async function suggestNextAction(ctx: SuggestionContext, opts: AiCallOptions = {}): Promise<Suggestion> {
  const user = JSON.stringify(
    {
      now: ctx.now.toISOString(),
      job: {
        reference: ctx.job.reference,
        status: ctx.job.status,
        manualQueueReason: ctx.job.manualQueueReason,
        priority: ctx.job.priority,
        pickupZoneId: ctx.job.pickupZoneId,
        dropZoneId: ctx.job.dropZoneId,
        loadUnits: ctx.job.loadUnits,
        deadlineAt: ctx.job.deadlineAt?.toISOString() ?? null,
      },
      minutesInQueue: ctx.minutesInQueue,
      attempts: ctx.attempts,
      recentEvents: ctx.recentEvents.slice(-12),
      candidates: ctx.candidates.slice(0, 5).map((c) => ({
        riderId: c.riderId,
        name: c.name,
        score: c.score,
        etaTotalMinutes: c.etaTotalMinutes,
        acceptProbability: c.acceptProbability,
        warnings: c.warnings,
      })),
    },
    null,
    2,
  );

  const res = await chatJson({ system: SYSTEM_PROMPT, user, schemaName: "next_action", schema: JSON_SCHEMA }, opts);
  if (!res.ok) return ruleBasedSuggestion(ctx, res.reason);

  const parsed = ResponseSchema.safeParse(res.data);
  if (!parsed.success) return ruleBasedSuggestion(ctx, "AI_SCHEMA_MISMATCH");
  const s = parsed.data;
  if (s.action === "REASSIGN" && (!s.riderId || !ctx.candidates.some((c) => c.riderId === s.riderId))) {
    return ruleBasedSuggestion(ctx, "AI_UNKNOWN_RIDER");
  }
  return {
    action: s.action,
    riderId: s.action === "REASSIGN" ? s.riderId : null,
    rationale: s.rationale.trim(),
    confidence: Math.round(Math.min(1, Math.max(0, s.confidence)) * 100) / 100,
    source: "AI",
    model: res.model,
  };
}
