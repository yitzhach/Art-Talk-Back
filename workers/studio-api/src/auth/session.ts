import { newId } from "@studio/core";
import type { Context } from "hono";
import type { Actor, AppEnv, Auth, Env, Role } from "../env";
import { sha256, randomToken } from "../lib/crypto";
import { HttpError } from "../lib/errors";
import { inSeconds, nowIso } from "../lib/time";
import { accessEmail, cookie } from "./access";

export const SESSION_COOKIE = "studio_session";
export const SESSION_TTL = 30 * 24 * 3600;
/**
 * A session in use is renewed once it is past half its life, so an artist who
 * opens the app at least every two weeks is never signed out mid-season (D-048).
 * One write per two weeks per device, not one per request.
 */
const RENEW_AFTER = SESSION_TTL / 2;

export const sessionCookie = (token: string, maxAge: number) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

interface Membership { studio_id: string; role: Role; client_id: string | null }

async function membership(env: Env, userId: string, studioId: string | null): Promise<Membership | null> {
  if (!studioId) return null;
  return env.DB.prepare(
    "SELECT studio_id, role, client_id FROM memberships WHERE user_id = ? AND studio_id = ? AND deleted_at IS NULL",
  ).bind(userId, studioId).first<Membership>();
}

export async function firstStudioId(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT studio_id FROM memberships WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1",
  ).bind(userId).first<{ studio_id: string }>();
  return row?.studio_id ?? null;
}

/** Resolves the caller from the session cookie, else from Cloudflare Access. */
export async function loadAuth(req: Request, env: Env): Promise<Auth | null> {
  const token = cookie(req, SESSION_COOKIE);
  if (token) {
    const row = await env.DB.prepare(
      `SELECT s.id AS session_id, s.studio_id, s.expires_at, u.id AS user_id, u.email, u.name
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
    ).bind(await sha256(token), nowIso()).first<{
      session_id: string; studio_id: string | null; expires_at: string; user_id: string; email: string; name: string | null;
    }>();
    if (row) {
      const m = await membership(env, row.user_id, row.studio_id);
      let renewedCookie: string | undefined;
      if (row.expires_at < inSeconds(SESSION_TTL - RENEW_AFTER)) {
        await env.DB.prepare("UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?")
          .bind(inSeconds(SESSION_TTL), nowIso(), row.session_id).run();
        renewedCookie = sessionCookie(token, SESSION_TTL);
      }
      return {
        userId: row.user_id, email: row.email, name: row.name, sessionId: row.session_id,
        studioId: m?.studio_id ?? null, role: m?.role ?? null, clientId: m?.client_id ?? null,
        ...(renewedCookie ? { renewedCookie } : {}),
      };
    }
  }
  const email = await accessEmail(req, env);
  if (email) {
    const user = await upsertUser(env, email);
    const m = await membership(env, user.id, await firstStudioId(env, user.id));
    return {
      userId: user.id, email, name: user.name, sessionId: null,
      studioId: m?.studio_id ?? null, role: m?.role ?? null, clientId: m?.client_id ?? null,
    };
  }
  return null;
}

export async function upsertUser(env: Env, email: string): Promise<{ id: string; name: string | null }> {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO users (id, email, created_at, updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  ).bind(newId(), email, now, now, now).run();
  return (await env.DB.prepare("SELECT id, name FROM users WHERE email = ?").bind(email).first<{ id: string; name: string | null }>())!;
}

export async function createSession(env: Env, userId: string, studioId: string | null, userAgent: string | null) {
  const token = randomToken();
  await env.DB.prepare(
    "INSERT INTO sessions (id, token_hash, user_id, studio_id, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(newId(), await sha256(token), userId, studioId, userAgent, nowIso(), nowIso(), inSeconds(SESSION_TTL)).run();
  return token;
}

export function requireAuth(c: Context<AppEnv>): Auth {
  const auth = c.get("auth");
  if (!auth) throw new HttpError("unauthenticated", "Sign in first");
  return auth;
}

/** The caller plus their active studio; every studio route starts here. */
export function requireActor(c: Context<AppEnv>): Actor {
  const auth = requireAuth(c);
  if (!auth.studioId || !auth.role) throw new HttpError("forbidden", "Pick a studio first");
  return auth as Actor;
}
