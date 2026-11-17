"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/session-context";
import { Badge, Button, Card, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton } from "@/components/ui";
import { ROLES } from "@/domain/types";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime, humanize } from "@/lib/format";
import type { RiderView } from "@/lib/view-types";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  riderId: string | null;
  isActive: boolean;
  createdAt: string;
  rider: { code: string; name: string } | null;
}

export default function UsersPage() {
  const { user: me } = useApp();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<{ items: UserRow[] }>("/api/admin/users").then((r) => r.items) });

  const update = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => api(`/api/admin/users/${v.id}`, { method: "PATCH", body: v.body }),
    onSuccess: () => toast.success("User updated"),
    onError: (err) => toast.error("Update failed", { description: errorMessage(err) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Users & roles"
        subtitle="Admins manage everything. Dispatchers run operations. Riders see only their own offers. Viewers are read-only."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add user
          </Button>
        }
      />
      <Card className="overflow-hidden">
        {users.isError ? (
          <ErrorState message={errorMessage(users.error)} onRetry={() => users.refetch()} />
        ) : users.isLoading ? (
          <Skeleton className="m-4 h-64" />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/40 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Rider profile</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {users.data?.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <div className="text-slate-100">
                      {u.name} {u.id === me.id && <Badge>you</Badge>}
                    </div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={u.role}
                      className="h-8 w-36 text-xs"
                      disabled={u.role === "RIDER" || u.id === me.id}
                      onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value } })}
                    >
                      {ROLES.filter((r) => r !== "RIDER" || u.role === "RIDER").map((r) => (
                        <option key={r} value={r}>
                          {humanize(r)}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{u.rider ? `${u.rider.name} (${u.rider.code})` : "-"}</td>
                  <td className="px-4 py-3">
                    <button
                      disabled={u.id === me.id}
                      onClick={() => update.mutate({ id: u.id, body: { isActive: !u.isActive } })}
                      className="disabled:opacity-50"
                      title={u.isActive ? "Deactivate" : "Activate"}
                    >
                      <Badge className={u.isActive ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}>
                        {u.isActive ? "Active" : "Disabled"}
                      </Badge>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "DISPATCHER", riderId: "" });
  const riders = useQuery({
    queryKey: ["riders"],
    queryFn: () => api<{ items: RiderView[] }>("/api/riders").then((r) => r.items),
    enabled: open,
  });
  const create = useMutation({
    mutationFn: () => api("/api/admin/users", { body: { ...form, riderId: form.role === "RIDER" ? form.riderId : null } }),
    onSuccess: () => {
      toast.success("User created");
      qc.invalidateQueries({ queryKey: ["users"] });
      setForm({ email: "", name: "", password: "", role: "DISPATCHER", riderId: "" });
      onClose();
    },
    onError: (err) => toast.error("Could not create user", { description: errorMessage(err) }),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add user"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} onClick={() => create.mutate()}>
            <UserCog className="h-4 w-4" /> Create
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Temporary password" hint="At least 8 characters">
          <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="Role">
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </Select>
        </Field>
        {form.role === "RIDER" && (
          <Field label="Linked rider profile">
            <Select value={form.riderId} onChange={(e) => setForm({ ...form, riderId: e.target.value })}>
              <option value="">Select rider</option>
              {riders.data
                ?.filter((r) => !r.user)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
