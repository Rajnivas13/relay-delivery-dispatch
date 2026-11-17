"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Smartphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AvailabilityBadge } from "@/components/badges";
import { useCan } from "@/components/session-context";
import { Button, ButtonLink, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton } from "@/components/ui";
import { useZones } from "@/components/use-zones";
import { RIDER_AVAILABILITY } from "@/domain/types";
import { api, errorMessage } from "@/lib/api-client";
import { humanize, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RiderView } from "@/lib/view-types";

export default function RidersPage() {
  const { operator } = useCan();
  const [editing, setEditing] = useState<RiderView | "new" | null>(null);
  const [filter, setFilter] = useState("");
  const riders = useQuery({
    queryKey: ["riders"],
    queryFn: () => api<{ items: RiderView[] }>("/api/riders").then((r) => r.items),
    refetchInterval: 5000,
  });

  const items = (riders.data ?? []).filter((r) => !filter || r.availability === filter);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Riders"
        subtitle="Availability, service zones, capacity and live workload"
        actions={
          <>
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-40" aria-label="Availability filter">
              <option value="">All riders</option>
              {RIDER_AVAILABILITY.map((a) => (
                <option key={a} value={a}>
                  {humanize(a)}
                </option>
              ))}
            </Select>
            {operator && (
              <Button onClick={() => setEditing("new")}>
                <Plus className="h-4 w-4" /> Add rider
              </Button>
            )}
          </>
        }
      />

      {riders.isError ? (
        <Card>
          <ErrorState message={errorMessage(riders.error)} onRetry={() => riders.refetch()} />
        </Card>
      ) : riders.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState title="No riders" description={filter ? "No riders with this availability." : "Add the first rider."} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((r) => {
            const usedPct = (r.reservedUnits / r.capacityUnits) * 100;
            const canTakeMore = r.availability === "ONLINE" && r.freeUnits > 0 && r.activeJobCount < r.maxActiveJobs;
            return (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{r.name}</div>
                    <div className="text-xs text-slate-500">
                      {r.code} · at {r.currentZoneId}
                      {r.user && ` · ${r.user.email}`}
                    </div>
                  </div>
                  <AvailabilityBadge availability={r.availability} />
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Capacity</span>
                    <span className="tabular-nums">
                      {r.reservedUnits}/{r.capacityUnits} units reserved · {r.freeUnits} free
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div className={cn("h-full rounded-full", usedPct > 80 ? "bg-rose-400" : usedPct > 50 ? "bg-amber-400" : "bg-emerald-400")} style={{ width: `${usedPct}%` }} />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-[10px] uppercase text-slate-500">Active</div>
                    <div className="text-slate-200">
                      {r.activeJobCount}/{r.maxActiveJobs}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-500">Acceptance</div>
                    <div className="text-slate-200">{r.offersReceived ? pct(r.offersAccepted / r.offersReceived) : "new"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-500">Can take more</div>
                    <div className={canTakeMore ? "text-emerald-300" : "text-rose-300"}>{canTakeMore ? "Yes" : "No"}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {r.zoneIds.map((z) => (
                    <span key={z} className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                      {z}
                    </span>
                  ))}
                </div>
                {r.assignments.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-slate-800 pt-2">
                    {r.assignments.map((a) => (
                      <Link key={a.id} href={`/jobs/${a.job.id}`} className="flex justify-between text-[11px] text-slate-400 hover:text-slate-200">
                        <span className="font-mono">{a.job.reference}</span>
                        <span>{humanize(a.status)}</span>
                      </Link>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <ButtonLink href={`/rider/${r.id}`} variant="ghost" size="sm">
                    <Smartphone className="h-3.5 w-3.5" /> Rider view
                  </ButtonLink>
                  {operator && (
                    <Button variant="secondary" size="sm" onClick={() => setEditing(r)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <RiderDialog rider={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function RiderDialog({ rider, onClose }: { rider: RiderView | "new" | null; onClose: () => void }) {
  const zones = useZones();
  const qc = useQueryClient();
  const isNew = rider === "new";
  const [form, setForm] = useState({ name: "", phone: "", availability: "ONLINE", currentZoneId: "", zoneIds: [] as string[], capacityUnits: 10, maxActiveJobs: 3 });

  useEffect(() => {
    if (rider && rider !== "new") {
      setForm({
        name: rider.name,
        phone: rider.phone ?? "",
        availability: rider.availability,
        currentZoneId: rider.currentZoneId,
        zoneIds: rider.zoneIds,
        capacityUnits: rider.capacityUnits,
        maxActiveJobs: rider.maxActiveJobs,
      });
    } else if (rider === "new") {
      setForm({ name: "", phone: "", availability: "ONLINE", currentZoneId: "", zoneIds: [], capacityUnits: 10, maxActiveJobs: 3 });
    }
  }, [rider]);

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, phone: form.phone || undefined, capacityUnits: Number(form.capacityUnits), maxActiveJobs: Number(form.maxActiveJobs) };
      return isNew
        ? api("/api/riders", { body })
        : api(`/api/riders/${(rider as RiderView).id}`, { method: "PATCH", body: { ...body, expectedVersion: (rider as RiderView).version } });
    },
    onSuccess: () => {
      toast.success(isNew ? "Rider added" : "Rider updated");
      qc.invalidateQueries({ queryKey: ["riders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (err) => toast.error("Could not save rider", { description: errorMessage(err) }),
  });

  return (
    <Modal
      open={rider !== null}
      onClose={onClose}
      title={isNew ? "Add rider" : `Edit ${(rider as RiderView | null)?.name ?? ""}`}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()} disabled={!form.name || !form.currentZoneId || !form.zoneIds.length}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Availability">
          <Select value={form.availability} onChange={(e) => setForm({ ...form, availability: e.target.value })}>
            {RIDER_AVAILABILITY.map((a) => (
              <option key={a} value={a}>
                {humanize(a)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Current zone" hint="Simulated location used for travel time">
          <Select value={form.currentZoneId} onChange={(e) => setForm({ ...form, currentZoneId: e.target.value })}>
            <option value="">Select</option>
            {zones.data?.map((z) => (
              <option key={z.id} value={z.id}>
                {z.id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Capacity (units)" hint="Can't be set below units already reserved">
          <Input type="number" min={1} max={100} value={form.capacityUnits} onChange={(e) => setForm({ ...form, capacityUnits: Number(e.target.value) })} />
        </Field>
        <Field label="Max active jobs">
          <Input type="number" min={1} max={10} value={form.maxActiveJobs} onChange={(e) => setForm({ ...form, maxActiveJobs: Number(e.target.value) })} />
        </Field>
        <div className="sm:col-span-2">
          <span className="text-xs font-medium text-slate-300">Service zones</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {zones.data?.map((z) => {
              const on = form.zoneIds.includes(z.id);
              return (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => setForm({ ...form, zoneIds: on ? form.zoneIds.filter((x) => x !== z.id) : [...form.zoneIds, z.id] })}
                  className={cn("rounded-lg border px-3 py-1.5 text-xs", on ? "border-indigo-400 bg-indigo-500/20 text-white" : "border-slate-700 text-slate-400 hover:border-slate-500")}
                  aria-pressed={on}
                >
                  {z.id}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
