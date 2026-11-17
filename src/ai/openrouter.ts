export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AiCallOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export type AiCallResult =
  | { ok: true; data: unknown; model: string; latencyMs: number }
  | { ok: false; reason: string; model: string; latencyMs: number };

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export function aiConfig(opts: AiCallOptions = {}) {
  return {
    apiKey: opts.apiKey ?? process.env.OPENROUTER_API_KEY ?? "",
    model: opts.model ?? process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
    timeoutMs: opts.timeoutMs ?? Number(process.env.AI_TIMEOUT_MS ?? 8000),
    fetchImpl: opts.fetchImpl ?? (fetch as FetchLike),
  };
}

export function isAiEnabled(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/** Models sometimes wrap JSON in prose or code fences even when asked for a schema. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("Response did not contain JSON");
  }
}

/** One structured-output chat completion. Never throws: failures come back as `{ ok: false }`. */
export async function chatJson(
  params: { system: string; user: string; schemaName: string; schema: Record<string, unknown> },
  opts: AiCallOptions = {},
): Promise<AiCallResult> {
  const cfg = aiConfig(opts);
  const started = Date.now();
  const done = (r: { ok: true; data: unknown } | { ok: false; reason: string }): AiCallResult => ({
    ...r,
    model: cfg.model,
    latencyMs: Date.now() - started,
  });

  if (!cfg.apiKey) return done({ ok: false, reason: "AI_DISABLED" });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await cfg.fetchImpl(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL ?? "https://relay.local",
        "X-Title": "Project RELAY Dispatch Desk",
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: params.schemaName, strict: true, schema: params.schema },
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return done({ ok: false, reason: `AI_HTTP_${res.status}${body ? `: ${body.slice(0, 160)}` : ""}` });
    }
    const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return done({ ok: false, reason: "AI_EMPTY_RESPONSE" });
    try {
      return done({ ok: true, data: extractJson(content) });
    } catch {
      return done({ ok: false, reason: "AI_INVALID_JSON" });
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return done({ ok: false, reason: aborted ? "AI_TIMEOUT" : "AI_NETWORK_ERROR" });
  } finally {
    clearTimeout(timer);
  }
}
