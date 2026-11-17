"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Role } from "@/domain/types";
import { api } from "@/lib/api-client";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  riderId: string | null;
}

interface AppContextValue {
  user: SessionUser;
  offsetMs: number;
  timeoutSeconds: number;
  aiEnabled: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

interface SettingsView {
  now: string;
  confirmationTimeoutSeconds: number;
  aiEnabled: boolean;
}

/** Shares the signed-in user and the server's (possibly simulated) clock offset. */
export function AppProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const started = Date.now();
      const s = await api<SettingsView>("/api/settings");
      const latency = (Date.now() - started) / 2;
      return { ...s, offsetMs: Date.parse(s.now) - (Date.now() - latency) };
    },
    refetchInterval: 15000,
  });
  return (
    <AppContext.Provider
      value={{
        user,
        offsetMs: settings.data?.offsetMs ?? 0,
        timeoutSeconds: settings.data?.confirmationTimeoutSeconds ?? 7200,
        aiEnabled: settings.data?.aiEnabled ?? false,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

export function useCan() {
  const { user } = useApp();
  const operator = user.role === "ADMIN" || user.role === "DISPATCHER";
  return { operator, admin: user.role === "ADMIN", rider: user.role === "RIDER", viewer: user.role === "VIEWER" };
}

/** Ticks every second on the server's clock, including any simulated offset. */
export function useNow(intervalMs = 1000): Date {
  const { offsetMs } = useApp();
  const [now, setNow] = useState(() => new Date(Date.now() + offsetMs));
  useEffect(() => {
    setNow(new Date(Date.now() + offsetMs));
    const id = setInterval(() => setNow(new Date(Date.now() + offsetMs)), intervalMs);
    return () => clearInterval(id);
  }, [offsetMs, intervalMs]);
  return now;
}
