import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError, isAppError } from "@/domain/errors";

export function json<T>(data: T, init?: number | ResponseInit): NextResponse {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

export function errorResponse(err: unknown): NextResponse {
  if (isAppError(err)) return json(errorBody(err.code, err.message, err.details), err.status);
  if (err instanceof ZodError) {
    return json(
      errorBody(
        "VALIDATION_ERROR",
        "Request validation failed",
        err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      ),
      400,
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return json(errorBody("NOT_FOUND", "Record not found"), 404);
    if (err.code === "P2002") return json(errorBody("CONFLICT", "A record with these values already exists"), 409);
    if (err.code === "P2034") return json(errorBody("CONFLICT", "Concurrent update, please retry"), 409);
  }
  console.error("[api] unhandled error", err);
  return json(errorBody("INTERNAL_ERROR", "Something went wrong"), 500);
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON");
  }
  return schema.parse(raw);
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  return schema.parse(params);
}
