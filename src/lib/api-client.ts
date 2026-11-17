export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: { ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the server. Check your connection.");
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
      window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const reasons = (err.details as { reasons?: string[] } | undefined)?.reasons;
    if (Array.isArray(reasons) && reasons.length) return `${err.message}: ${reasons.join("; ")}`;
    const issues = err.details as { path: string; message: string }[] | undefined;
    if (err.code === "VALIDATION_ERROR" && Array.isArray(issues) && issues.length) {
      return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ");
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Unexpected error";
}
