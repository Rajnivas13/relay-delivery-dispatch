"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bell, CheckCircle2, LogOut, MapPin, Package, PackageCheck, Truck, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { logout } from "@/app/(auth)/login/actions";
import { AssignmentBadge, PriorityBadge } from "@/components/badges";
import { Countdown } from "@/components/countdown";
import { ReasonDialog } from "@/components/reason-dialog";
import { useApp } from "@/components/session-context";
import { Button, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { RIDER_AVAILABILITY } from "@/domain/types";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatDateTime, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AssignmentView, RiderView } from "@/lib/view-types";

interface OffersView {
  rider: RiderView;
  now: string;
  active: (RiderView["assignments"][number] & { secondsLeft: number | null })[];
  recent: (AssignmentView & { job: { id: string; reference: string; status: string; pickupZoneId: string; dropZoneId: string } })[];
}

export function RiderApp({ riderId, mode }: { riderId: string; mode: "self" | "staff" }) {
  const { user } = useApp();
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["rider-offers", riderId],
    queryFn: () => api<OffersView>(`/api/riders/${riderId}/offers`),
    refetchInterval: 3000,
  });

  const act = useMutation({
    mutationFn: (v: { path: string; body?: unknown; label: string }) => api(v.path, { method: "POST", body: v.body }),
    onSuccess: (_d, v) => toast.success(v.label),
    onError: (err) => {
      const expired = err instanceof ApiError && err.code === "ASSIGNMENT_EXPIRED";
      toast.error(expired ? "Too late, this offer expired" : "Action failed", { description: errorMessage(err) });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["rider-offers", riderId] }),
  });

  const availability = useMutation({
    mutationFn: (value: string) =>
      mode === "self"
        ? api("/api/me/availability", { method: "PATCH", body: { availability: value } })
        : api(`/api/riders/${riderId}`, { method: "PATCH", body: { availability: value } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rider-offers", riderId] }),
    onError: (err) => toast.error("Could not change availability", { description: errorMessage(err) }),
  });

  const rider = q.data?.rider;
  const pending = q.data?.active.filter((a) => a.status === "PENDING") ?? [];
  const accepted = q.data?.active.filter((a) => a.status === "ACCEPTED") ?? [];

  return (
    <div className="w-full max-w-md">
      {mode === "staff" && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          <span>Acting as rider · logged as {user.name}</span>
          <Link href="/rider" className="inline-flex items-center gap-1 hover:text-white">
            <ArrowLeft className="h-3 w-3" /> riders
          </Link>
        </div>
      )}
      <div className="overflow-hidden rounded-[2rem] border border-slate-700 bg-slate-900 shadow-2xl shadow-indigo-500/10">
        <div className="bg-gradient-to-br from-indigo-600 to-fuchsia-600 px-5 pb-5 pt-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-indigo-100/80">RELAY Rider</div>
              <div className="text-xl font-semibold text-white">{rider?.name ?? "…"}</div>
              <div className="text-xs text-indigo-100/80">
                {rider ? `${rider.code} · at ${rider.currentZoneId} · ${rider.freeUnits}/${rider.capacityUnits} units free` : ""}
              </div>
            </div>
            {mode === "self" && (
              <form action={logout}>
                <button className="rounded-full bg-white/15 p-2 text-white hover:bg-white/25" aria-label="Sign out">
                  <LogOut className="h-4 w-4" />
                </button>
              </form>
            )}
          </div>
          {rider && (
            <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-black/20 p-1">
              {RIDER_AVAILABILITY.map((a) => (
                <button
                  key={a}
                  disabled={availability.isPending}
                  onClick={() => availability.mutate(a)}
                  className={cn("rounded-lg py-1.5 text-xs font-medium", rider.availability === a ? "bg-white text-slate-900" : "text-white/80 hover:bg-white/10")}
                >
                  {humanize(a)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-[420px] space-y-4 p-4">
          {q.isError ? (
            <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
          ) : q.isLoading ? (
            <>
              <Skeleton className="h-36" />
              <Skeleton className="h-24" />
            </>
          ) : (
            <>
              <section>
                <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
                  <Bell className="h-3.5 w-3.5" /> New offers ({pending.length})
                </h2>
                {pending.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-xs text-slate-500">
                    {rider?.availability === "ONLINE" ? "No offers right now. Stay online." : "You are not online, so you won't get offers."}
                  </p>
                ) : (
                  pending.map((a) => (
                    <div key={a.id} className="mb-2 rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-sm font-semibold text-white">{a.job.reference}</span>
                        <Countdown expiresAt={a.expiresAt} />
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-sm text-slate-200">
                        <MapPin className="h-4 w-4 text-slate-400" /> {a.job.pickupZoneId} → {a.job.dropZoneId}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                        <Package className="h-3.5 w-3.5" /> {a.job.loadUnits} units <PriorityBadge priority={a.job.priority} />
                        {a.job.deadlineAt && <span>due {formatDateTime(a.job.deadlineAt)}</span>}
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={() => setRejecting(a.id)} disabled={act.isPending}>
                          <X className="h-4 w-4" /> Reject
                        </Button>
                        <Button
                          variant="success"
                          loading={act.isPending && act.variables?.path.includes(a.id)}
                          onClick={() => act.mutate({ path: `/api/assignments/${a.id}/accept`, label: `Accepted ${a.job.reference}` })}
                        >
                          <CheckCircle2 className="h-4 w-4" /> Accept
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </section>

              <section>
                <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-300">
                  <Truck className="h-3.5 w-3.5" /> My deliveries ({accepted.length})
                </h2>
                {accepted.length === 0 ? (
                  <EmptyState title="No active deliveries" />
                ) : (
                  accepted.map((a) => {
                    const picked = a.job.status === "PICKED_UP";
                    return (
                      <div key={a.id} className="mb-2 rounded-2xl border border-indigo-500/40 bg-indigo-500/[0.06] p-4">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-sm font-semibold text-white">{a.job.reference}</span>
                          <span className="text-xs text-indigo-200">{picked ? "On the way" : "Go to pickup"}</span>
                        </div>
                        <div className="mt-2 text-sm text-slate-200">
                          {a.job.pickupZoneId} → {a.job.dropZoneId} · {a.job.loadUnits} units
                        </div>
                        <Button
                          className="mt-3 w-full"
                          variant={picked ? "success" : "primary"}
                          loading={act.isPending && act.variables?.path.includes(a.job.id)}
                          onClick={() =>
                            act.mutate({
                              path: `/api/jobs/${a.job.id}/${picked ? "deliver" : "pickup"}`,
                              label: picked ? `Delivered ${a.job.reference}` : `Picked up ${a.job.reference}`,
                            })
                          }
                        >
                          {picked ? <PackageCheck className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
                          {picked ? "Mark delivered" : "Confirm pickup"}
                        </Button>
                      </div>
                    );
                  })
                )}
              </section>

              {q.data && q.data.recent.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent</h2>
                  <div className="divide-y divide-slate-800 rounded-xl border border-slate-800">
                    {q.data.recent.map((a) => (
                      <div key={a.id} className="flex items-center justify-between px-3 py-2 text-xs">
                        <span className="font-mono text-slate-300">{a.job.reference}</span>
                        <AssignmentBadge status={a.status} />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      <ReasonDialog
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="Reject this offer?"
        description="The job goes back to dispatch."
        confirmLabel="Reject offer"
        presets={["Too far away", "Vehicle issue", "Already on another delivery", "Shift ending"]}
        loading={act.isPending}
        onSubmit={(reason) =>
          act.mutate(
            { path: `/api/assignments/${rejecting}/reject`, body: { reason }, label: "Offer rejected" },
            { onSuccess: () => setRejecting(null) },
          )
        }
      />
    </div>
  );
}
