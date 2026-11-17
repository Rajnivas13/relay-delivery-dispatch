"use client";

import { LogIn } from "lucide-react";
import { useActionState, useRef } from "react";
import { Button, Field, Input } from "@/components/ui";
import { login, type LoginState } from "./actions";

export function LoginForm({
  callbackUrl,
  demoAccounts,
}: {
  callbackUrl: string;
  demoAccounts: { email: string; label: string; hint: string }[];
}) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <form action={action} className="mt-5 space-y-4">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <Field label="Email">
          <Input ref={emailRef} name="email" type="email" autoComplete="username" required placeholder="you@company.com" />
        </Field>
        <Field label="Password">
          <Input ref={passwordRef} name="password" type="password" autoComplete="current-password" required />
        </Field>
        {state.error && (
          <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {state.error}
          </p>
        )}
        <Button type="submit" className="w-full" loading={pending}>
          <LogIn className="h-4 w-4" /> Sign in
        </Button>
      </form>

      {demoAccounts.length > 0 && (
        <div className="mt-6 border-t border-slate-800 pt-4">
          <p className="mb-2 text-xs text-slate-400">
            Demo accounts (password <code className="rounded bg-slate-800 px-1 text-slate-200">Relay@123</code>):
          </p>
          <div className="grid gap-1.5">
            {demoAccounts.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => {
                  if (emailRef.current) emailRef.current.value = a.email;
                  if (passwordRef.current) passwordRef.current.value = "Relay@123";
                }}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-left text-xs hover:border-indigo-500/50 hover:bg-slate-800/50"
              >
                <span className="font-medium text-slate-200">{a.label}</span>
                <span className="text-slate-500">{a.hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
