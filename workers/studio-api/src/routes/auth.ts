import { Id, Me, newId } from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { sendLoginCode } from "../auth/mail";
import {
  SESSION_COOKIE, SESSION_TTL, createSession, firstStudioId, requireAuth, sessionCookie, upsertUser,
} from "../auth/session";
import { cookie } from "../auth/access";
import type { AppEnv, Env } from "../env";
import { checkPassword, hashPassword, safeEqual, sha256, sixDigitCode } from "../lib/crypto";
import { HttpError } from "../lib/errors";
import { inSeconds, nowIso } from "../lib/time";
import { ErrorBody, body, errors, json, newApp, send } from "./common";

const err429 = (description: string) => ({ description, content: { "application/json": { schema: ErrorBody } } });

const CODE_TTL = 15 * 60;
const MAX_TRIES = 6; // per code (D-019)
// D-049: per address, at most this many codes an hour.
const SENDS_PER_HOUR = 5;
const Email = z.email().transform((e) => e.toLowerCase());

export const authRoutes = newApp();

authRoutes.openapi(
  createRoute({
    method: "post", path: "/auth/code", tags: ["auth"], security: [], summary: "Email a 6-digit sign-in code",
    request: { body: body(z.object({ email: Email })) },
    responses: {
      204: { description: "Code sent (204 for any address, so addresses can't be probed)" },
      400: errors[400],
      429: err429("Too many codes for this address: 5 an hour (D-049)"),
    },
  }),
  async (c) => {
    const { email } = c.req.valid("json");
    // The same limits for every address, known or not, so a 429 says nothing about who has an account.
    const prev = await c.env.DB.prepare("SELECT sends, created_at FROM login_codes WHERE email = ?")
      .bind(email).first<{ sends: number; created_at: string }>();
    const now = Date.now();
    const hourOpen = prev && Date.parse(prev.created_at) > now - 3600_000;
    if (prev && hourOpen && prev.sends >= SENDS_PER_HOUR) {
      const mins = Math.max(1, Math.ceil((Date.parse(prev.created_at) + 3600_000 - now) / 60_000));
      throw new HttpError("rate_limited", `That's ${SENDS_PER_HOUR} codes this hour. Use the newest one, or ask again in ${mins} minute${mins === 1 ? "" : "s"}.`);
    }
    const code = sixDigitCode();
    await c.env.DB.prepare(
      `INSERT INTO login_codes (email, code_hash, attempts, expires_at, created_at, sends) VALUES (?, ?, 0, ?, ?, 1)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at,
         created_at = CASE WHEN ? THEN login_codes.created_at ELSE excluded.created_at END,
         sends = CASE WHEN ? THEN login_codes.sends + 1 ELSE 1 END`,
    ).bind(email, await sha256(code + email), inSeconds(CODE_TTL), nowIso(), hourOpen ? 1 : 0, hourOpen ? 1 : 0).run();
    await sendLoginCode(c.env, email, code);
    return c.body(null, 204);
  },
);

authRoutes.openapi(
  createRoute({
    method: "post", path: "/auth/verify", tags: ["auth"], security: [], summary: "Exchange the code for a session cookie",
    request: { body: body(z.object({ email: Email, code: z.string().regex(/^\d{6}$/) })) },
    responses: { 200: json(Me, "Signed in; sets the session cookie"), 400: errors[400], 429: errors[400] },
  }),
  async (c) => {
    const { email, code } = c.req.valid("json");
    const row = await c.env.DB.prepare("SELECT code_hash, attempts, expires_at FROM login_codes WHERE email = ?")
      .bind(email).first<{ code_hash: string; attempts: number; expires_at: string }>();
    if (!row || row.expires_at < nowIso()) throw new HttpError("bad_request", "That code expired. Ask for a new one.");
    if (row.attempts >= MAX_TRIES) throw new HttpError("rate_limited", "Too many tries. Ask for a new code.");
    if (!safeEqual(row.code_hash, await sha256(code + email))) {
      await c.env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
      throw new HttpError("bad_request", "That code is not right.");
    }
    await c.env.DB.prepare("DELETE FROM login_codes WHERE email = ?").bind(email).run();
    return signIn(c, email);
  },
);

