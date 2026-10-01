import type { Role } from "../env";
import { HttpError } from "../lib/errors";

export type Permission =
  | "artworks:read" | "artworks:write" | "artworks:delete"
  | "clients:read" | "clients:write" | "clients:delete"
  | "shows:read" | "shows:write" | "shows:delete"
  | "files:read" | "files:write"
  | "settings:read" | "settings:write"
  | "activity:read" | "activity:undo";

// D-023: staff can do day-to-day work but not delete or change settings.
// Client-role users get nothing here until the client portal (Phase 4).
const STAFF: readonly Permission[] = [
  "artworks:read", "artworks:write", "clients:read", "clients:write", "shows:read", "shows:write",
  "files:read", "files:write", "settings:read", "activity:read", "activity:undo",
];

export function can(role: Role, permission: Permission): boolean {
  if (role === "owner") return true;
  if (role === "staff") return STAFF.includes(permission);
  return false;
}

export function requirePermission(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new HttpError("forbidden", `Your role can't do this (${permission})`);
}
