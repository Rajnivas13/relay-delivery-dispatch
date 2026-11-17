"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, PackagePlus, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PriorityBadge, REASON_LABEL, StatusBadge } from "@/components/badges";
import { Countdown } from "@/components/countdown";
import { useCan } from "@/components/session-context";
import { Button, ButtonLink, Card, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton } from "@/components/ui";
import { useZones } from "@/components/use-zones";
import { JOB_STATUSES, PRIORITIES } from "@/domain/types";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { JobListItem, Paged } from "@/lib/view-types";

export function JobsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { operator } = useCan();
  const zones = useZones();

  const status = params.get("status") ?? "";
  const zone = params.get("zone") ?? "";
  const priority = params.get("priority") ?? "";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [search, setSearch] = useState(q);

  useEffect(() => setSearch(q), [q]);

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in updates)) next.delete("page");
    router.replace(`${pathname}?${next.toString()}`);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) setParam({ q: search || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (status) query.set("status", status);
  if (zone) query.set("zone", zone);
  if (priority) query.set("priority", priority);
  if (q) query.set("q", q);

  const jobs = useQuery({
    queryKey: ["jobs", query.toString()],
    queryFn: () => api<Paged<JobListItem>>(`/api/jobs?${query.toString()}`),
    refetchInterval: 5000,
    placeholderData: keepPreviousData,
  });

  const hasFilters = Boolean(status || zone || priority || q);
  const selectedStatuses = status ? status.split(",") : [];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Delivery jobs"
        subtitle={jobs.data ? `${jobs.data.total} job${jobs.data.total === 1 ? "" : "s"}${hasFilters ? " match the filters" : ""}` : "All jobs"}
        actions={
          operator && (
            <ButtonLink href="/jobs/new">
              <PackagePlus className="h-4 w-4" /> New job
            </ButtonLink>
          )
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order ID, reference or customer" className="pl-9" aria-label="Search jobs" />
          </div>
          <Select value={zone} onChange={(e) => setParam({ zone: e.target.value || null })} className="w-44" aria-label="Zone filter">
            <option value="">All zones</option>
            {zones.data?.map((z) => (
              <option key={z.id} value={z.id}>
                {z.id}
              </option>
            ))}
          </Select>
          <Select value={priority} onChange={(e) => setParam({ priority: e.target.value || null })} className="w-36" aria-label="Priority filter">
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {humanize(p)}
              </option>
            ))}
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => router.replace(pathname)}>
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {JOB_STATUSES.map((s) => {
            const active = selectedStatuses.includes(s);
            return (
              <button
                key={s}
                onClick={() => {
                  const next = active ? selectedStatuses.filter((x) => x !== s) : [...selectedStatuses, s];
                  setParam({ status: next.join(",") || null });
                }}
                className={cn("rounded-full transition-opacity", active || !selectedStatuses.length ? "opacity-100" : "opacity-40 hover:opacity-80")}
                aria-pressed={active}
              >
                <StatusBadge status={s} />
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {jobs.isError ? (
          <ErrorState message={errorMessage(jobs.error)} onRetry={() => jobs.refetch()} />
        ) : jobs.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : !jobs.data?.items.length ? (
          <EmptyState
            title={hasFilters ? "No jobs match these filters" : "No jobs yet"}
            description={hasFilters ? "Try clearing a filter or searching for a different order ID." : "Create the first delivery job to get started."}
            action={operator && !hasFilters ? <ButtonLink href="/jobs/new" size="sm">Create job</ButtonLink> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800 bg-slate-950/40 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Route</th>
                  <th className="px-4 py-3">Load</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Rider</th>
                  <th className="px-4 py-3">Deadline</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {jobs.data.items.map((j) => (
                  <tr key={j.id} className="cursor-pointer hover:bg-slate-800/40" onClick={() => router.push(`/jobs/${j.id}`)}>
                    <td className="px-4 py-3">
                      <Link href={`/jobs/${j.id}`} className="font-mono text-slate-100 hover:text-indigo-300" onClick={(e) => e.stopPropagation()}>
                        {j.reference}
                      </Link>
                      {j.customerName && <div className="text-[11px] text-slate-500">{j.customerName}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={j.status} />
                      {j.status === "MANUAL_QUEUE" && j.manualQueueReason && (
                        <div className="mt-1 text-[11px] text-rose-300/80">{REASON_LABEL[j.manualQueueReason] ?? humanize(j.manualQueueReason)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {j.pickupZoneId} <span className="text-slate-500">→</span> {j.dropZoneId}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-300">{j.loadUnits}</td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={j.priority} />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {j.latestAssignment && ["AWAITING_CONFIRMATION", "ACCEPTED", "PICKED_UP", "DELIVERED"].includes(j.status) ? (
                        <div className="space-y-1">
                          <div className="text-slate-200">{j.latestAssignment.rider.name}</div>
                          {j.status === "AWAITING_CONFIRMATION" && <Countdown expiresAt={j.latestAssignment.expiresAt} compact />}
                        </div>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{j.deadlineAt ? formatDateTime(j.deadlineAt) : "-"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(j.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {jobs.data && jobs.data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3 text-xs text-slate-400">
            <span>
              Page {jobs.data.page} of {jobs.data.totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= jobs.data.totalPages} onClick={() => setParam({ page: String(page + 1) })}>
                Next <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
