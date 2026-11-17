"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Clock3, DatabaseZap, FastForward, RotateCcw, Timer, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCan } from "@/components/session-context";
import { Badge, Button, Card, CardHeader, ErrorState, Field, Input, PageHeader, Skeleton, Stat } from "@/components/ui";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime, formatDuration, humanize } from "@/lib/format";

interface SettingsView {
  confirmationTimeoutSeconds: number;
  clockOffsetSeconds: number;
  now: string;
  realNow: string;
  lastSweep: { at: string; source: string | null; expired: number | null } | null;
  aiEnabled: boolean;
  aiModel: string;
  allowSeed: boolean;
}

const TIMEOUT_PRESETS = [
  { label: "30 s", value: 30 },
  { label: "2 min", value: 120 },
  { label: "15 min", value: 900 },
  { label: "2 h (default)", value: 7200 },
];

export default function SettingsPage() {
  const { admin, operator } = useCan();
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["settings-page"], queryFn: () => api<SettingsView>("/api/settings"), refetchInterval: 5000 });
  const [timeout, setTimeoutValue] = useState("");

  useEffect(() => {
    if (s.data && timeout === "") setTimeoutValue(String(s.data.confirmationTimeoutSeconds));
  }, [s.data, timeout]);

  const refreshAll = () => {
    qc.invalidateQueries();
  };

  const patch = useMutation({
    mutationFn: (body: Record<string, number>) => api<SettingsView>("/api/settings", { method: "PATCH", body }),
    onSuccess: (d) => {
      toast.success("Settings saved");
      setTimeoutValue(String(d.confirmationTimeoutSeconds));
      refreshAll();
    },
    onError: (err) => toast.error("Could not save", { description: errorMessage(err) }),
  });

  const sweep = useMutation({
    mutationFn: () => api<{ expired: number; checked: number }>("/api/admin/sweep", { method: "POST" }),
    onSuccess: (r) => {
      toast.success(`Sweep finished: ${r.expired} assignment(s) expired`, { description: `${r.checked} overdue found` });
      refreshAll();
    },
    onError: (err) => toast.error("Sweep failed", { description: errorMessage(err) }),
  });

  const reseed = useMutation({
    mutationFn: () => api("/api/admin/seed", { method: "POST" }),
    onSuccess: () => {
      toast.success("Demo data restored");
      window.location.assign("/login");
    },
    onError: (err) => toast.error("Reset failed", { description: errorMessage(err) }),
  });

  if (s.isError) return <ErrorState message={errorMessage(s.error)} onRetry={() => s.refetch()} />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" subtitle={admin ? "Change the timeout and simulated clock to test timeouts without waiting." : "Read-only. Only admins can change settings."} />
      {!s.data ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Rider confirmation threshold" subtitle="How long a rider has to confirm before the job moves to the Manual Queue. Applies to new offers." icon={<Timer className="h-4 w-4" />} />
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-2">
                {TIMEOUT_PRESETS.map((p) => (
                  <Button
                    key={p.value}
                    size="sm"
                    variant={s.data.confirmationTimeoutSeconds === p.value ? "primary" : "secondary"}
                    disabled={!admin}
                    onClick={() => patch.mutate({ confirmationTimeoutSeconds: p.value })}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="flex items-end gap-2">
                <Field label="Custom (seconds)" hint={`Currently ${formatDuration(s.data.confirmationTimeoutSeconds)}`}>
                  <Input type="number" min={10} value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} disabled={!admin} className="w-40" />
                </Field>
                <Button disabled={!admin || !timeout} loading={patch.isPending} onClick={() => patch.mutate({ confirmationTimeoutSeconds: Number(timeout) })} className="mb-5">
                  Save
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Simulated clock"
              subtitle="Moves application time forward so pending offers become overdue. Each move runs a sweep straight away."
              icon={<Clock3 className="h-4 w-4" />}
              action={s.data.clockOffsetSeconds > 0 ? <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-200">+{formatDuration(s.data.clockOffsetSeconds)}</Badge> : <Badge>Real time</Badge>}
            />
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Application time" value={<span className="font-mono">{formatDateTime(s.data.now)}</span>} />
                <Stat label="Wall-clock time" value={<span className="font-mono">{formatDateTime(s.data.realNow)}</span>} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={!admin} onClick={() => patch.mutate({ advanceClockSeconds: 15 * 60 })}>
                  <FastForward className="h-3.5 w-3.5" /> +15 min
                </Button>
                <Button size="sm" variant="secondary" disabled={!admin} onClick={() => patch.mutate({ advanceClockSeconds: 3600 })}>
                  <FastForward className="h-3.5 w-3.5" /> +1 hour
                </Button>
                <Button size="sm" variant="secondary" disabled={!admin} onClick={() => patch.mutate({ advanceClockSeconds: 2 * 3600 })}>
                  <FastForward className="h-3.5 w-3.5" /> +2 hours
                </Button>
                <Button size="sm" variant="ghost" disabled={!admin || s.data.clockOffsetSeconds === 0} onClick={() => patch.mutate({ clockOffsetSeconds: 0 })}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reset to real time
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Assignment expiry"
              subtitle="Lazy expiry before every queue read and write, plus Vercel Cron as a safety net. Both use the same idempotent sweep."
              icon={<Zap className="h-4 w-4" />}
            />
            <div className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="grid grid-cols-3 gap-6">
                <Stat label="Last sweep" value={s.data.lastSweep ? formatDateTime(s.data.lastSweep.at) : "never"} />
                <Stat label="Source" value={humanize(s.data.lastSweep?.source)} />
                <Stat label="Expired" value={s.data.lastSweep?.expired ?? 0} />
              </div>
              <Button variant="secondary" disabled={!operator} loading={sweep.isPending} onClick={() => sweep.mutate()}>
                <Zap className="h-4 w-4" /> Run sweep now
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="AI rider prediction" subtitle="OpenRouter model used to re-rank eligible riders and suggest Manual Queue actions" icon={<Bot className="h-4 w-4" />} />
            <div className="grid grid-cols-2 gap-4 p-5">
              <Stat label="Status" value={s.data.aiEnabled ? <span className="text-emerald-300">Enabled</span> : <span className="text-slate-400">Disabled (no API key)</span>} />
              <Stat label="Model" value={<span className="font-mono">{s.data.aiModel}</span>} />
            </div>
          </Card>

          {admin && s.data.allowSeed && (
            <Card>
              <CardHeader
                title="Demo data"
                subtitle="Wipes all jobs, riders and users and reloads the sample scenario. Enabled because ALLOW_SEED=true."
                icon={<DatabaseZap className="h-4 w-4" />}
              />
              <div className="flex justify-end p-5">
                <Button
                  variant="danger"
                  loading={reseed.isPending}
                  onClick={() => {
                    if (window.confirm("Reset all data to the demo scenario? Everyone will need to sign in again.")) reseed.mutate();
                  }}
                >
                  <DatabaseZap className="h-4 w-4" /> Reset demo data
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