const PASSWORD_TRIES = 5; // in a row, then 15 minutes off (D-080)
const PASSWORD_LOCK = 15 * 60;
const Password = z.string().min(10, "Use at least 10 characters.").max(200);

authRoutes.openapi(
  createRoute({
    method: "post", path: "/auth/password/login", tags: ["auth"], security: [], summary: "Sign in with email and password (D-080)",
    request: { body: body(z.object({ email: Email, password: z.string().min(1).max(200) })) },
    responses: { 200: json(Me, "Signed in; sets the session cookie"), 400: errors[400], 429: err429("Too many wrong passwords: 15 minutes off; the emailed code still works") },
  }),
  async (c) => {
    const { email, password } = c.req.valid("json");
    const user = await c.env.DB.prepare(
      "SELECT id, password_hash, password_failures, password_locked_until FROM users WHERE email = ? AND deleted_at IS NULL",
    ).bind(email).first<{ id: string; password_hash: string | null; password_failures: number; password_locked_until: string | null }>();
    if (user?.password_locked_until && user.password_locked_until > nowIso()) {
      throw new HttpError("rate_limited", "Too many wrong passwords. Try again in 15 minutes, or sign in with an emailed code.");
    }
    // One answer for an unknown address, no password set, or a wrong one, so addresses can't be probed.
    if (!(await checkPassword(password, user?.password_hash ?? null))) {
      if (user?.password_hash) {
        const lock = user.password_failures + 1 >= PASSWORD_TRIES;
        await c.env.DB.prepare(
          "UPDATE users SET password_failures = CASE WHEN ? THEN 0 ELSE password_failures + 1 END, password_locked_until = CASE WHEN ? THEN ? ELSE password_locked_until END WHERE id = ?",
        ).bind(lock ? 1 : 0, lock ? 1 : 0, inSeconds(PASSWORD_LOCK), user.id).run();
      }
      throw new HttpError("bad_request", "That email and password don't match. You can always sign in with an emailed code.");
    }
    await c.env.DB.prepare("UPDATE users SET password_failures = 0, password_locked_until = NULL WHERE id = ?").bind(user!.id).run();
    return signIn(c, email);
  },
);

authRoutes.openapi(
  createRoute({
    method: "put", path: "/auth/password", tags: ["auth"], summary: "Set or change your password (D-080)",
    request: { body: body(z.object({ password: Password })) },
    responses: { 204: { description: "Password set; other sessions are signed out" }, 400: errors[400], 401: errors[401] },
  }),
  async (c) => {
    const auth = requireAuth(c);
    if (!auth.sessionId) throw new HttpError("bad_request", "Sign in with a code to set a password");
    const { password } = c.req.valid("json");
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET password_hash = ?, password_failures = 0, password_locked_until = NULL, updated_at = ? WHERE id = ?")
        .bind(await hashPassword(password), nowIso(), auth.userId),
      // A new password ends every other session, this one kept.
      c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(auth.userId, auth.sessionId),
    ]);
    return c.body(null, 204);
  },
);

authRoutes.openapi(
  createRoute({
    method: "delete", path: "/auth/password", tags: ["auth"], summary: "Remove your password; sign in by code only (D-080)",
    responses: { 204: { description: "Password removed" }, 401: errors[401] },
  }),
  async (c) => {
    const auth = requireAuth(c);
    await c.env.DB.prepare("UPDATE users SET password_hash = NULL, password_failures = 0, password_locked_until = NULL, updated_at = ? WHERE id = ?")
      .bind(nowIso(), auth.userId).run();
    return c.body(null, 204);
  },
);

/** The end of every sign-in: the user (made on first sign-in), a session, the cookie, Me. */
async function signIn(c: Context<AppEnv>, email: string) {
    const user = await upsertUser(c.env, email);
    let studioId = await firstStudioId(c.env, user.id);
    if (!studioId && isOwnerEmail(c.env, email)) studioId = await bootstrapStudio(c.env, user.id);
    const token = await createSession(c.env, user.id, studioId, c.req.header("User-Agent") ?? null);
    c.header("Set-Cookie", sessionCookie(token, SESSION_TTL));
    return send(c, await meFor(c.env, user.id, studioId));
}

