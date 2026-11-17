import { Radio } from "lucide-react";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

const DEMO_ACCOUNTS = [
  { email: "admin@relay.dev", label: "Admin", hint: "Everything incl. settings and users" },
  { email: "dispatcher@relay.dev", label: "Dispatcher", hint: "Assign, override, manual queue" },
  { email: "viewer@relay.dev", label: "Viewer", hint: "Read-only" },
  { email: "arjun@relay.dev", label: "Rider (Arjun)", hint: "Own offers only" },
  { email: "sneha@relay.dev", label: "Rider (Sneha)", hint: "Has a pending urgent offer" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  const demo = process.env.DEMO_MODE === "true";
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="grid w-full max-w-4xl gap-8 md:grid-cols-[1.1fr_1fr]">
        <section className="flex flex-col justify-center">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-lg shadow-indigo-500/30">
              <Radio className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-lg font-semibold text-white">Project RELAY</div>
              <div className="text-xs text-slate-400">Dispatch desk</div>
            </div>
          </div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            Every delivery job, from intake to doorstep, <span className="bg-gradient-to-r from-indigo-300 to-fuchsia-300 bg-clip-text text-transparent">without the spreadsheet.</span>
          </h1>
          <ul className="mt-6 space-y-2 text-sm text-slate-300">
            <li>AI rider prediction on top of an explainable scoring engine</li>
            <li>Automatic Manual Queue when a rider doesn&apos;t confirm in time</li>
            <li>A complete audit trail for every job</li>
          </ul>
        </section>
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl backdrop-blur">
          <h2 className="text-lg font-semibold text-white">Sign in</h2>
          <p className="mt-1 text-sm text-slate-400">Use your RELAY account.</p>
          <LoginForm callbackUrl={callbackUrl ?? "/"} demoAccounts={demo ? DEMO_ACCOUNTS : []} />
        </section>
      </div>
    </main>
  );
}
