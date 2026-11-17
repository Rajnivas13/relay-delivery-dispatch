"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bot, ChevronDown, Gauge, RefreshCw, Sparkles, UserCheck, UserX } from "lucide-react";
import { useState } from "react";
import { useApp, useCan } from "@/components/session-context";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Modal, Skeleton, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api-client";
import { humanize, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CandidateView, JobDetail, RecommendationView } from "@/lib/view-types";
import { useJobAction } from "./use-job-action";

export function RecommendationPanel({ job }: { job: JobDetail }) {
  const { aiEnabled } = useApp();
  const { operator } = useCan();
  const [useAi, setUseAi] = useState(true);
  const [chosen, setChosen] = useState<CandidateView | null>(null);
  const [showIneligible, setShowIneligible] = useState(false);
  const aiMode = useAi && aiEnabled && operator;

  const rec = useQuery({
    queryKey: ["rec", job.id, job.version, aiMode],
    queryFn: () => api<RecommendationView>(`/api/jobs/${job.id}/recommendations?ai=${aiMode}`),
    staleTime: 60_000,
  });

  const assign = useJobAction(
    job.id,
    (vars: { riderId: string; overrideReason?: string }) =>
      api(`/api/jobs/${job.id}/assign`, { body: { ...vars, expectedVersion: job.version } }),
    "Rider assigned, waiting for confirmation",
  );

  const data = rec.data;
  const recommendedId = data?.recommendedRiderId ?? null;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Rider recommendation
            {data?.strategy === "AI_RERANK" && (
              <Badge className="border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200">
                <Sparkles className="h-3 w-3" /> AI prediction
              </Badge>
            )}
            {data?.strategy === "SCORE" && <Badge>Score ranking</Badge>}
          </span>
        }
        subtitle={
          data
            ? `${data.candidates.length} eligible · ${data.ineligible.length} excluded${data.model ? ` · ${data.model}${data.latencyMs ? ` in ${data.latencyMs} ms` : ""}` : ""}${data.cached ? " · cached" : ""}`
            : "Eligible riders ranked by fit"
        }
        icon={<Gauge className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-2">
            {operator && aiEnabled && (
              <div className="flex rounded-lg border border-slate-700 p-0.5 text-[11px]">
                <button onClick={() => setUseAi(true)} className={cn("rounded-md px-2 py-1", useAi ? "bg-fuchsia-500/20 text-fuchsia-200" : "text-slate-400")}>
                  AI + score
                </button>
                <button onClick={() => setUseAi(false)} className={cn("rounded-md px-2 py-1", !useAi ? "bg-slate-700 text-white" : "text-slate-400")}>
                  Score only
                </button>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={() => rec.refetch()} loading={rec.isFetching} aria-label="Refresh recommendations">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      />

      {rec.isError ? (
        <ErrorState message={errorMessage(rec.error)} onRetry={() => rec.refetch()} />
      ) : rec.isLoading || !data ? (
        <div className="space-y-2 p-5">
          {aiMode && (
            <div className="mb-3 flex items-center gap-2 text-xs text-fuchsia-200">
              <Bot className="h-4 w-4 animate-pulse" /> Predicting rider acceptance…
            </div>
          )}
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <div className="p-5">
          {!aiEnabled && operator && (
            <p className="mb-3 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-400">
              AI prediction is off (no OPENROUTER_API_KEY). Showing the score ranking.
            </p>
          )}
          {data.usedFallback && (
            <p className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5" /> AI unavailable ({humanize(data.fallbackReason)}), so the score ranking is used.
            </p>
          )}
          {data.summary && (
            <div className="mb-4 rounded-xl border border-fuchsia-500/30 bg-gradient-to-br from-fuchsia-500/10 to-indigo-500/5 p-3 text-sm text-slate-200">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fuchsia-300">
                <Sparkles className="h-3 w-3" /> AI summary
              </div>
              {data.summary}
              {data.riskNote && <div className="mt-2 text-xs text-amber-200">Risk: {data.riskNote}</div>}
            </div>
          )}

          {data.candidates.length === 0 ? (
            <EmptyState
              icon={<UserX className="h-5 w-5" />}
              title="No eligible rider"
              description="Nobody currently online can service these zones with enough free capacity. The job stays in the Manual Queue until a rider frees up or comes online."
            />
          ) : (
            <div className="space-y-2">
              {data.candidates.map((c) => (
                <CandidateRow
                  key={c.riderId}
                  c={c}
                  recommended={c.riderId === recommendedId}
                  scoreTop={c.riderId === data.scoreTopRiderId}
                  canAssign={operator && data.assignable}
                  onAssign={() => setChosen(c)}
                />
              ))}
            </div>
          )}

          {data.ineligible.length > 0 && (
            <div className="mt-4">
              <button onClick={() => setShowIneligible((v) => !v)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showIneligible && "rotate-180")} />
                Why other riders were excluded ({data.ineligible.length})
              </button>
              {showIneligible && (
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {data.ineligible.map((r) => (
                    <div key={r.riderId} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs">
                      <div className="text-slate-300">
                        {r.name} <span className="text-slate-500">({r.code})</span>
                      </div>
                      <div className="mt-0.5 text-slate-500">{r.reasons.join(" · ")}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <AssignDialog
        candidate={chosen}
        recommended={data?.candidates.find((c) => c.riderId === recommendedId) ?? null}
        loading={assign.isPending}
        onClose={() => setChosen(null)}
        onConfirm={(overrideReason) =>
          chosen &&
          assign.mutate({ riderId: chosen.riderId, overrideReason }, { onSuccess: () => setChosen(null) })
        }
      />
    </Card>
  );
}

function CandidateRow({
  c,
  recommended,
  scoreTop,
  canAssign,
  onAssign,
}: {
  c: CandidateView;
  recommended: boolean;
  scoreTop: boolean;
  canAssign: boolean;
  onAssign: () => void;
}) {
  const [open, setOpen] = useState(false);
  const prob = c.ai?.acceptProbability ?? c.acceptProbability;
  return (
    <div className={cn("rounded-xl border p-3", recommended ? "border-emerald-500/40 bg-emerald-500/[0.05]" : "border-slate-800 bg-slate-950/30")}>
      <div className="flex flex-wrap items-center gap-3">
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold", recommended ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-800 text-slate-300")}>
          {c.finalRank}
        </div>
        <div className="min-w-[160px] flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-slate-100">
            {c.name} <span className="text-xs text-slate-500">{c.code}</span>
            {recommended && <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200">Recommended</Badge>}
            {c.ai && c.finalRank === 1 && <Badge className="border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200">AI pick</Badge>}
            {scoreTop && <Badge className="border-sky-500/40 bg-sky-500/10 text-sky-200">Score pick</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-slate-400">{c.ai?.reason ?? c.reasons.join(" · ")}</div>
          {c.warnings.length > 0 && <div className="mt-0.5 text-[11px] text-amber-300">{c.warnings.join(" · ")}</div>}
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <Metric label="Score" value={c.score.toFixed(0)} />
          <Metric label={c.ai ? "AI accept" : "Accept"} value={pct(prob)} tone={prob >= 0.75 ? "text-emerald-300" : prob >= 0.5 ? "text-amber-300" : "text-rose-300"} />
          <Metric label="ETA" value={`${c.ai?.etaMinutes ?? c.etaTotalMinutes}m`} />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-label="Score breakdown">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </Button>
          {canAssign && (
            <Button size="sm" variant={recommended ? "success" : "secondary"} onClick={onAssign}>
              <UserCheck className="h-3.5 w-3.5" /> Assign
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-3 grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-5">
          {c.breakdown.map((f) => (
            <div key={f.key}>
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="text-slate-400">{f.label}</span>
                <span className="tabular-nums text-slate-300">
                  {f.points}/{f.max}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-indigo-400" style={{ width: `${(f.points / f.max) * 100}%` }} />
              </div>
              <div className="mt-1 text-[10px] text-slate-500">{f.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className={cn("text-sm font-semibold tabular-nums text-slate-100", tone)}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

const OVERRIDE_PRESETS = ["Rider already at the pickup", "Customer requested this rider", "Recommended rider is on another call", "Vehicle type better suited"];

function AssignDialog({
  candidate,
  recommended,
  loading,
  onClose,
  onConfirm,
}: {
  candidate: CandidateView | null;
  recommended: CandidateView | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: (overrideReason?: string) => void;
}) {
  const [reason, setReason] = useState("");
  const { timeoutSeconds } = useApp();
  const isOverride = Boolean(candidate && recommended && candidate.riderId !== recommended.riderId);
  const valid = !isOverride || reason.trim().length >= 3;

  return (
    <Modal
      open={Boolean(candidate)}
      onClose={() => {
        setReason("");
        onClose();
      }}
      title={`Assign ${candidate?.name ?? ""}`}
      description={`The rider has ${Math.round(timeoutSeconds / 60)} min to confirm before the job moves to the Manual Queue.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={isOverride ? "primary" : "success"} disabled={!valid} loading={loading} onClick={() => onConfirm(isOverride ? reason.trim() : undefined)}>
            {isOverride ? "Assign with override" : "Assign recommended rider"}
          </Button>
        </>
      }
    >
      {candidate && (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-center">
            <Metric label="Score" value={candidate.score.toFixed(0)} />
            <Metric label="Free after" value={`${candidate.freeUnitsAfter}u`} />
            <Metric label="Active" value={`${candidate.activeJobs}/${candidate.maxActiveJobs}`} />
          </div>
          {isOverride && recommended && (
            <>
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                This overrides the recommendation ({recommended.name}, score {recommended.score.toFixed(0)}). The override and your reason go into the audit trail.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {OVERRIDE_PRESETS.map((p) => (
                  <button key={p} onClick={() => setReason(p)} className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:border-indigo-400">
                    {p}
                  </button>
                ))}
              </div>
              <Field label="Override reason">
                <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              </Field>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
