export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "STALE_VERSION"
  | "INVALID_TRANSITION"
  | "ASSIGNMENT_EXPIRED"
  | "ASSIGNMENT_NOT_PENDING"
  | "RIDER_NOT_ELIGIBLE"
  | "RIDER_CAPACITY_CONFLICT"
  | "OVERRIDE_REASON_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "NO_ELIGIBLE_RIDER"
  | "RATE_LIMITED"
  | "FEATURE_DISABLED"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  OVERRIDE_REASON_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  FEATURE_DISABLED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STALE_VERSION: 409,
  INVALID_TRANSITION: 409,
  ASSIGNMENT_EXPIRED: 409,
  ASSIGNMENT_NOT_PENDING: 409,
  RIDER_NOT_ELIGIBLE: 409,
  RIDER_CAPACITY_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  NO_ELIGIBLE_RIDER: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const notFound = (entity: string, id: string) =>
  new AppError("NOT_FOUND", `${entity} '${id}' was not found`, { entity, id });

export const isAppError = (err: unknown): err is AppError => err instanceof AppError;
