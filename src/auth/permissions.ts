import type { Role } from "@/domain/types";

const ALL: readonly Role[] = ["ADMIN", "DISPATCHER", "RIDER", "VIEWER"];
const STAFF: readonly Role[] = ["ADMIN", "DISPATCHER", "VIEWER"];
const OPERATORS: readonly Role[] = ["ADMIN", "DISPATCHER"];

/** Role -> permission map. API tokens are further narrowed by their own scope list. */
export const PERMISSIONS = {
  "dashboard:read": STAFF,
  "jobs:read": STAFF,
  "jobs:write": OPERATORS,
  "jobs:assign": OPERATORS,
  "riders:read": STAFF,
  "riders:write": OPERATORS,
  "assignments:respond": ["ADMIN", "DISPATCHER", "RIDER"],
  "delivery:update": ["ADMIN", "DISPATCHER", "RIDER"],
  "rider:self": ["RIDER"],
  "ai:use": OPERATORS,
  "settings:read": ALL,
  "settings:write": ["ADMIN"],
  "users:manage": ["ADMIN"],
  "tokens:manage": ["ADMIN"],
  "docs:read": ALL,
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

export interface PermissionSubject {
  role: Role;
  /** Present only for API-token principals. `*` grants everything the role allows. */
  scopes?: string[];
}

export function roleHas(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function can(subject: PermissionSubject, permission: Permission): boolean {
  if (!roleHas(subject.role, permission)) return false;
  if (!subject.scopes) return true;
  return subject.scopes.includes("*") || subject.scopes.includes(permission);
}
