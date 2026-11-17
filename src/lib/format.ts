import { format, formatDistanceStrict } from "date-fns";

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return format(new Date(value), "dd MMM, HH:mm:ss");
}

export function formatShortTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return format(new Date(value), "HH:mm");
}

export function relativeTo(value: string | Date, now: Date): string {
  return formatDistanceStrict(new Date(value), now, { addSuffix: true });
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(Math.abs(totalSeconds)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

export function humanize(value: string | null | undefined): string {
  if (!value) return "-";
  return value
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
