import { ArrowLeft, Smartphone } from "lucide-react";
import Link from "next/link";
import { requireUser } from "@/auth/session";
import { AvailabilityBadge } from "@/components/badges";
import { prisma } from "@/lib/db";
import { RiderApp } from "./rider-app";

export default async function RiderHome() {
  const user = await requireUser();
  if (user.role === "RIDER") {
    if (!user.riderId) return <p className="text-sm text-slate-400">This login is not linked to a rider profile. Ask an admin.</p>;
    return <RiderApp riderId={user.riderId} mode="self" />;
  }

  const riders = await prisma.rider.findMany({ orderBy: { code: "asc" } });
  return (
    <div className="w-full max-w-md">
      <Link href="/" className="mb-4 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to dispatch
      </Link>
      <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
        <Smartphone className="h-5 w-5" /> Rider app simulator
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        Open any rider&apos;s phone view. Actions are logged under your name. Riders who sign in only ever see their own offers.
      </p>
      <div className="mt-4 space-y-2">
        {riders.map((r) => (
          <Link
            key={r.id}
            href={`/rider/${r.id}`}
            className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 hover:border-indigo-500/50"
          >
            <div>
              <div className="text-sm text-slate-100">{r.name}</div>
              <div className="text-xs text-slate-500">
                {r.code} · {r.reservedUnits}/{r.capacityUnits} units · {r.activeJobCount} active
              </div>
            </div>
            <AvailabilityBadge availability={r.availability} />
          </Link>
        ))}
      </div>
    </div>
  );
}
