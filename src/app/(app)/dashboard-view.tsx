"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlarmClock,
  Ban,
  Bike,
  CheckCircle2,
  Hourglass,
  Inbox,
  PackagePlus,
  Siren,
  Timer,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PriorityBadge, REASON_LABEL } from "@/components/badges";
import { Countdown } from "@/components/countdown";
import { useCan } from "@/components/session-context";
import { ButtonLink, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime, formatDuration, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardSummary } from "@/lib/view-types";

const KPI = [
  { key: "totalReceived", label: "Jobs received", icon: Inbox, tone: "text-slate-200", href: "/jobs" },
  { key: "awaitingAssignment", label: "Awaiting assignment", icon: Hourglass, tone: "text-sky-300", href: "/jobs?status=NEW,READY_FOR_ASSIGNMENT" },
  { key: "awaitingConfirmation", label: "Awaiting rider", icon: Timer, tone: "text-amber-300", href: "/jobs?status=AWAITING_CONFIRMATION" },
  { key: "inProgress", label: "In progress", icon: Truck, tone: "text-indigo-300", href: "/jobs?status=ACCEPTED,PICKED_UP" },
  { key: "manualQueue", label: "Manual queue", icon: Siren, tone: "text-rose-300", href: "/manual-queue" },
  { key: "delivered", label: "Delivered", icon: CheckCircle2, tone: "text-emerald-300", href: "/jobs?status=DELIVERED" },
  { key: "cancelled", label: "Cancelled", icon: Ban, tone: "text-zinc-400", href: "/jobs?status=CANCELLED" },
] as const;

const STATUS_COLORS: Record<string, string> = {
  NEW: "#94a3b8",
  READY_FOR_ASSIGNMENT: "#38bdf8",
  AWAITING_CONFIRMATION: "#fbbf24",
  ACCEPTED: "#818cf8",
  PICKED_UP: "#a78bfa",
  DELIVERED: "#34d399",
  MANUAL_QUEUE: "#fb7185",
  CANCELLED: "#71717a",
};

export function DashboardView() {
  const { operator } = useCan();
  const q = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardSummary>("/api/dashboard/summary"),
    refetchInterval: 5000,
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Dispatch overview"
        subtitle={q.data ? `Live, refreshed every 5s · server time ${formatDateTime(q.data.now)}` : "Live operational view"}
        actions={
          operator && (
            <ButtonLink href="/jobs/new">
              <PackagePlus className="h-4 w-4" /> New job
            </ButtonLink>
          )
        }
      />

      {q.isError ? (
        <Card>
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
            {KPI.map((k) => {
              const Icon = k.icon;
              const value = q.data?.kpis[k.key];
              const hot = k.key === "manualQueue" && (value ?? 0) > 0;
              return (
                <Link key={k.key} href={k.href}>
                  <Card className={cn("h-full p-4 transition-colors hover:border-slate-600", hot && "border-rose-500/50 bg-rose-500/[0.06]")}>
                    <div className="flex items-center justify-between">
                      <Icon className={cn("h-4 w-4", k.tone)} />
                      {hot && <span className="pulse-ring h-2 w-2 rounded-full bg-rose-500" />}
                    </div>
                    {q.isLoading ? <Skeleton className="mt-3 h-7 w-12" /> : <div className={cn("mt-3 text-2xl font-semibold tabular-nums", k.tone)}>{value}</div>}
                    <div className="mt-1 text-xs text-slate-400">{k.label}</div>
                  </Card>
                </Link>
              );
            })}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <AttentionPanel data={q.data} loading={q.isLoading} />
            <div className="space-y-4">
              <StatusChart data={q.data} loading={q.isLoading} />
              <RiderPanel data={q.data} loading={q.isLoading} />
            </div>
          </div>

          <ZoneStrip data={q.data} />
        </>
      )}
    </div>
  );
}

