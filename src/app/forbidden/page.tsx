import { ShieldAlert } from "lucide-react";
import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-300">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold text-white">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-slate-400">Your role doesn&apos;t include this area. Ask an admin if you need access.</p>
        <Link href="/" className="mt-6 inline-block rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
