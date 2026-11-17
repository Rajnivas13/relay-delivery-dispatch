"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 2000, retry: 1, refetchOnWindowFocus: true },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster theme="dark" position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
