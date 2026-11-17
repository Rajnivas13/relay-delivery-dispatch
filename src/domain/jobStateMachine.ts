import { AppError } from "./errors";
import type { JobStatus } from "./types";

/**
 * Single source of truth for the delivery lifecycle. Every status change in the
 * services layer goes through `assertTransition`.
 */
export const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  NEW: ["READY_FOR_ASSIGNMENT", "MANUAL_QUEUE", "CANCELLED"],
  READY_FOR_ASSIGNMENT: ["AWAITING_CONFIRMATION", "MANUAL_QUEUE", "CANCELLED"],
  AWAITING_CONFIRMATION: ["ACCEPTED", "MANUAL_QUEUE", "CANCELLED"],
  // ACCEPTED -> MANUAL_QUEUE covers a dispatcher releasing a rider who can no longer do the job.
  ACCEPTED: ["PICKED_UP", "MANUAL_QUEUE", "CANCELLED"],
  // Once goods are collected the job can only be completed; cancelling would strand the parcel.
  PICKED_UP: ["DELIVERED"],
  MANUAL_QUEUE: ["AWAITING_CONFIRMATION", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

export const TERMINAL_STATUSES: readonly JobStatus[] = ["DELIVERED", "CANCELLED"];
export const ASSIGNABLE_STATUSES: readonly JobStatus[] = ["READY_FOR_ASSIGNMENT", "MANUAL_QUEUE"];

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError("INVALID_TRANSITION", `Cannot move a job from ${from} to ${to}`, {
      from,
      to,
      allowed: TRANSITIONS[from],
    });
  }
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isAssignable(status: JobStatus): boolean {
  return ASSIGNABLE_STATUSES.includes(status);
}
