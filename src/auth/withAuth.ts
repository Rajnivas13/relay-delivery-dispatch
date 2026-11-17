import type { Session } from "next-auth";
import type { NextRequest } from "next/server";
import { AppError } from "@/domain/errors";
import type { Actor, Role } from "@/domain/types";
import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { lazySweep } from "@/lib/lazyExpiry";
import { resolveApiToken } from "@/services/userService";
import { auth } from "./index";
import { can, type Permission } from "./permissions";

export interface Principal {
  userId: string;
  email: string;
  name: string;
  role: Role;
  riderId: string | null;
  via: "session" | "api_token";
  tokenId?: string;
  scopes?: string[];
}

export function toActor(p: Principal): Actor {
  return {
    type: p.via === "api_token" ? "API_TOKEN" : "USER",
    id: p.userId,
    name: p.via === "api_token" ? `${p.email} (token)` : p.name,
    role: p.role,
    riderId: p.riderId,
  };
}

/**
 * Resolves the caller from a bearer API token or the Auth.js session cookie. The user row is
 * re-read on every request so deactivation and role changes take effect immediately.
 */
export async function resolvePrincipal(req: Request): Promise<Principal | null> {
  const header = req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = await resolveApiToken(header.slice(7).trim());
    if (!token) return null;
    return {
      userId: token.user.id,
      email: token.user.email,
      name: token.user.name,
      role: token.user.role,
      riderId: token.user.riderId,
      via: "api_token",
      tokenId: token.id,
      scopes: token.scopes,
    };
  }

  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || !user.isActive) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    riderId: user.riderId,
    via: "session",
  };
}

export interface AuthedContext<P> {
  params: P;
  principal: Principal;
  actor: Actor;
}

export interface WithAuthOptions {
  /** Caller needs at least one of these. */
  permission: Permission | Permission[];
  /** Run the throttled global timeout sweep before the handler (queue reads). */
  lazyExpiry?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- must accept every route's generated params type
type RouteContext = { params: Promise<any> };

/** Every non-public API route is wrapped in this; a test enforces it. */
export function withAuth<P extends Record<string, string> = Record<string, string>>(
  options: WithAuthOptions,
  handler: (req: NextRequest, ctx: AuthedContext<P>) => Promise<Response>,
) {
  const required = Array.isArray(options.permission) ? options.permission : [options.permission];
  return async (req: NextRequest, ctx: RouteContext): Promise<Response> => {
    try {
      const principal = await resolvePrincipal(req);
      if (!principal) throw new AppError("UNAUTHENTICATED", "Sign in or provide a valid API token");
      if (!required.some((p) => can(principal, p))) {
        console.warn(`[auth] ${principal.email} (${principal.role}) denied ${req.method} ${new URL(req.url).pathname}`);
        throw new AppError("FORBIDDEN", "You do not have permission to perform this action", { required });
      }
      if (options.lazyExpiry) await lazySweep();
      const params = ((ctx?.params ? await ctx.params : {}) ?? {}) as P;
      return await handler(req, { params, principal, actor: toActor(principal) });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Riders may only read or act on their own rider profile. */
export function assertOwnRiderOrStaff(principal: Principal, riderId: string) {
  if (principal.role === "RIDER" && principal.riderId !== riderId) {
    throw new AppError("FORBIDDEN", "Riders can only access their own profile");
  }
}
