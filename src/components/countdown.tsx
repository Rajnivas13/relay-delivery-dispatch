"use client";

import { Timer } from "lucide-react";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp, useNow } from "./session-context";

export function Countdown({ expiresAt, className, compact }: { expiresAt: string; className?: string; compact?: boolean }) {
  const now = useNow();
  const { timeoutSeconds } = useApp();
  const left = Math.round((new Date(expiresAt).getTime() - now.getTime()) / 1000);
  const ratio = left / Math.max(timeoutSeconds, 1);
  const tone =
    left <= 0 ? "text-rose-300 bg-rose-500/15 border-rose-500/40" : ratio < 0.25 ? "text-amber-300 bg-amber-500/10 border-amber-500/40" : "text-slate-200 bg-slate-800 border-slate-700";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] tabular-nums", tone, className)}>
      <Timer className="h-3 w-3" />
      {left <= 0 ? (compact ? "expired" : "expired, sweeping") : formatDuration(left)}
    </span>
  );
}
