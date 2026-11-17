"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2, History, MapPin, PackageCheck, Truck, UserMinus, UserX } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AssignmentBadge, PriorityBadge, REASON_LABEL, StatusBadge } from "@/components/badges";
import { Countdown } from "@/components/countdown";
import { ReasonDialog } from "@/components/reason-dialog";
import { useCan, useNow } from "@/components/session-context";
import { SuggestionCard } from "@/components/suggestion-card";
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, ErrorState, Skeleton, Stat } from "@/components/ui";
import { TRANSITIONS } from "@/domain/jobStateMachine";
import type { JobStatus } from "@/domain/types";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatDateTime, formatDuration, humanize, relativeTo } from "@/lib/format";
import type { JobDetail, JobEventView, RiderView } from "@/lib/view-types";
import { RecommendationPanel } from "./recommendation-panel";
import { Timeline } from "./timeline";
import { useJobAction } from "./use-job-action";

type DialogKind = "cancel" | "reject" | "release" | null;

export function JobDetailView({ id }: { id: string }) {
  const { operator } = useCan();
  const now = useNow(5000);
  const [dialog, setDialog] = useState<DialogKind>(null);

  const job = useQuery({
    queryKey: ["job", id],
    queryFn: () => api<JobDetail>(`/api/jobs/${id}`),
    refetchInterval: 4000,
  });
  const events = useQuery({
    queryKey: ["events", id],
    queryFn: () => api<{ events: JobEventView[] }>(`/api/jobs/${id}/events`).then((r) => r.events),
    refetchInterval: 4000,
  });
  const riders = useQuery({
    queryKey: ["riders"],
    queryFn: () => api<{ items: RiderView[] }>("/api/riders").then((r) => r.items),
    staleTime: 30_000,
  });

  const jobId = job.data?.id ?? id;
  const assignmentId = job.data?.currentAssignment?.id;
  const accept = useJobAction(jobId, () => api(`/api/assignments/${assignmentId}/accept`, { method: "POST" }), "Rider confirmed");
  const reject = useJobAction(jobId, (reason: string) => api(`/api/assignments/${assignmentId}/reject`, { body: { reason } }), "Rejected, job moved to the Manual Queue");
  const pickup = useJobAction(jobId, () => api(`/api/jobs/${jobId}/pickup`, { method: "POST" }), "Marked as picked up");
  const deliver = useJobAction(jobId, () => api(`/api/jobs/${jobId}/deliver`, { method: "POST" }), "Delivered");
  const cancel = useJobAction(jobId, (reason: string) => api(`/api/jobs/${jobId}/cancel`, { body: { reason, expectedVersion: job.data?.version } }), "Job cancelled");
  const release = useJobAction(jobId, (reason: string) => api(`/api/jobs/${jobId}/release`, { body: { reason } }), "Rider released, job in the Manual Queue");

  if (job.isError) {
    const notFound = job.error instanceof ApiError && job.error.status === 404;
    return (
      <Card className="mx-auto max-w-xl">
        {notFound ? (
          <EmptyState title="Job not found" description={`No job with id or reference "${id}".`} action={<ButtonLink href="/jobs" size="sm">Back to jobs</ButtonLink>} />
        ) : (
          <ErrorState message={errorMessage(job.error)} onRetry={() => job.refetch()} />
        )}
      </Card>
    );
  }
  if (job.isLoading || !job.data) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const j = job.data;
  const status = j.status as JobStatus;
  const allowed = TRANSITIONS[status];
  const current = j.currentAssignment;
  const assignable = status === "READY_FOR_ASSIGNMENT" || status === "MANUAL_QUEUE";
  const riderNames = Object.fromEntries((riders.data ?? []).map((r) => [r.id, `${r.name} (${r.code})`]));

  return (
    <div className="mx-auto max-w-7xl">
      <Link href="/jobs" className="mb-4 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" /> All jobs
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold text-white">{j.reference}</h1>
            <StatusBadge status={j.status} />
            <PriorityBadge priority={j.priority} />
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {j.customerName ?? "No customer name"} · created {relativeTo(j.createdAt, now)} · v{j.version}
          </p>
        </div>
        {operator && (
          <div className="flex flex-wrap gap-2">
            {(status === "ACCEPTED" || status === "AWAITING_CONFIRMATION") && (
              <Button variant="secondary" onClick={() => setDialog("release")}>
                <UserMinus className="h-4 w-4" /> Release rider
              </Button>
            )}
            {allowed.includes("CANCELLED") && (
              <Button variant="danger" onClick={() => setDialog("cancel")}>
                <Ban className="h-4 w-4" /> Cancel job
              </Button>
            )}
          </div>
        )}
      </div>

      {status === "MANUAL_QUEUE" && (
        <Card className="mb-4 border-rose-500/40 bg-rose-500/[0.06] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-rose-200">
                Needs intervention: {REASON_LABEL[j.manualQueueReason ?? ""] ?? humanize(j.manualQueueReason)}
              </div>
              <div className="text-xs text-rose-200/70">
                In the Manual Queue for {j.manualQueuedAt ? formatDuration((now.getTime() - new Date(j.manualQueuedAt).getTime()) / 1000) : "-"} · {j.assignments.length} previous attempt(s). Reassign below or cancel.
              </div>
            </div>
          </div>
          {operator && <div className="mt-3"><SuggestionCard jobId={j.id} /></div>}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Route" value={<span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-slate-500" />{j.pickupZoneId} → {j.dropZoneId}</span>} />
              <Stat label="Load" value={`${j.loadUnits} units`} />
              <Stat
                label="Deadline"
                value={
                  j.deadlineAt ? (
                    <span className={new Date(j.deadlineAt) < now && !["DELIVERED", "CANCELLED"].includes(status) ? "text-rose-300" : ""}>
                      {formatDateTime(j.deadlineAt)}
                    </span>
                  ) : (
                    "None"
                  )
                }
              />
              <Stat label="Updated" value={formatDateTime(j.updatedAt)} />
            </div>
            {j.notes && <p className="mt-4 rounded-lg bg-slate-950/40 px-3 py-2 text-xs text-slate-300">{j.notes}</p>}
          </Card>

          {current && (
            <Card>
              <CardHeader
                title="Current assignment"
                subtitle={`Offered ${formatDateTime(current.offeredAt)} by ${current.assignedByName ?? humanize(current.assignedByType)}`}
                action={<AssignmentBadge status={current.status} />}
              />
              <div className="flex flex-wrap items-center gap-6 p-5">
                <div>
                  <div className="text-base font-semibold text-slate-100">{current.rider.name}</div>
                  <div className="text-xs text-slate-500">
                    {current.rider.code} · {current.rider.phone ?? "no phone"} · {current.reservedUnits} units reserved
                  </div>
                  {current.isOverride && (
                    <Badge className="mt-2 border-orange-500/40 bg-orange-500/10 text-orange-200">Override: {current.overrideReason}</Badge>
                  )}
                </div>
                {current.status === "PENDING" && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Confirm within</div>
                    <Countdown expiresAt={current.expiresAt} className="mt-1 text-sm" />
                  </div>
                )}
                {operator && (
                  <div className="ml-auto flex flex-wrap gap-2">
                    {status === "AWAITING_CONFIRMATION" && (
                      <>
                        <Button variant="success" size="sm" loading={accept.isPending} onClick={() => accept.mutate(undefined)}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Rider accepts
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setDialog("reject")}>
                          <UserX className="h-3.5 w-3.5" /> Rider rejects
                        </Button>
                      </>
                    )}
                    {status === "ACCEPTED" && (
                      <Button size="sm" loading={pickup.isPending} onClick={() => pickup.mutate(undefined)}>
                        <Truck className="h-3.5 w-3.5" /> Mark picked up
                      </Button>
                    )}
                    {status === "PICKED_UP" && (
                      <Button variant="success" size="sm" loading={deliver.isPending} onClick={() => deliver.mutate(undefined)}>
                        <PackageCheck className="h-3.5 w-3.5" /> Mark delivered
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {operator && status === "AWAITING_CONFIRMATION" && (
                <p className="border-t border-slate-800 px-5 py-2 text-[11px] text-slate-500">
                  Rider actions here simulate the rider app for demos and are logged under your name. Riders use{" "}
                  <Link href={`/rider/${current.riderId}`} className="text-indigo-300 hover:underline">
                    their own app
                  </Link>
                  .
                </p>
              )}
            </Card>
          )}

          {assignable && <RecommendationPanel job={j} />}

          <Card>
            <CardHeader title="Assignment attempts" subtitle="Every offer, including failed and expired ones" />
            {j.assignments.length === 0 ? (
              <EmptyState title="No assignment attempts yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-2">#</th>
                      <th className="px-5 py-2">Rider</th>
                      <th className="px-5 py-2">Outcome</th>
                      <th className="px-5 py-2">Offered</th>
                      <th className="px-5 py-2">Deadline</th>
                      <th className="px-5 py-2">Ended / reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {[...j.assignments].reverse().map((a, i) => (
                      <tr key={a.id}>
                        <td className="px-5 py-2 text-slate-500">{i + 1}</td>
                        <td className="px-5 py-2 text-slate-200">
                          {a.rider.name} <span className="text-slate-500">{a.rider.code}</span>
                          {a.isOverride && <span className="ml-1 text-orange-300">(override)</span>}
                        </td>
                        <td className="px-5 py-2">
                          <AssignmentBadge status={a.status} />
                        </td>
                        <td className="px-5 py-2 text-slate-400">{formatDateTime(a.offeredAt)}</td>
                        <td className="px-5 py-2 text-slate-400">{formatDateTime(a.expiresAt)}</td>
                        <td className="px-5 py-2 text-slate-400">
                          {a.endedAt ? formatDateTime(a.endedAt) : a.respondedAt ? `accepted ${formatDateTime(a.respondedAt)}` : "-"}
                          {a.endReason && <div className="text-[10px] text-slate-500">{humanize(a.endReason)}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader title="Activity history" subtitle="Append-only audit trail" icon={<History className="h-4 w-4" />} />
          <div className="max-h-[75vh] overflow-y-auto p-5">
            {events.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : events.isError ? (
              <ErrorState message={errorMessage(events.error)} onRetry={() => events.refetch()} />
            ) : (
              <Timeline events={events.data ?? []} riderNames={riderNames} />
            )}
          </div>
        </Card>
      </div>

      <ReasonDialog
        open={dialog === "cancel"}
        onClose={() => setDialog(null)}
        title={`Cancel ${j.reference}?`}
        description="Any reserved rider capacity is released. This cannot be undone."
        confirmLabel="Cancel job"
        loading={cancel.isPending}
        presets={["Customer cancelled", "Duplicate order", "Address unreachable"]}
        onSubmit={(reason) => cancel.mutate(reason, { onSuccess: () => setDialog(null) })}
      />
      <ReasonDialog
        open={dialog === "reject"}
        onClose={() => setDialog(null)}
        title="Rider rejects the offer"
        description="Capacity is released and the job moves to the Manual Queue. This rider won't be recommended for this job again."
        confirmLabel="Record rejection"
        loading={reject.isPending}
        presets={["Too far away", "Vehicle issue", "Already on another delivery", "Shift ending"]}
        onSubmit={(reason) => reject.mutate(reason, { onSuccess: () => setDialog(null) })}
      />
      <ReasonDialog
        open={dialog === "release"}
        onClose={() => setDialog(null)}
        title="Release the rider"
        description="Takes the job back from the rider before pickup and moves it to the Manual Queue."
        confirmLabel="Release rider"
        loading={release.isPending}
        presets={["Rider unreachable", "Vehicle breakdown", "Rider reported sick"]}
        onSubmit={(reason) => release.mutate(reason, { onSuccess: () => setDialog(null) })}
      />
    </div>
  );
}
