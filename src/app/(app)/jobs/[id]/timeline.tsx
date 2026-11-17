"use client";

import {
  Ban,
  Bot,
  CheckCircle2,
  CircleDot,
  Gauge,
  Hand,
  PackageCheck,
  PackagePlus,
  Repeat,
  Shuffle,
  Siren,
  Timer,
  Truck,
  UserCheck,
  UserMinus,
  UserX,
} from "lucide-react";
import { useState } from "react";
import { REASON_LABEL } from "@/components/badges";
import { formatDateTime, formatDuration, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { JobEventView } from "@/lib/view-types";

const ICONS: Record<string, { icon: typeof CircleDot; tone: string }> = {
  JOB_CREATED: { icon: PackagePlus, tone: "text-slate-200 bg-slate-700/60" },
  STATUS_CHANGED: { icon: CircleDot, tone: "text-sky-300 bg-sky-500/15" },
  RECOMMENDATION_GENERATED: { icon: Gauge, tone: "text-fuchsia-300 bg-fuchsia-500/15" },
  RIDER_ASSIGNED: { icon: UserCheck, tone: "text-amber-300 bg-amber-500/15" },
  RIDER_REASSIGNED: { icon: Repeat, tone: "text-amber-300 bg-amber-500/15" },
  MANUAL_OVERRIDE: { icon: Shuffle, tone: "text-orange-300 bg-orange-500/15" },
  RIDER_CONFIRMED: { icon: CheckCircle2, tone: "text-indigo-300 bg-indigo-500/15" },
  RIDER_REJECTED: { icon: UserX, tone: "text-rose-300 bg-rose-500/15" },
  ASSIGNMENT_TIMEOUT: { icon: Timer, tone: "text-orange-300 bg-orange-500/15" },
  ASSIGNMENT_RELEASED: { icon: UserMinus, tone: "text-orange-300 bg-orange-500/15" },
  MOVED_TO_MANUAL_QUEUE: { icon: Siren, tone: "text-rose-300 bg-rose-500/15" },
  PICKED_UP: { icon: Truck, tone: "text-violet-300 bg-violet-500/15" },
  DELIVERED: { icon: PackageCheck, tone: "text-emerald-300 bg-emerald-500/15" },
  CANCELLED: { icon: Ban, tone: "text-zinc-300 bg-zinc-600/30" },
  AI_SUGGESTION: { icon: Bot, tone: "text-fuchsia-300 bg-fuchsia-500/15" },
};

type D = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function describe(e: JobEventView, riderName: (id: unknown) => string): string {
  const d = e.details as D;
  switch (e.type) {
    case "JOB_CREATED":
      return `Job created: ${s(d.pickupZoneId)} → ${s(d.dropZoneId)}, ${s(d.loadUnits)} units, ${humanize(s(d.priority))} priority`;
    case "STATUS_CHANGED":
      return `${humanize(e.fromStatus)} → ${humanize(e.toStatus)}${d.eligibleRiders !== undefined ? ` (${s(d.eligibleRiders)} eligible riders)` : ""}`;
    case "RECOMMENDATION_GENERATED": {
      const top = (d.top as { code: string; score: number }[] | undefined) ?? [];
      const base = d.strategy === "AI_RERANK" ? "AI re-ranked candidates" : "Score ranking generated";
      return `${base}: ${top.map((t) => `${t.code} (${t.score})`).join(", ") || "no eligible riders"}${d.usedFallback ? `. AI fell back: ${humanize(s(d.fallbackReason))}` : ""}`;
    }
    case "RIDER_ASSIGNED":
    case "RIDER_REASSIGNED":
      return `${e.type === "RIDER_REASSIGNED" ? "Reassigned" : "Assigned"} to ${s(d.riderName)} (${s(d.riderCode)}), score ${s(d.score)}, attempt #${s(d.attempt)}. Must confirm by ${formatDateTime(s(d.expiresAt))}`;
    case "MANUAL_OVERRIDE":
      return `Override: chose ${riderName(d.chosenRiderId)} instead of recommended ${riderName(d.recommendedRiderId)}. Reason: "${s(d.reason)}"`;
    case "RIDER_CONFIRMED":
      return `Rider confirmed after ${formatDuration(Number(d.responseSeconds ?? 0))}`;
    case "RIDER_REJECTED":
      return `Rider rejected: "${s(d.reason)}". ${s(d.releasedUnits)} capacity units released`;
    case "ASSIGNMENT_TIMEOUT":
      return `${s(d.riderCode)} did not confirm within ${formatDuration(Number(d.thresholdSeconds ?? 0))}. Assignment expired, ${s(d.releasedUnits)} units released`;
    case "ASSIGNMENT_RELEASED":
      return `Dispatcher released the rider: "${s(d.reason)}"`;
    case "MOVED_TO_MANUAL_QUEUE":
      return `Moved to the Manual Queue: ${REASON_LABEL[s(d.reason)] ?? humanize(s(d.reason))}${d.message ? `. ${s(d.message)}` : ""}`;
    case "PICKED_UP":
      return "Parcel collected from pickup";
    case "DELIVERED":
      return `Delivered${d.onTime === true ? " on time" : d.onTime === false ? " after the deadline" : ""}. ${s(d.releasedUnits)} units released`;
    case "CANCELLED":
      return `Cancelled: "${s(d.reason)}"${d.releasedRiderId ? `. Released ${riderName(d.releasedRiderId)}` : ""}`;
    case "AI_SUGGESTION":
      return `${d.source === "AI" ? "AI" : "Rules"} suggested ${humanize(s(d.action))}${d.riderCode ? ` → ${s(d.riderCode)}` : ""}: ${s(d.rationale)}`;
    default:
      return humanize(e.type);
  }
}

export function Timeline({ events, riderNames }: { events: JobEventView[]; riderNames: Record<string, string> }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const riderName = (id: unknown) => riderNames[s(id)] ?? s(id).slice(0, 8);
  return (
    <ol className="relative space-y-4 pl-2">
      <span className="absolute bottom-2 left-[19px] top-2 w-px bg-slate-800" aria-hidden />
      {events.map((e) => {
        const meta = ICONS[e.type] ?? { icon: CircleDot, tone: "text-slate-300 bg-slate-700/50" };
        const Icon = meta.icon;
        return (
          <li key={e.id} className="relative flex gap-3">
            <div className={cn("relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-slate-900", meta.tone)}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-xs font-semibold text-slate-200">{humanize(e.type)}</span>
                <span className="font-mono text-[10px] text-slate-500">{formatDateTime(e.createdAt)}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">{describe(e, riderName)}</p>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                <Hand className="h-3 w-3" />
                {e.actorName ?? humanize(e.actorType)} · {humanize(e.actorType)}
                <button className="ml-auto text-slate-500 hover:text-slate-300" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                  {expanded === e.id ? "hide details" : "details"}
                </button>
              </div>
              {expanded === e.id && (
                <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-[10px] text-slate-400">
                  {JSON.stringify({ id: e.id, from: e.fromStatus, to: e.toStatus, assignmentId: e.assignmentId, ...e.details }, null, 2)}
                </pre>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
