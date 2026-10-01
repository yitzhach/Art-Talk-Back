// Test helpers. Tests are studio-api's own code, so seeding through D1 here
// is fine; nothing outside studio-api does this.
import { env } from "cloudflare:test";
import { newId } from "@studio/core";
import { vi } from "vitest";
import app from "../src/index";
import { sha256, randomToken } from "../src/lib/crypto";

export const BASE = "https://api.test";

export async function call(path: string, init: RequestInit & { cookie?: string; json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("Cookie", init.cookie);
  const { cookie: _c, json, body: rawBody, ...rest } = init;
  let body: BodyInit | null = rawBody ?? null;
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(json);
  }
  const res = await app.request(`${BASE}${path}`, { ...rest, headers, body }, env);
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers, raw: text };
}

export interface Studio { studioId: string; userId: string; cookie: string }

/** A studio with one member, signed in. Role defaults to owner. */
export async function makeStudio(name = "Studio", role: "owner" | "staff" | "client" = "owner"): Promise<Studio> {
  const now = new Date().toISOString();
  const studioId = newId();
  const userId = newId();
  const token = randomToken();
  const statements = [
    env.DB.prepare("INSERT INTO studios (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(studioId, name, `s-${studioId}`, now, now),
    env.DB.prepare("INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(userId, `${userId.toLowerCase()}@example.test`, now, now),
    env.DB.prepare("INSERT INTO studio_settings (studio_id, created_at, updated_at) VALUES (?, ?, ?)").bind(studioId, now, now),
    env.DB.prepare("INSERT INTO sessions (id, token_hash, user_id, studio_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(newId(), await sha256(token), userId, studioId, now, "2999-01-01T00:00:00.000Z"),
  ];
  if (role === "client") {
    const clientId = newId();
    statements.push(env.DB.prepare("INSERT INTO clients (id, studio_id, name, created_at, updated_at) VALUES (?, ?, 'Portal client', ?, ?)").bind(clientId, studioId, now, now));
    statements.push(env.DB.prepare("INSERT INTO memberships (id, studio_id, user_id, role, client_id, created_at, updated_at) VALUES (?, ?, ?, 'client', ?, ?, ?)").bind(newId(), studioId, userId, clientId, now, now));
  } else {
    statements.push(env.DB.prepare("INSERT INTO memberships (id, studio_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(newId(), studioId, userId, role, now, now));
  }
  await env.DB.batch(statements);
  return { studioId, userId, cookie: `studio_session=${token}` };
}

/** Captures the sign-in code from the (mocked) Resend call. */
export function captureCodes() {
  const codes: Record<string, string> = {};
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://api.resend.com/emails") {
      const body = JSON.parse(String(init?.body));
      codes[body.to[0]] = /\b(\d{6})\b/.exec(body.text)![1]!;
      return Response.json({ id: "email_1" });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
  return { codes, restore: () => spy.mockRestore() };
}

export const rowCount = async (sql: string, ...params: unknown[]) =>
  (await env.DB.prepare(sql).bind(...params).first<{ n: number }>("n")) ?? 0;
