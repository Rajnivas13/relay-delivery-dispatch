import { z } from "zod";
import { PERMISSION_KEYS } from "@/auth/permissions";
import { JOB_STATUSES, PRIORITIES, RIDER_AVAILABILITY, ROLES } from "@/domain/types";

const reason = z.string().trim().min(3, "Please give a reason (at least 3 characters)").max(500);

export const CreateJobSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dot, dash or underscore")
    .optional(),
  pickupZoneId: z.string().trim().min(1),
  dropZoneId: z.string().trim().min(1),
  loadUnits: z.number().int().min(1).max(100),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  deadlineAt: z.iso.datetime({ offset: true }).nullish(),
  customerName: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateJobInput = z.infer<typeof CreateJobSchema>;

export const JobListQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.enum(JOB_STATUSES)).optional()),
  zone: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  q: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type JobListQuery = z.infer<typeof JobListQuerySchema>;

export const AssignSchema = z.object({
  riderId: z.string().min(1),
  overrideReason: z.string().trim().max(500).optional(),
  expectedVersion: z.number().int().min(0).optional(),
});
export type AssignInput = z.infer<typeof AssignSchema>;

export const ReasonSchema = z.object({ reason });
export const OptionalReasonSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const RiderCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{3,20}$/, "Upper-case letters, digits and dashes")
    .optional(),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(30).optional(),
  availability: z.enum(RIDER_AVAILABILITY).default("OFFLINE"),
  currentZoneId: z.string().min(1),
  zoneIds: z.array(z.string().min(1)).min(1, "Pick at least one service zone"),
  capacityUnits: z.number().int().min(1).max(100),
  maxActiveJobs: z.number().int().min(1).max(10).default(3),
});
export type RiderCreateInput = z.infer<typeof RiderCreateSchema>;

export const RiderUpdateSchema = RiderCreateSchema.omit({ code: true })
  .partial()
  .extend({ expectedVersion: z.number().int().min(0).optional() });
export type RiderUpdateInput = z.infer<typeof RiderUpdateSchema>;

export const AvailabilitySchema = z.object({ availability: z.enum(RIDER_AVAILABILITY) });

export const SettingsPatchSchema = z
  .object({
    confirmationTimeoutSeconds: z.number().int().min(10).max(7 * 24 * 3600).optional(),
    clockOffsetSeconds: z.number().int().min(0).max(30 * 24 * 3600).optional(),
    advanceClockSeconds: z.number().int().min(1).max(7 * 24 * 3600).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Provide at least one setting");

export const UserCreateSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  name: z.string().trim().min(2).max(80),
  password: z.string().min(8).max(128),
  role: z.enum(ROLES),
  riderId: z.string().optional().nullable(),
});

export const UserUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
  riderId: z.string().nullable().optional(),
});

export const TokenCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  scopes: z.array(z.enum(["*", ...PERMISSION_KEYS] as [string, ...string[]])).min(1),
});
