import { describe, expect, it, vi } from "vitest";
import { extractJson, type FetchLike } from "@/ai/openrouter";
import { rerankWithAi } from "@/ai/reranker";
import { ruleBasedSuggestion, suggestNextAction } from "@/ai/suggest";
import type { JobSnapshot, RiderSnapshot } from "@/domain/eligibility";
import { makeTravelFn, rankRiders } from "@/domain/scoring";

const now = new Date("2026-01-01T10:00:00Z");
const job: JobSnapshot = { pickupZoneId: "A", dropZoneId: "B", loadUnits: 1, priority: "NORMAL", deadlineAt: null };
const r = (id: string, zone = "A"): RiderSnapshot => ({
  id,
  code: id.toUpperCase(),
  name: id,
  availability: "ONLINE",
  currentZoneId: zone,
  zoneIds: ["A", "B"],
  capacityUnits: 10,
  reservedUnits: 0,
  activeJobCount: 0,
  maxActiveJobs: 3,
  offersReceived: 4,
  offersAccepted: 3,
});
const candidates = rankRiders([r("r1"), r("r2", "B")], job, makeTravelFn([{ fromZoneId: "A", toZoneId: "B", minutes: 20 }]), now).eligible;

const reply = (content: unknown, status = 200): FetchLike =>
  vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status }),
  );

const opts = (fetchImpl: FetchLike) => ({ apiKey: "test-key", model: "test/model", timeoutMs: 200, fetchImpl });

describe("AI reranker", () => {
  it("accepts a valid re-ranking of eligible riders", async () => {
    const res = await rerankWithAi(
      job,
      candidates,
      now,
      opts(
        reply({
          ranking: [
            { riderId: "r2", acceptProbability: 0.91, etaMinutes: 30, reason: "Historically quick to accept" },
            { riderId: "r1", acceptProbability: 0.7, etaMinutes: 33, reason: "Closer but busier" },
          ],
          summary: "r2 is the safest bet",
          riskNote: null,
        }),
      ),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.ranking.map((x) => x.riderId)).toEqual(["r2", "r1"]);
      expect(res.ranking[0].acceptProbability).toBe(0.91);
    }
  });

  it("falls back when the model names a rider outside the eligible list", async () => {
    const res = await rerankWithAi(job, candidates, now, opts(reply({ ranking: [{ riderId: "ghost", acceptProbability: 1, etaMinutes: 1, reason: "x" }], summary: "", riskNote: null })));
    expect(res).toMatchObject({ ok: false, fallbackReason: "AI_UNKNOWN_RIDER" });
  });

  it("falls back on duplicates, invalid JSON, HTTP errors and missing key", async () => {
    const dup = await rerankWithAi(
      job,
      candidates,
      now,
      opts(reply({ ranking: [{ riderId: "r1", acceptProbability: 1, etaMinutes: 1, reason: "a" }, { riderId: "r1", acceptProbability: 1, etaMinutes: 1, reason: "b" }], summary: "", riskNote: null })),
    );
    expect(dup).toMatchObject({ ok: false, fallbackReason: "AI_DUPLICATE_RIDER" });
    expect(await rerankWithAi(job, candidates, now, opts(reply("not json at all")))).toMatchObject({ ok: false, fallbackReason: "AI_INVALID_JSON" });
    expect((await rerankWithAi(job, candidates, now, opts(reply({}, 503)))).ok).toBe(false);
    expect(await rerankWithAi(job, candidates, now, { apiKey: "" })).toMatchObject({ ok: false, fallbackReason: "AI_DISABLED" });
  });

  it("times out slow responses", async () => {
    const slow: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    expect(await rerankWithAi(job, candidates, now, opts(slow))).toMatchObject({ ok: false, fallbackReason: "AI_TIMEOUT" });
  });

  it("appends candidates the model skipped", async () => {
    const res = await rerankWithAi(job, candidates, now, opts(reply({ ranking: [{ riderId: "r2", acceptProbability: 0.8, etaMinutes: 20, reason: "ok" }], summary: "s", riskNote: null })));
    expect(res.ok && res.ranking.map((x) => x.riderId)).toEqual(["r2", "r1"]);
  });

  it("extracts JSON wrapped in code fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

describe("manual queue suggestion", () => {
  const ctx = {
    job: { reference: "J", status: "MANUAL_QUEUE", manualQueueReason: "CONFIRMATION_TIMEOUT", priority: "NORMAL", pickupZoneId: "A", dropZoneId: "B", loadUnits: 1, deadlineAt: null },
    minutesInQueue: 5,
    attempts: [],
    recentEvents: [],
    candidates,
    now,
  };

  it("uses rules when AI is unavailable", async () => {
    const s = await suggestNextAction(ctx, { apiKey: "" });
    expect(s).toMatchObject({ source: "RULES", action: "REASSIGN", riderId: candidates[0].riderId, fallbackReason: "AI_DISABLED" });
  });

  it("rejects an AI reassignment to an unknown rider", async () => {
    const s = await suggestNextAction(ctx, opts(reply({ action: "REASSIGN", riderId: "ghost", rationale: "x", confidence: 0.9 })));
    expect(s.source).toBe("RULES");
  });

  it("never sends customer details to the model", async () => {
    const fetchImpl = vi.fn(reply({ action: "WAIT", riderId: null, rationale: "ok", confidence: 0.5 }));
    const job = { ...ctx.job, customerName: "Secret Customer", notes: "Gate code 4421" };
    await suggestNextAction({ ...ctx, job }, opts(fetchImpl));
    const body = String((fetchImpl.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain('\\"reference\\": \\"J\\"');
    expect(body).not.toContain("Secret Customer");
    expect(body).not.toContain("4421");
  });

  it("escalates when the deadline has passed", () => {
    const s = ruleBasedSuggestion({ ...ctx, job: { ...ctx.job, deadlineAt: new Date(now.getTime() - 1000) } });
    expect(s.action).toBe("ESCALATE");
  });
});
