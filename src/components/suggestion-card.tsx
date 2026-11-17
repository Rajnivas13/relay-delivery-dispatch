"use client";

import { useMutation } from "@tanstack/react-query";
import { Bot, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api-client";
import { humanize, pct } from "@/lib/format";
import { Badge, Button } from "./ui";

export interface SuggestionView {
  action: string;
  riderId: string | null;
  riderCode: string | null;
  riderName: string | null;
  rationale: string;
  confidence: number;
  source: "AI" | "RULES";
  model?: string;
  fallbackReason?: string;
}

export function SuggestionCard({
  jobId,
  onApply,
  compact,
}: {
  jobId: string;
  onApply?: (riderId: string) => void;
  compact?: boolean;
}) {
  const m = useMutation({
    mutationFn: () => api<SuggestionView>(`/api/jobs/${jobId}/suggestion`, { method: "POST" }),
    onError: (err) => toast.error("Suggestion failed", { description: errorMessage(err) }),
  });
  const s = m.data;

  return (
    <div className="rounded-xl border border-fuchsia-500/30 bg-gradient-to-br from-fuchsia-500/[0.08] to-indigo-500/[0.04] p-3">
      {!s ? (
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-slate-300">
            <span className="font-medium text-fuchsia-200">Stuck?</span> Get a suggested next action from the job&apos;s history.
          </div>
          <Button variant="ai" size="sm" loading={m.isPending} onClick={() => m.mutate()}>
            <Sparkles className="h-3.5 w-3.5" /> Suggest
          </Button>
        </div>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Bot className="h-4 w-4 text-fuchsia-300" />
            <span className="font-semibold text-slate-100">
              {humanize(s.action)}
              {s.riderName ? ` → ${s.riderName} (${s.riderCode})` : ""}
            </span>
            <Badge className="border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200">
              {s.source === "AI" ? `AI · ${pct(s.confidence)}` : "Rule-based"}
            </Badge>
            {s.fallbackReason && <span className="text-[10px] text-amber-300">AI fallback: {humanize(s.fallbackReason)}</span>}
          </div>
          {!compact && <p className="text-slate-300">{s.rationale}</p>}
          <div className="flex gap-2">
            {s.action === "REASSIGN" && s.riderId && onApply && (
              <Button size="sm" variant="success" onClick={() => onApply(s.riderId!)}>
                Reassign to {s.riderName?.split(" ")[0]}
              </Button>
            )}
            <Button size="sm" variant="ghost" loading={m.isPending} onClick={() => m.mutate()}>
              Ask again
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
