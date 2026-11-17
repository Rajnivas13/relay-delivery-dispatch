"use client";

import { AlertTriangle, Inbox, Loader2, RotateCw, X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type ComponentProps, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "ai";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-indigo-500 text-white hover:bg-indigo-400 shadow-sm shadow-indigo-500/20",
  secondary: "bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-700",
  ghost: "text-slate-300 hover:bg-slate-800/70 hover:text-white",
  danger: "bg-rose-500/90 text-white hover:bg-rose-500",
  success: "bg-emerald-500 text-emerald-950 hover:bg-emerald-400 font-semibold",
  ai: "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-400 hover:to-fuchsia-400 shadow-sm shadow-fuchsia-500/20",
};

const buttonClass = (variant: ButtonVariant, size: "sm" | "md", className?: string) =>
  cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
    buttonStyles[variant],
    className,
  );

/** A link styled as a button; avoids nesting a <button> inside an <a>. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-2xl border border-slate-800/80 bg-slate-900/60 backdrop-blur-sm", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 px-5 py-4">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 text-slate-400">{icon}</div>}
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function Badge({ className, children, title }: { className?: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        className ?? "border-slate-700 bg-slate-800 text-slate-300",
      )}
    >
      {children}
    </span>
  );
}

const fieldBase =
  "w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldBase, "h-10", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, "h-10 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, "min-h-[80px] py-2", className)} {...props} />;
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      {children}
      {error ? <span className="text-xs text-rose-400">{error}</span> : hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-slate-800/70", className)} />;
}

export function EmptyState({ title, description, icon, action }: { title: string; description?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="rounded-full bg-slate-800/70 p-3 text-slate-400">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {description && <p className="max-w-sm text-xs text-slate-400">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="rounded-full bg-rose-500/10 p-3 text-rose-400">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <p className="text-sm text-slate-200">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RotateCw className="h-3.5 w-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm" onClick={onClose} />
      <div className={cn("relative max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl", wide ? "max-w-2xl" : "max-w-md")}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">{title}</h2>
            {description && <p className="mt-1 text-xs text-slate-400">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm text-slate-200">{value}</div>
    </div>
  );
}