function AttentionPanel({ data, loading }: { data?: DashboardSummary; loading: boolean }) {
  const a = data?.attention;
  const total = a ? a.expiringSoon.length + a.deadlineRisk.length + a.staleReady.length + a.manualQueue.length : 0;
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Needs attention"
        subtitle="What to do next, without opening every order"
        icon={<AlarmClock className="h-4 w-4" />}
        action={data?.lastSweep && (
          <span className="text-[11px] text-slate-500">
            Last timeout sweep: {humanize(data.lastSweep.source)} · {formatDateTime(data.lastSweep.at)} · {data.lastSweep.expired ?? 0} expired
          </span>
        )}
      />
      {loading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : total === 0 ? (
        <EmptyState title="Nothing needs attention" description="No offers are about to expire, no deadlines are at risk and the Manual Queue is empty." icon={<CheckCircle2 className="h-5 w-5" />} />
      ) : (
        <div className="divide-y divide-slate-800/80">
          <Section title="Manual queue" tone="text-rose-300" empty="Queue empty">
            {a!.manualQueue.map((j) => (
              <Row key={j.id} href={`/jobs/${j.id}`} reference={j.reference} priority={j.priority}>
                <span className="text-rose-300">{REASON_LABEL[j.manualQueueReason ?? ""] ?? humanize(j.manualQueueReason)}</span>
                <span className="text-slate-500">waiting {formatDuration(j.waitingMinutes * 60)}</span>
              </Row>
            ))}
          </Section>
          <Section title="Offers about to expire" tone="text-amber-300" empty="No pending offers close to the threshold">
            {a!.expiringSoon.map((x) => (
              <Row key={x.assignmentId} href={`/jobs/${x.jobId}`} reference={x.reference} priority={x.priority}>
                <span className="text-slate-300">
                  {x.riderName} <span className="text-slate-500">({x.riderCode})</span>
                </span>
                <Countdown expiresAt={x.expiresAt} />
              </Row>
            ))}
          </Section>
          <Section title="Deadline at risk (< 60 min)" tone="text-orange-300" empty="No deadlines at risk">
            {a!.deadlineRisk.map((j) => (
              <Row key={j.id} href={`/jobs/${j.id}`} reference={j.reference} priority={j.priority}>
                <span className="text-slate-400">{humanize(j.status)}</span>
                <span className={j.minutesLeft < 0 ? "text-rose-300" : "text-orange-300"}>
                  {j.minutesLeft < 0 ? `missed by ${-j.minutesLeft} min` : `${j.minutesLeft} min left`}
                </span>
              </Row>
            ))}
          </Section>
          <Section title="Ready but unassigned for > 10 min" tone="text-sky-300" empty="All ready jobs are fresh">
            {a!.staleReady.map((j) => (
              <Row key={j.id} href={`/jobs/${j.id}`} reference={j.reference} priority={j.priority}>
                <span className="text-slate-500">waiting {formatDuration(j.waitingMinutes * 60)}</span>
              </Row>
            ))}
          </Section>
        </div>
      )}
    </Card>
  );
}

function Section({ title, tone, empty, children }: { title: string; tone: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="px-5 py-3">
      <div className={cn("mb-2 text-[11px] font-semibold uppercase tracking-wide", tone)}>
        {title} <span className="text-slate-500">({children.length})</span>
      </div>
      {children.length ? <div className="space-y-1">{children}</div> : <div className="text-xs text-slate-500">{empty}</div>}
    </div>
  );
}

function Row({ href, reference, priority, children }: { href: string; reference: string; priority: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-800/60">
      <span className="w-24 font-mono text-slate-100">{reference}</span>
      <PriorityBadge priority={priority} />
      <span className="flex flex-1 items-center justify-end gap-3">{children}</span>
    </Link>
  );
}

function StatusChart({ data, loading }: { data?: DashboardSummary; loading: boolean }) {
  const rows = Object.keys(STATUS_COLORS).map((s) => ({ status: s, label: humanize(s).replace("for assignment", "").replace("confirmation", ""), count: data?.statusCounts[s] ?? 0 }));
  return (
    <Card>
      <CardHeader title="Jobs by status" />
      <div className="h-56 px-2 py-3">
        {loading ? (
          <Skeleton className="mx-3 h-full" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="label" width={86} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "rgba(148,163,184,0.08)" }} contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={14}>
                {rows.map((r) => (
                  <Cell key={r.status} fill={STATUS_COLORS[r.status]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function RiderPanel({ data, loading }: { data?: DashboardSummary; loading: boolean }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        <Bike className="h-4 w-4 text-emerald-300" /> Rider capacity
      </div>
      {loading || !data ? (
        <Skeleton className="mt-3 h-12" />
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="text-2xl font-semibold text-emerald-300">
              {data.riders.online}
              <span className="text-sm text-slate-500">/{data.riders.total}</span>
            </div>
            <div className="text-xs text-slate-400">riders online</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-slate-100">{data.riders.onlineFreeUnits}</div>
            <div className="text-xs text-slate-400">free capacity units</div>
          </div>
          <div className="col-span-2 text-[11px] text-slate-500">
            Confirmation threshold: {formatDuration(data.timeoutSeconds)}
          </div>
        </div>
      )}
    </Card>
  );
}

function ZoneStrip({ data }: { data?: DashboardSummary }) {
  if (!data?.zones.length) return null;
  const max = Math.max(...data.zones.map((z) => z.active), 1);
  return (
    <Card className="mt-4 p-5">
      <div className="mb-3 text-sm font-semibold text-slate-100">Open jobs by pickup zone</div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {data.zones.map((z) => (
          <Link key={z.zoneId} href={`/jobs?zone=${z.zoneId}`} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 hover:border-slate-600">
            <div className="text-xs font-medium text-slate-300">{z.zoneId}</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" style={{ width: `${(z.active / max) * 100}%` }} />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              {z.active} open · <span className={z.waiting ? "text-amber-300" : ""}>{z.waiting} waiting</span>
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}
