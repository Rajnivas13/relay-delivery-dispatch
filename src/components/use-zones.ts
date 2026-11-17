"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { ZoneView } from "@/lib/view-types";

export function useZones() {
  return useQuery({
    queryKey: ["zones"],
    queryFn: () => api<{ items: ZoneView[] }>("/api/zones").then((r) => r.items),
    staleTime: 5 * 60_000,
  });
}
