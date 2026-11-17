"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, PackagePlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useCan } from "@/components/session-context";
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { useZones } from "@/components/use-zones";
import { PRIORITIES } from "@/domain/types";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { humanize } from "@/lib/format";
import type { JobBase } from "@/lib/view-types";

const newKey = () => crypto.randomUUID();

export default function NewJobPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { operator } = useCan();
  const zones = useZones();
  // One key per logical submission: double-clicks and network retries reuse it and get the same job back.
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [form, setForm] = useState({
    reference: "",
    pickupZoneId: "",
    dropZoneId: "",
    loadUnits: 1,
    priority: "NORMAL",
    deadlineAt: "",
    customerName: "",
    notes: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const update = (k: keyof typeof form, v: string | number) => {
    setForm((f) => ({ ...f, [k]: v }));
    setIdempotencyKey(newKey());
  };

  const create = useMutation({
    mutationFn: () =>
      api<JobBase>("/api/jobs", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: {
          reference: form.reference.trim() || undefined,
          pickupZoneId: form.pickupZoneId,
          dropZoneId: form.dropZoneId,
          loadUnits: Number(form.loadUnits),
          priority: form.priority,
          deadlineAt: form.deadlineAt ? new Date(form.deadlineAt).toISOString() : null,
          customerName: form.customerName.trim() || undefined,
          notes: form.notes.trim() || undefined,
        },
      }),
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Job ${job.reference} created`, {
        description: job.status === "MANUAL_QUEUE" ? "No eligible rider right now, so it went to the Manual Queue." : "Ready for assignment.",
      });
      router.push(`/jobs/${job.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "VALIDATION_ERROR" && Array.isArray(err.details)) {
        setFieldErrors(Object.fromEntries((err.details as { path: string; message: string }[]).map((d) => [d.path, d.message])));
      }
      toast.error("Could not create job", { description: errorMessage(err) });
    },
  });

  if (!operator) {
    return <EmptyState title="Read-only access" description="Only dispatchers and admins can create jobs." />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/jobs" className="mb-4 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to jobs
      </Link>
      <PageHeader title="New delivery job" subtitle="Submitting twice is safe: each submission carries an idempotency key." />
      <Card className="p-6">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setFieldErrors({});
            create.mutate();
          }}
        >
          <Field label="Order reference" hint="Optional. Leave blank to auto-generate." error={fieldErrors.reference}>
            <Input value={form.reference} onChange={(e) => update("reference", e.target.value)} placeholder="ORD-2001" />
          </Field>
          <Field label="Customer" error={fieldErrors.customerName}>
            <Input value={form.customerName} onChange={(e) => update("customerName", e.target.value)} placeholder="Customer or store name" />
          </Field>
          <Field label="Pickup zone" error={fieldErrors.pickupZoneId}>
            <Select required value={form.pickupZoneId} onChange={(e) => update("pickupZoneId", e.target.value)}>
              <option value="">Select zone</option>
              {zones.data?.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.id} · {z.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Delivery zone" error={fieldErrors.dropZoneId}>
            <Select required value={form.dropZoneId} onChange={(e) => update("dropZoneId", e.target.value)}>
              <option value="">Select zone</option>
              {zones.data?.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.id} · {z.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Load (capacity units)" hint="1 unit is roughly one standard parcel" error={fieldErrors.loadUnits}>
            <Input type="number" min={1} max={100} required value={form.loadUnits} onChange={(e) => update("loadUnits", Number(e.target.value))} />
          </Field>
          <Field label="Priority" error={fieldErrors.priority}>
            <Select value={form.priority} onChange={(e) => update("priority", e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanize(p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Delivery deadline" hint="Optional" error={fieldErrors.deadlineAt}>
            <Input type="datetime-local" value={form.deadlineAt} onChange={(e) => update("deadlineAt", e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes" error={fieldErrors.notes}>
              <Textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Handling instructions" maxLength={500} />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3 sm:col-span-2">
            <span className="font-mono text-[10px] text-slate-600">Idempotency-Key: {idempotencyKey.slice(0, 8)}…</span>
            <Button type="submit" loading={create.isPending}>
              <PackagePlus className="h-4 w-4" /> Create job
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
