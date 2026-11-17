export const JOB_STATUSES = [
  "NEW",
  "READY_FOR_ASSIGNMENT",
  "AWAITING_CONFIRMATION",
  "ACCEPTED",
  "PICKED_UP",
  "DELIVERED",
  "MANUAL_QUEUE",
  "CANCELLED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const RIDER_AVAILABILITY = ["ONLINE", "OFFLINE", "ON_BREAK"] as const;
export type RiderAvailability = (typeof RIDER_AVAILABILITY)[number];

export const ROLES = ["ADMIN", "DISPATCHER", "RIDER", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export type ActorType = "USER" | "API_TOKEN" | "SYSTEM" | "CRON";

export interface Actor {
  type: ActorType;
  id?: string | null;
  name?: string | null;
  role?: Role;
  riderId?: string | null;
}

export const SYSTEM_ACTOR: Actor = { type: "SYSTEM", name: "system" };
export const CRON_ACTOR: Actor = { type: "CRON", name: "vercel-cron" };

export const MANUAL_QUEUE_REASONS = {
  CONFIRMATION_TIMEOUT: "CONFIRMATION_TIMEOUT",
  RIDER_REJECTED: "RIDER_REJECTED",
  NO_ELIGIBLE_RIDER: "NO_ELIGIBLE_RIDER",
  RELEASED_BY_DISPATCHER: "RELEASED_BY_DISPATCHER",
} as const;
export type ManualQueueReason = keyof typeof MANUAL_QUEUE_REASONS;

export const EVENT_TYPES = {
  JOB_CREATED: "JOB_CREATED",
  STATUS_CHANGED: "STATUS_CHANGED",
  RECOMMENDATION_GENERATED: "RECOMMENDATION_GENERATED",
  RIDER_ASSIGNED: "RIDER_ASSIGNED",
  RIDER_REASSIGNED: "RIDER_REASSIGNED",
  MANUAL_OVERRIDE: "MANUAL_OVERRIDE",
  RIDER_CONFIRMED: "RIDER_CONFIRMED",
  RIDER_REJECTED: "RIDER_REJECTED",
  ASSIGNMENT_TIMEOUT: "ASSIGNMENT_TIMEOUT",
  ASSIGNMENT_RELEASED: "ASSIGNMENT_RELEASED",
  MOVED_TO_MANUAL_QUEUE: "MOVED_TO_MANUAL_QUEUE",
  PICKED_UP: "PICKED_UP",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  AI_SUGGESTION: "AI_SUGGESTION",
} as const;
export type EventType = keyof typeof EVENT_TYPES;
