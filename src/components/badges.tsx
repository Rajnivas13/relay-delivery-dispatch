import { Badge } from "./ui";
import { humanize } from "@/lib/format";

const STATUS_STYLES: Record<string, string> = {
  NEW: "border-slate-600 bg-slate-800 text-slate-200",
  READY_FOR_ASSIGNMENT: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  AWAITING_CONFIRMATION: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  ACCEPTED: "border-indigo-500/40 bg-indigo-500/10 text-indigo-300",
  PICKED_UP: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  DELIVERED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  MANUAL_QUEUE: "border-rose-500/50 bg-rose-500/10 text-rose-300",
  CANCELLED: "border-zinc-600 bg-zinc-800/60 text-zinc-400",
};

const STATUS_LABEL: Record<string, string> = {
  READY_FOR_ASSIGNMENT: "Ready",
  AWAITING_CONFIRMATION: "Awaiting rider",
  MANUAL_QUEUE: "Manual queue",
  PICKED_UP: "Picked up",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={STATUS_STYLES[status]}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status] ?? humanize(status)}
    </Badge>
  );
}

const PRIORITY_STYLES: Record<string, string> = {
  LOW: "border-slate-700 bg-slate-800/60 text-slate-400",
  NORMAL: "border-slate-600 bg-slate-800 text-slate-300",
  HIGH: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  URGENT: "border-rose-500/50 bg-rose-500/15 text-rose-300",
};

export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge className={PRIORITY_STYLES[priority]}>{humanize(priority)}</Badge>;
}

const AVAILABILITY_STYLES: Record<string, string> = {
  ONLINE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  OFFLINE: "border-slate-700 bg-slate-800/60 text-slate-400",
  ON_BREAK: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

export function AvailabilityBadge({ availability }: { availability: string }) {
  return (
    <Badge className={AVAILABILITY_STYLES[availability]}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {humanize(availability)}
    </Badge>
  );
}

const ASSIGNMENT_STYLES: Record<string, string> = {
  PENDING: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  ACCEPTED: "border-indigo-500/40 bg-indigo-500/10 text-indigo-300",
  COMPLETED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  REJECTED: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  EXPIRED: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  CANCELLED: "border-zinc-600 bg-zinc-800/60 text-zinc-400",
};

export function AssignmentBadge({ status }: { status: string }) {
  return <Badge className={ASSIGNMENT_STYLES[status]}>{humanize(status)}</Badge>;
}

export const REASON_LABEL: Record<string, string> = {
  CONFIRMATION_TIMEOUT: "Confirmation timed out",
  RIDER_REJECTED: "Rider rejected",
  NO_ELIGIBLE_RIDER: "No eligible rider",
  RELEASED_BY_DISPATCHER: "Released by dispatcher",
};
