"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Skeleton } from "@/components/ui";
import { PERMISSION_KEYS } from "@/auth/permissions";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  user: { email: string; role: string };
}

export default function TokensPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => api<{ items: TokenRow[] }>("/api/admin/api-tokens").then((r) => r.items) });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/admin/api-tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => toast.success("Token revoked"),
    onError: (err) => toast.error("Revoke failed", { description: errorMessage(err) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tokens"] }),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="API tokens"
        subtitle="Bearer tokens for scripts, Postman or order-intake systems. Scoped, hashed at rest, revocable."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New token
          </Button>
        }
      />
      {created && (
        <Card className="mb-4 border-emerald-500/40 bg-emerald-500/[0.06] p-4">
          <div className="text-sm font-semibold text-emerald-200">Copy your token now. It won&apos;t be shown again.</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100">{created}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(created);
                toast.success("Copied");
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Use it as <code className="text-slate-300">Authorization: Bearer {created.slice(0, 12)}…</code>
          </p>
        </Card>
      )}
      <Card className="overflow-hidden">
        {tokens.isError ? (
          <ErrorState message={errorMessage(tokens.error)} onRetry={() => tokens.refetch()} />
        ) : tokens.isLoading ? (
          <Skeleton className="m-4 h-40" />
        ) : !tokens.data?.length ? (
          <EmptyState icon={<KeyRound className="h-5 w-5" />} title="No API tokens" description="Create one to call the API from outside the browser." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/40 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Scopes</th>
                <th className="px-4 py-3">Last used</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {tokens.data.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3">
                    <div className="text-slate-100">{t.name}</div>
                    <div className="font-mono text-[11px] text-slate-500">
                      {t.prefix}… · {t.user.email}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {t.scopes.map((s) => (
                        <Badge key={s}>{s}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{t.lastUsedAt ? formatDateTime(t.lastUsedAt) : "never"}</td>
                  <td className="px-4 py-3">
                    {t.revokedAt ? (
                      <Badge className="border-rose-500/40 bg-rose-500/10 text-rose-300">Revoked</Badge>
                    ) : (
                      <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">Active</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!t.revokedAt && (
                      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(t.id)} aria-label="Revoke token">
                        <Trash2 className="h-3.5 w-3.5 text-rose-300" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <CreateTokenDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(token) => {
          setCreated(token);
          qc.invalidateQueries({ queryKey: ["tokens"] });
        }}
      />
    </div>
  );
}

function CreateTokenDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (token: string) => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["jobs:read", "jobs:write"]);
  const create = useMutation({
    mutationFn: () => api<{ token: string }>("/api/admin/api-tokens", { body: { name, scopes } }),
    onSuccess: (r) => {
      onCreated(r.token);
      setName("");
      onClose();
    },
    onError: (err) => toast.error("Could not create token", { description: errorMessage(err) }),
  });
  const all = ["*", ...PERMISSION_KEYS];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New API token"
      description="The token acts as you, limited to the scopes you pick."
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={name.trim().length < 2 || !scopes.length} onClick={() => create.mutate()}>
            Create token
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Order intake service" />
      </Field>
      <div className="mt-4 text-xs font-medium text-slate-300">Scopes</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {all.map((s) => {
          const on = scopes.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => setScopes(on ? scopes.filter((x) => x !== s) : [...scopes, s])}
              className={cn("rounded-full border px-2.5 py-1 font-mono text-[11px]", on ? "border-indigo-400 bg-indigo-500/20 text-white" : "border-slate-700 text-slate-400")}
            >
              {s === "*" ? "* (all my permissions)" : s}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