authRoutes.openapi(
  createRoute({
    method: "post", path: "/auth/logout", tags: ["auth"], summary: "End the session",
    responses: { 204: { description: "Session ended and cookie cleared" } },
  }),
  async (c) => {
    const token = cookie(c.req.raw, SESSION_COOKIE);
    if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    c.header("Set-Cookie", sessionCookie("", 0));
    return c.body(null, 204);
  },
);

authRoutes.openapi(
  createRoute({
    method: "post", path: "/auth/studio", tags: ["auth"], summary: "Set the session's active studio",
    request: { body: body(z.object({ studioId: Id })) },
    responses: { 200: json(Me), 401: errors[401], 404: errors[404] },
  }),
  async (c) => {
    const auth = requireAuth(c);
    const { studioId } = c.req.valid("json");
    const m = await c.env.DB.prepare(
      "SELECT 1 FROM memberships WHERE user_id = ? AND studio_id = ? AND deleted_at IS NULL",
    ).bind(auth.userId, studioId).first();
    if (!m) throw new HttpError("not_found", "Studio not found");
    if (!auth.sessionId) throw new HttpError("bad_request", "Sign in with a code to switch studios");
    await c.env.DB.prepare("UPDATE sessions SET studio_id = ? WHERE id = ?").bind(studioId, auth.sessionId).run();
    return send(c, await meFor(c.env, auth.userId, studioId));
  },
);

authRoutes.openapi(
  createRoute({
    method: "get", path: "/me", tags: ["auth"], summary: "Who am I, my studios, the active one",
    responses: { 200: json(Me), 401: errors[401] },
  }),
  async (c: Context<AppEnv>) => {
    const auth = requireAuth(c);
    return send(c, await meFor(c.env, auth.userId, auth.studioId));
  },
);

const isOwnerEmail = (env: Env, email: string) =>
  env.OWNER_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email);

/**
 * D-022: an owner email with no studio gets one on first sign-in (studio,
 * owner membership, default settings), logged as one activity entry.
 */
async function bootstrapStudio(env: Env, userId: string): Promise<string> {
  const studioId = newId();
  const now = nowIso();
  const slug = `${env.STUDIO_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "studio"}-${studioId.slice(-6).toLowerCase()}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO studios (id, name, slug, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(studioId, env.STUDIO_NAME, slug, now, now, userId),
    env.DB.prepare("INSERT INTO memberships (id, studio_id, user_id, role, created_at, updated_at, created_by, actor_type) VALUES (?, ?, ?, 'owner', ?, ?, ?, 'system')")
      .bind(newId(), studioId, userId, now, now, userId),
    env.DB.prepare("INSERT INTO studio_settings (studio_id, created_at, updated_at, created_by, actor_type) VALUES (?, ?, ?, ?, 'system')")
      .bind(studioId, now, now, userId),
    env.DB.prepare(
      `INSERT INTO activity_log (id, studio_id, actor_id, actor_type, source, action, entity_type, entity_id, after, created_at)
       VALUES (?, ?, ?, 'system', 'system', 'studio.create', 'studio', ?, ?, ?)`,
    ).bind(newId(), studioId, userId, studioId, JSON.stringify({ id: studioId, name: env.STUDIO_NAME, slug }), now),
  ]);
  return studioId;
}

async function meFor(env: Env, userId: string, activeStudioId: string | null): Promise<z.infer<typeof Me>> {
  const { password_hash, ...user } = (await env.DB.prepare("SELECT id, email, name, password_hash FROM users WHERE id = ?").bind(userId)
    .first<{ id: string; email: string; name: string | null; password_hash: string | null }>())!;
  const rows = await env.DB.prepare(
    `SELECT m.studio_id, s.name, m.role, m.client_id FROM memberships m JOIN studios s ON s.id = m.studio_id
      WHERE m.user_id = ? AND m.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY m.created_at, m.id`,
  ).bind(userId).all<{ studio_id: string; name: string; role: "owner" | "staff" | "client"; client_id: string | null }>();
  return {
    user,
    memberships: rows.results.map((r) => ({ studioId: r.studio_id, studioName: r.name, role: r.role, clientId: r.client_id })),
    activeStudioId,
    hasPassword: password_hash != null,
  };
}
