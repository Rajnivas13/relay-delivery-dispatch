"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Siren } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { PriorityBadge, REASON_LABEL } from "@/components/badges";
import { useCan } from "@/components/session-context";
import { SuggestionCard } from "@/components/suggestion-card";
import { Badge, ButtonLink, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime, formatDuration, humanize } from "@/lib/format";
import type { AssignmentView, JobBase } from "@/lib/view-types";

interface QueueItem extends JobBase {
  attempts: number;
  lastAssignment: AssignmentView | null;
  waitingSeconds: number;
}

const REASON_ORDER = ["CONFIRMATION_TIMEOUT", "RIDER_REJECTED", "NO_ELIGIBLE_RIDER", "RELEASED_BY_DISPATCHER"];

export default function ManualQueuePage() {
  const { operator } = useCan();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["manual-queue"],
    queryFn: () => api<{ count: number; items: QueueItem[] }>("/api/manual-queue"),
    refetchInterval: 5000,
  });

  const reassign = useMutation({
    mutationFn: (v: { jobId: string; riderId: string }) =>
      api(`/api/jobs/${v.jobId}/assign`, { body: { riderId: v.riderId, overrideReason: "Applied next-action suggestion" } }),
    onSuccess: () => toast.success("Reassigned, waiting for rider confirmation"),
    onError: (err) => toast.error("Reassign failed", { description: errorMessage(err) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["manual-queue"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const groups = REASON_ORDER.map((reason) => ({
    reason,
    items: (q.data?.items ?? []).filter((i) => (i.manualQueueReason ?? "") === reason),
  }));
  const other = (q.data?.items ?? []).filter((i) => !REASON_ORDER.includes(i.manualQueueReason ?? ""));
  if (other.length) groups.push({ reason: "OTHER", items: other });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Manual queue"
        subtitle="Jobs that timed out, were rejected, or have no eligible rider. Oldest first. Nothing leaves this queue without an action."
      />
      {q.isError ? (
        <Card>
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        </Card>
      ) : q.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : !q.data?.items.length ? (
        <Card>
          <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="The Manual Queue is empty" description="Every job is either assigned, in progress, or done." />
        </Card>
      ) : (
        <div className="space-y-6">
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <section key={g.reason}>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-200">
                  <Siren className="h-4 w-4" /> {REASON_LABEL[g.reason] ?? humanize(g.reason)}
                  <span className="text-slate-500">({g.items.length})</span>
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {g.items.map((item) => (
                    <Card key={item.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Link href={`/jobs/${item.id}`} className="font-mono text-base font-semibold text-white hover:text-indigo-300">
                            {item.reference}
                          </Link>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <PriorityBadge priority={item.priority} />
                            {item.pickupZoneId} → {item.dropZoneId} · {item.loadUnits} units
                          </div>
                        </div>
                        <Badge className={item.waitingSeconds > 900 ? "border-rose-500/50 bg-rose-500/15 text-rose-200" : undefined}>
                          waiting {formatDuration(item.waitingSeconds)}
                        </Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Attempts</div>
                          <div className="text-slate-200">{item.attempts}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Last rider</div>
                          <div className="text-slate-200">
                            {item.lastAssignment ? `${item.lastAssignment.rider.name} · ${humanize(item.lastAssignment.status)}` : "None"}
                          </div>
                        </div>
                        {item.deadlineAt && (
                          <div className="col-span-2">
                            <div className="text-[10px] uppercase tracking-wide text-slate-500">Deadline</div>
                            <div className="text-slate-200">{formatDateTime(item.deadlineAt)}</div>
                          </div>
                        )}
                      </div>
                      {operator && (
                        <div className="mt-3">
                          <SuggestionCard jobId={item.id} compact onApply={(riderId) => reassign.mutate({ jobId: item.id, riderId })} />
                        </div>
                      )}
                      <div className="mt-3 flex justify-end">
                        <ButtonLink href={`/jobs/${item.id}`} variant="secondary" size="sm">
                          Investigate & reassign <ArrowRight className="h-3.5 w-3.5" />
                        </ButtonLink>
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
