"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, errorMessage } from "@/lib/api-client";

/** Mutation that refreshes every view of the job and reports conflicts clearly. */
export function useJobAction<TVars>(jobId: string, fn: (vars: TVars) => Promise<unknown>, success: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => toast.success(success),
    onError: (err) => {
      const conflict = err instanceof ApiError && err.status === 409;
      toast.error(conflict ? "Action no longer valid" : "Action failed", { description: errorMessage(err) });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      qc.invalidateQueries({ queryKey: ["events", jobId] });
      qc.invalidateQueries({ queryKey: ["rec", jobId] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["manual-queue"] });
      qc.invalidateQueries({ queryKey: ["riders"] });
    },
  });
}
