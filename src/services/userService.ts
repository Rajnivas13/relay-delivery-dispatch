import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { AppError, notFound } from "@/domain/errors";
import type { Role } from "@/domain/types";
import { isUniqueViolation, prisma } from "@/lib/db";

export const PASSWORD_ROUNDS = 10;
export const TOKEN_PREFIX = "relay_";

const publicUser = {
  id: true,
  email: true,
  name: true,
  role: true,
  riderId: true,
  isActive: true,
  createdAt: true,
  rider: { select: { code: true, name: true } },
} as const;

export const hashPassword = (password: string) => bcrypt.hash(password, PASSWORD_ROUNDS);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export function listUsers() {
  return prisma.user.findMany({ select: publicUser, orderBy: [{ role: "asc" }, { email: "asc" }] });
}

async function assertRiderLink(role: Role, riderId: string | null | undefined, userId?: string) {
  if (role === "RIDER" && !riderId) {
    throw new AppError("VALIDATION_ERROR", "Rider accounts must be linked to a rider profile");
  }
  if (role !== "RIDER" && riderId) {
    throw new AppError("VALIDATION_ERROR", "Only rider accounts can be linked to a rider profile");
  }
  if (riderId) {
    const rider = await prisma.rider.findUnique({ where: { id: riderId }, include: { user: true } });
    if (!rider) throw notFound("Rider", riderId);
    if (rider.user && rider.user.id !== userId) {
      throw new AppError("CONFLICT", `Rider ${rider.code} already has a login (${rider.user.email})`);
    }
  }
}

export async function createUser(input: {
  email: string;
  name: string;
  password: string;
  role: Role;
  riderId?: string | null;
}) {
  await assertRiderLink(input.role, input.riderId);
  try {
    return await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        role: input.role,
        riderId: input.riderId ?? null,
        passwordHash: await hashPassword(input.password),
      },
      select: publicUser,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("CONFLICT", `A user with email ${input.email} already exists`);
    throw err;
  }
}

export async function updateUser(
  id: string,
  patch: { name?: string; role?: Role; isActive?: boolean; password?: string; riderId?: string | null },
  actingUserId: string,
) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound("User", id);

  const nextRole = patch.role ?? user.role;
  const nextRider = patch.riderId !== undefined ? patch.riderId : user.riderId;
  await assertRiderLink(nextRole, nextRider, id);

  const losesAdmin = user.role === "ADMIN" && (nextRole !== "ADMIN" || patch.isActive === false);
  if (losesAdmin) {
    if (id === actingUserId) throw new AppError("CONFLICT", "You cannot remove your own admin access");
    const admins = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
    if (admins <= 1) throw new AppError("CONFLICT", "At least one active admin is required");
  }

  return prisma.user.update({
    where: { id },
    data: {
      name: patch.name,
      role: patch.role,
      isActive: patch.isActive,
      riderId: nextRider,
      ...(patch.password ? { passwordHash: await hashPassword(patch.password) } : {}),
    },
    select: publicUser,
  });
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** The plain token is returned once; only its SHA-256 hash is stored. */
export async function createApiToken(userId: string, name: string, scopes: string[]) {
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  const record = await prisma.apiToken.create({
    data: { userId, name, scopes, tokenHash: hashToken(token), prefix: token.slice(0, 12) },
  });
  return { token, id: record.id, name: record.name, prefix: record.prefix, scopes: record.scopes, createdAt: record.createdAt };
}

export function listApiTokens() {
  return prisma.apiToken.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
      user: { select: { email: true, role: true } },
    },
  });
}

export async function revokeApiToken(id: string) {
  const token = await prisma.apiToken.findUnique({ where: { id } });
  if (!token) throw notFound("API token", id);
  if (token.revokedAt) return token;
  return prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
}

export async function resolveApiToken(plain: string) {
  if (!plain.startsWith(TOKEN_PREFIX)) return null;
  const token = await prisma.apiToken.findUnique({ where: { tokenHash: hashToken(plain) }, include: { user: true } });
  if (!token || token.revokedAt || !token.user.isActive) return null;
  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60_000) {
    await prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  }
  return token;
}
