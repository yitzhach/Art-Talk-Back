import type { Role } from "../env";
import { HttpError } from "../lib/errors";

export type Permission =
  | "artworks:read" | "artworks:write" | "artworks:delete"
  | "clients:read" | "clients:write" | "clients:delete"
  | "shows:read" | "shows:write" | "shows:delete"
  | "sales:read" | "sales:write" | "sales:delete"
  | "placements:read" | "placements:write" | "placements:delete"
  | "boards:read" | "boards:write" | "boards:delete"
  | "files:read" | "files:write"
  | "settings:read" | "settings:write"
  | "activity:read" | "activity:undo"
  | "assistant:use"
  | "shares:guest"
  /** A visitor on a studio's public site (Site 3.0 stage 3): their own leads, pages and email only. */
  | "site:visitor";

// A guest is someone with a client link (D-092) or a visitor on the public site (D-134).
// D-023: staff can do day-to-day work but not delete or change settings.
// Client-role users get nothing here until the client portal (Phase 4).
const STAFF: readonly Permission[] = [
  "artworks:read", "artworks:write", "clients:read", "clients:write", "shows:read", "shows:write",
  "sales:read", "sales:write", "placements:read", "placements:write", "boards:read", "boards:write",
  "files:read", "files:write", "settings:read", "activity:read", "activity:undo",
  "assistant:use",
];

export function can(role: Role, permission: Permission): boolean {
  // A guest (someone with a client link, D-092) can do only what the link's own actions allow.
  if (role === "guest") return permission === "shares:guest" || permission === "site:visitor";
  if (role === "owner") return true;
  if (role === "staff") return STAFF.includes(permission);
  return false;
}

export function requirePermission(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new HttpError("forbidden", `Your role can't do this (${permission})`);
}
