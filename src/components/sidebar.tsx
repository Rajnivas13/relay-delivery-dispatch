"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Bike,
  Clock3,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Radio,
  Settings,
  Siren,
  Smartphone,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/app/(auth)/login/actions";
import { api } from "@/lib/api-client";
import { formatDuration, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp } from "./session-context";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  admin?: boolean;
  external?: boolean;
  badge?: "manual";
}

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: ListChecks },
  { href: "/manual-queue", label: "Manual Queue", icon: Siren, badge: "manual" },
  { href: "/riders", label: "Riders", icon: Bike },
  { href: "/rider", label: "Rider app", icon: Smartphone },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/admin/users", label: "Users", icon: Users, admin: true },
  { href: "/admin/tokens", label: "API tokens", icon: KeyRound, admin: true },
  { href: "/docs", label: "API docs", icon: BookOpen, external: true },
];

interface SummaryLite {
  kpis: { manualQueue: number };
  clockOffsetSeconds: number;
}

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useApp();
  const [open, setOpen] = useState(false);
  const summary = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<SummaryLite>("/api/dashboard/summary"),
    refetchInterval: 5000,
  });
  const manual = summary.data?.kpis.manualQueue ?? 0;
  const offset = summary.data?.clockOffsetSeconds ?? 0;

  const items = NAV.filter((n) => !n.admin || user.role === "ADMIN");
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      <button
        className="fixed left-3 top-3 z-40 rounded-lg border border-slate-700 bg-slate-900 p-2 md:hidden"
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle navigation"
      >
        <Menu className="h-4 w-4" />
      </button>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-slate-800/80 bg-slate-950/90 backdrop-blur transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 px-5 pb-4 pt-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-lg shadow-indigo-500/30">
            <Radio className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">RELAY</div>
            <div className="text-[11px] text-slate-500">Dispatch desk</div>
          </div>
        </div>

        {offset > 0 && (
          <Link
            href="/settings"
            className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200"
          >
            <Clock3 className="h-3.5 w-3.5" /> Simulated clock +{formatDuration(offset)}
          </Link>
        )}

        <nav className="flex-1 space-y-0.5 px-3">
          {items.map((item) => {
            const Icon = item.icon;
            const active = !item.external && isActive(item.href);
            const content = (
              <>
                <Icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {item.badge === "manual" && manual > 0 && (
                  <span className="pulse-ring rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">{manual}</span>
                )}
              </>
            );
            const cls = cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-indigo-500/15 text-white ring-1 ring-inset ring-indigo-500/30" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100",
            );
            return item.external ? (
              <a key={item.href} href={item.href} target="_blank" rel="noreferrer" className={cls}>
                {content}
              </a>
            ) : (
              <Link key={item.href} href={item.href} className={cls} onClick={() => setOpen(false)}>
                {content}
              </Link>
            );
          })}
        </nav>

        <div className="m-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-200">
              {user.name
                .split(" ")
                .map((p) => p[0])
                .join("")
                .slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-slate-100">{user.name}</div>
              <div className="truncate text-[11px] text-slate-500">
                {humanize(user.role)} · {user.email}
              </div>
            </div>
          </div>
          <form action={logout} className="mt-3">
            <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
