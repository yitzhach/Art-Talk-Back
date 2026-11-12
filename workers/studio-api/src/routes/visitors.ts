// The visitor assistant's routes (Site 3.0 stage 3, D-125…D-141).
//
// Public, no sign-in, under /public/studios/{slug}: the studio is the path's slug and nothing else (D-113). A visitor
// is named by `x-visitor-key`, which the site's Worker sets from its HttpOnly cookie (D-134); nothing else identifies
// them. They can read the chat sheet's settings, the catalogue digest, a made page, their own chat; prove an email;
// make a page; send a lead with pictures.
// Assistant-only (X-Studio-Assistant, D-046): starting a turn (limits, budget, history) and recording it (messages and
// cost). studio-api decides the limits; the assistant only asks (D-045).
// Owner: the leads and this month's spend.
import {
  AssistantUsageOut, Id, LEAD_LIMITS, Lead, LeadDetail, LeadInput, LeadStatus, PublicAssistant, PublicDigest, PublicVisitorPage,
  VisitorPageInput, VisitorState, newId,
} from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { r2KeyFor } from "../actions/files";
import { getAction, runAction, type Snapshot } from "../actions/runner";
import {
  HOLD_HOURS, type Visitor, ipHash, linkedVisitorIds, publicWorksBySlug, visitorActor, visitorFor,
} from "../actions/visitors";
import { sendLoginCode } from "../auth/mail";
import { requirePermission } from "../auth/permissions";
import { requireActor } from "../auth/session";
import type { AppEnv } from "../env";
import { live } from "../lib/collectors";
import { safeEqual, sha256, sixDigitCode } from "../lib/crypto";
import { HttpError, notFound } from "../lib/errors";
import { assistantSettings, sendCapMail, sendLeadMail, siteFor } from "../lib/site-mail";
import { sniffImage, stripMetadata } from "../lib/strip";
import { inSeconds, nowIso } from "../lib/time";
import { COLS, filesOf, imageUrl, parse, publicWork, studioOf } from "./public";
import { IfMatchHeader, PathId, body, errors, ifMatch, json, newApp, run, send } from "./common";

export const visitorRoutes = newApp();

type Row = Record<string, unknown>;
const P = "/public/studios/{slug}";
const SlugParam = z.object({ slug: z.string().meta({ param: { name: "slug", in: "path" } }) });
const KeyHeader = z.object({ "x-visitor-key": z.string().optional().meta({ description: "The site's per-browser key (D-134)" }) });
const err = (description: string) => errors[400] && { ...errors[400], description };

/** Limits the assistant's turns keep (D-130). */
export const VISITOR_LIMITS = {
  perVisitorPerDay: 27, perAddressPerMinute: 8, perAddressPerDay: 150, historyMessages: 20, threadQuietDays: 7,
  messageChars: 1000, replyChars: 4000,
} as const;

/**
 * List prices in thousandths of a cent per million tokens (D-136), checked 2026-11-12. An unknown model is costed as
 * Sonnet 5.5, so a mistake spends the budget faster, never slower.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-haiku-5-5": { input: 10_000, output: 50_000, cacheRead: 1_000, cacheWrite: 12_500 },
  "claude-haiku-4-5": { input: 100_000, output: 500_000, cacheRead: 10_000, cacheWrite: 125_000 },
  "claude-sonnet-5-5": { input: 200_000, output: 1_000_000, cacheRead: 10_000, cacheWrite: 250_000 },
  "claude-opus-5-5": { input: 400_000, output: 2_000_000, cacheRead: 20_000, cacheWrite: 500_000 },
};
export function costMillicents(model: string, u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }) {
  const p = PRICES[model] ?? PRICES["claude-sonnet-5-5"]!;
  return Math.ceil((u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000);
}

const month = (now: string) => now.slice(0, 7);
const ipOf = (c: Context<AppEnv>) => c.req.header("cf-connecting-ip") ?? null;
const fromAssistant = (c: Context<AppEnv>) => {
  // The middleware already refused a wrong key; present means right.
  if (c.req.header("X-Studio-Assistant") === undefined) throw new HttpError("forbidden", "Only the studio's assistant can do this");
};

async function visitorOf(c: Context<AppEnv>, studioId: string, create: boolean): Promise<Visitor> {
  const key = c.req.header("x-visitor-key") ?? "";
  const v = await visitorFor(c.env, studioId, key, create);
  if (!v) {
    if (create) throw new HttpError("bad_request", "Reload the page and try again.");
    throw notFound("Visitor");
  }
  return v;
}

/** Runs one of the visitor actions as this visitor. */
function asVisitor<R>(c: Context<AppEnv>, v: Visitor, name: string, input: unknown) {
  const def = getAction(name)!;
  return runAction<R>(def as never, input, { env: c.env, actor: visitorActor(v.studioId, v.id), origin: new URL(c.req.url).origin, source: "app" });
}

async function spend(c: Context<AppEnv>, studioId: string, now: string) {
  return c.env.DB.prepare("SELECT * FROM assistant_usage WHERE studio_id = ? AND month = ?").bind(studioId, month(now)).first<Row>();
}

const messageOut = (m: Row) => ({ role: m.role as "user" | "assistant", text: m.text as string, works: parse<string[]>(m.works, []), at: m.created_at as string });

/** The visitor's current conversation: the newest thread among their linked browsers, unless it went quiet. */
async function currentThread(c: Context<AppEnv>, v: Visitor, now: string): Promise<{ threadId: string | null; messages: Row[] }> {
  const ids = await linkedVisitorIds(c.env, v);
  const last = await c.env.DB.prepare(
    `SELECT thread_id, created_at FROM visitor_messages WHERE studio_id = ? AND visitor_id IN (${ids.map(() => "?").join(",")})
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(v.studioId, ...ids).first<Row>();
  if (!last || (last.created_at as string) < new Date(Date.parse(now) - VISITOR_LIMITS.threadQuietDays * 86_400_000).toISOString()) {
    return { threadId: null, messages: [] };
  }
  return { threadId: last.thread_id as string, messages: await threadMessages(c, v.studioId, last.thread_id as string, VISITOR_LIMITS.historyMessages) };
}

async function threadMessages(c: Context<AppEnv>, studioId: string, threadId: string, limit: number) {
  const { results } = await c.env.DB.prepare(
    "SELECT role, text, works, created_at FROM visitor_messages WHERE studio_id = ? AND thread_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
  ).bind(studioId, threadId, limit).all<Row>();
  return results.reverse();
}

// ------------------------------------------------------------------ public: the sheet, the digest, made pages

visitorRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/assistant`, tags: ["visitor"], security: [],
    summary: "What the site's chat sheet needs: greeting, suggestions, the studio's answers, and whether the chat is on (no sign-in)",
    request: { params: SlugParam },
    responses: { 200: json(PublicAssistant), 404: errors[404] },
  }),
  async (c) => {
    const studio = await studioOf(c, c.req.valid("param").slug);
    const { site, name } = await siteFor(c.env, studio.id);
    const a = assistantSettings(site);
    const used = await spend(c, studio.id, nowIso());
    const available = a.enabled && Number(used?.cost_millicents ?? 0) < a.budgetCents * 1000;
    return new Response(JSON.stringify({
      name, artistName: a.artistName, greeting: a.greeting, suggestions: a.suggestions, replyTime: a.replyTime, answers: a.answers, available,
      catalogueVersion: studio.version,
    } satisfies z.infer<typeof PublicAssistant>), { headers: { "content-type": "application/json", "cache-control": "public, max-age=30" } }) as never;
  },
);

const DIGEST_MAX = 300;

visitorRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/digest`, tags: ["visitor"], security: [],
    summary: "The catalogue in brief for the assistant: every public work's public fields, newest first, up to 300 (no sign-in)",
    request: { params: SlugParam },
    responses: { 200: json(PublicDigest), 404: errors[404] },
  }),
  async (c) => {
    const { slug } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    const { results } = await c.env.DB.prepare(
      `SELECT ${COLS} FROM artworks WHERE studio_id = ? AND public = 1 AND deleted_at IS NULL AND kind = 'work' AND ${live()}
       ORDER BY COALESCE(published_at, '') DESC, id DESC LIMIT ${DIGEST_MAX}`,
    ).bind(studio.id).all<Row>();
    const files = await filesOf(c, studio.id, results.map((r) => r.id as string));
    const works = results.map((r) => {
      const w = publicWork(slug, r, files.get(r.id as string) ?? []);
      const cover = w.images[0];
      const blurb = w.description ? (w.description.match(/^.{20,240}?[.!?](\s|$)/)?.[0] ?? w.description.slice(0, 240)).trim() : null;
      return {
        slug: w.slug, title: w.title, medium: w.medium, year: w.year, width: w.width, height: w.height, depth: w.depth, sizeUnit: w.sizeUnit,
        status: w.status, priceCents: w.priceCents, currency: w.currency, collection: w.collection, tags: w.tags, palette: w.palette.slice(0, 4),
        blurb, image: cover ? imageUrl(slug, cover.fileId, cover.sizes[0]?.width ?? 480) : null,
      };
    });
    return new Response(JSON.stringify({ works, catalogueVersion: studio.version } satisfies z.infer<typeof PublicDigest>), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
    }) as never;
  },
);

visitorRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/pages/{token}`, tags: ["visitor"], security: [],
    summary: "A made page: its title, the question and its works that are still public (no sign-in; unlisted)",
    request: { params: SlugParam.extend({ token: z.string().meta({ param: { name: "token", in: "path" } }) }) },
    responses: { 200: json(PublicVisitorPage), 404: errors[404] },
  }),
  async (c) => {
    const { slug, token } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound("Page");
    const page = await c.env.DB.prepare(
      "SELECT token, title, question, artwork_ids, created_at FROM visitor_pages WHERE studio_id = ? AND token = ? AND deleted_at IS NULL",
    ).bind(studio.id, token).first<Row>();
    if (!page) throw notFound("Page");
    const ids = parse<string[]>(page.artwork_ids, []).slice(0, 24);
    const { results } = ids.length ? await c.env.DB.prepare(
      `SELECT ${COLS} FROM artworks WHERE studio_id = ? AND public = 1 AND deleted_at IS NULL AND kind = 'work' AND ${live()} AND id IN (${ids.map(() => "?").join(",")})`,
    ).bind(studio.id, ...ids).all<Row>() : { results: [] as Row[] };
    const files = await filesOf(c, studio.id, results.map((r) => r.id as string));
    const byId = new Map(results.map((r) => [r.id as string, r]));
    const works = ids.flatMap((id) => (byId.has(id) ? [publicWork(slug, byId.get(id)!, files.get(id) ?? [])] : []));
    return new Response(JSON.stringify({
      token: page.token as string, title: page.title as string, question: (page.question as string | null) ?? null, works,
      createdAt: page.created_at as string, catalogueVersion: studio.version,
    } satisfies z.infer<typeof PublicVisitorPage>), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=60", "x-robots-tag": "noindex" },
    }) as never;
  },
);

// ------------------------------------------------------------------ public: one visitor (x-visitor-key)

const noStore = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }) as never;

visitorRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/visitor`, tags: ["visitor"], security: [],
    summary: "This browser's chat (and any other browser's that proved the same email): to open the sheet where it was",
    request: { params: SlugParam, headers: KeyHeader },
    responses: { 200: json(VisitorState), 404: errors[404] },
  }),
  async (c) => {
    const studio = await studioOf(c, c.req.valid("param").slug);
    const v = await visitorFor(c.env, studio.id, c.req.header("x-visitor-key") ?? "", false);
    if (!v) return noStore({ email: null, threadId: null, messages: [] } satisfies z.infer<typeof VisitorState>);
    const t = await currentThread(c, v, nowIso());
    return noStore({ email: v.emailVerifiedAt ? v.email : null, threadId: t.threadId, messages: t.messages.map(messageOut) } satisfies z.infer<typeof VisitorState>);
  },
);

const CODE_TTL = 15 * 60, CODE_TRIES = 6, CODES_PER_HOUR = 5;
const Email = z.email().max(200).transform((e) => e.toLowerCase());
const codeKey = (studioId: string, email: string) => `visitor:${studioId}:${email}`;

visitorRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/visitor/email-code`, tags: ["visitor"], security: [],
    summary: "Keep this chat: email a six-digit code to the visitor (D-131)",
    request: { params: SlugParam, headers: KeyHeader, body: body(z.object({ email: Email })) },
    responses: { 204: { description: "Sent (204 for any address)" }, 400: errors[400], 404: errors[404], 429: err("Too many codes") },
  }),
  async (c) => {
    const studio = await studioOf(c, c.req.valid("param").slug);
    await visitorOf(c, studio.id, true);
    const { email } = c.req.valid("json");
    const key = codeKey(studio.id, email);
    // Kept in login_codes under a key no sign-in can use (it isn't an email address), with the same limits (D-049).
    const prev = await c.env.DB.prepare("SELECT sends, created_at FROM login_codes WHERE email = ?").bind(key).first<Row>();
    const now = Date.now();
    const hourOpen = !!prev && Date.parse(prev.created_at as string) > now - 3_600_000;
    if (prev && hourOpen && Number(prev.sends) >= CODES_PER_HOUR) throw new HttpError("rate_limited", "That's 5 codes this hour. Use the newest one.");
    const code = sixDigitCode();
    await c.env.DB.prepare(
      `INSERT INTO login_codes (email, code_hash, attempts, expires_at, created_at, sends) VALUES (?, ?, 0, ?, ?, 1)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at,
         created_at = CASE WHEN ? THEN login_codes.created_at ELSE excluded.created_at END,
         sends = CASE WHEN ? THEN login_codes.sends + 1 ELSE 1 END`,
    ).bind(key, await sha256(code + key), inSeconds(CODE_TTL), nowIso(), hourOpen ? 1 : 0, hourOpen ? 1 : 0).run();
    await sendLoginCode(c.env, email, code, "code to keep your chat");
    return c.body(null, 204) as never;
  },
);

visitorRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/visitor/email-verify`, tags: ["visitor"], security: [],
    summary: "Keep this chat: the code proves the email; this browser's chats now follow it",
    request: { params: SlugParam, headers: KeyHeader, body: body(z.object({ email: Email, code: z.string().regex(/^\d{6}$/) })) },
    responses: { 200: json(VisitorState), 400: errors[400], 404: errors[404], 429: err("Too many tries") },
  }),
  async (c) => {
    const studio = await studioOf(c, c.req.valid("param").slug);
    const v = await visitorOf(c, studio.id, true);
    const { email, code } = c.req.valid("json");
    const key = codeKey(studio.id, email);
    const row = await c.env.DB.prepare("SELECT code_hash, attempts, expires_at FROM login_codes WHERE email = ?").bind(key).first<Row>();
    if (!row || (row.expires_at as string) < nowIso()) throw new HttpError("bad_request", "That code expired. Ask for a new one.");
    if (Number(row.attempts) >= CODE_TRIES) throw new HttpError("rate_limited", "Too many tries. Ask for a new code.");
    if (!safeEqual(row.code_hash as string, await sha256(code + key))) {
      await c.env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?").bind(key).run();
      throw new HttpError("bad_request", "That code is not right.");
    }
    await c.env.DB.prepare("DELETE FROM login_codes WHERE email = ?").bind(key).run();
    await asVisitor(c, v, "visitor.verify_email", { visitorId: v.id, email });
    const proved = { ...v, email, emailVerifiedAt: nowIso() };
    const t = await currentThread(c, proved, nowIso());
    return noStore({ email, threadId: t.threadId, messages: t.messages.map(messageOut) } satisfies z.infer<typeof VisitorState>);
  },
);

visitorRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/visitor/pages`, tags: ["visitor"], security: [],
    summary: "Open these as a page: save works from a chat at their own unlisted link (D-131)",
    request: { params: SlugParam, headers: KeyHeader, body: body(VisitorPageInput) },
    responses: { 201: json(z.object({ token: z.string(), path: z.string() })), 400: errors[400], 404: errors[404], 429: err("Too many pages today") },
  }),
  async (c) => {
    const studio = await studioOf(c, c.req.valid("param").slug);
    const v = await visitorOf(c, studio.id, true);
    const b = c.req.valid("json");
    const { result } = await asVisitor<Snapshot>(c, v, "visitor_page.create", { visitorId: v.id, title: b.title, question: b.question ?? null, works: b.works });
    return noStore({ token: result.token, path: `/p/${result.token}` }, 201);
  },
);

/** A picture a visitor attaches: checked by its bytes, stripped of hidden data (D-094), ready to store. */
async function picture(f: File, studioId: string) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > LEAD_LIMITS.pictureBytes) {
    throw new HttpError("bad_request", `Each picture can be up to ${LEAD_LIMITS.pictureBytes / 1048576} MB. Choose a smaller one.`);
  }
  const type = sniffImage(bytes.subarray(0, 16));
  if (!type || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) throw new HttpError("bad_request", "Pictures only (JPEG, PNG, WebP or GIF).");
  const clean = stripMetadata(bytes, type);
  const id = newId(), name = `${id}.${type.split("/")[1]}`;
  return { meta: { id, name, contentType: type, size: clean.byteLength }, key: r2KeyFor(studioId, id, name), bytes: clean, type };
}

const toBase64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const MAIL_ATTACH_BYTES = 20 * 1024 * 1024;

visitorRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/visitor/leads`, tags: ["visitor"], security: [],
    summary: "Send Isaac an inquiry or a 48-hour hold request: JSON, or multipart with `lead` (JSON) and up to 5 `picture` files (D-129, D-133)",
    // The body (LeadInput as JSON, or multipart) is parsed by hand: a declared body would be validated as one type only.
    request: { params: SlugParam, headers: KeyHeader },
    responses: { 201: json(z.object({ id: Id, kind: z.string(), status: z.string() })), 400: errors[400], 404: errors[404], 429: err("Over today's limit") },
  }),
  async (c) => {
    const studio = await studioOf(c, c.req.valid("param").slug);
    const v = await visitorOf(c, studio.id, true);
    const type = c.req.header("content-type") ?? "";
    let raw: unknown, files: File[] = [];
    if (type.startsWith("multipart/form-data")) {
      const form = await c.req.raw.formData().catch(() => null);
      if (!form) throw new HttpError("bad_request", "Send the form again.");
      try { raw = JSON.parse(String(form.get("lead") ?? "")); } catch { throw new HttpError("bad_request", "Send the form again."); }
      files = form.getAll("picture").filter((f): f is File => typeof f !== "string");
      if (files.length > LEAD_LIMITS.pictures) throw new HttpError("bad_request", `Up to ${LEAD_LIMITS.pictures} pictures.`);
    } else {
      raw = await c.req.json().catch(() => null);
    }
    const parsed = LeadInput.safeParse(raw);
    if (!parsed.success) throw new HttpError("bad_request", parsed.error.issues[0]?.message ?? "Invalid input", { issues: parsed.error.issues });
    const lead = parsed.data;
    // The hidden trap (D-133): a person never fills it. Answer as if sent; store and send nothing.
    if (lead.website) return noStore({ id: newId(), kind: lead.kind, status: "new" }, 201);

    const pics = await Promise.all(files.map((f) => picture(f, studio.id)));
    await Promise.all(pics.map((p) => c.env.FILES.put(p.key, p.bytes, { httpMetadata: { contentType: p.type } })));
    const origin = new URL(c.req.url).origin;
    let result: Snapshot;
    try {
      result = (await asVisitor<Snapshot>(c, v, "lead.create", {
        visitorId: v.id, kind: lead.kind, source: lead.source, works: lead.works, name: lead.name ?? null, email: lead.email ?? null,
        phone: lead.phone ?? null, note: lead.note ?? null, threadId: lead.threadId ?? null, ipHash: await ipHash(ipOf(c)), origin,
        pictures: pics.map((p) => p.meta),
      })).result;
    } catch (e) {
      await Promise.all(pics.map((p) => c.env.FILES.delete(p.key).catch(() => {})));
      throw e;
    }

    // One email to the studio at once (D-129), with the pictures (already stripped) while they fit.
    const { name } = await siteFor(c.env, studio.id);
    const works = await publicWorksBySlug(c.env, studio.id, lead.works);
    const chat = lead.threadId ? (await threadMessages(c, studio.id, lead.threadId, 10)).map((m) => ({ role: m.role as string, text: m.text as string })) : [];
    let room = MAIL_ATTACH_BYTES;
    const attach = pics.filter((p) => (room -= p.bytes.byteLength) >= 0);
    const mail = sendLeadMail(c.env, studio.id, {
      kind: lead.kind, name: lead.name ?? null, email: lead.email?.toLowerCase() ?? null, phone: lead.phone ?? null, note: lead.note ?? null, works, origin, chat,
      pictures: attach.map((p) => ({ filename: p.meta.name, content: toBase64(p.bytes) })), morePictures: pics.length - attach.length, studioName: name,
    });
    try { c.executionCtx.waitUntil(mail); } catch { await mail; }
    return noStore({ id: result.id as string, kind: result.kind as string, status: result.status as string }, 201);
  },
);

// ------------------------------------------------------------------ the assistant: a turn's limits, then its record

const TurnStart = z.union([
  z.object({ allowed: z.literal(true), threadId: z.string(), visitorId: Id, history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string(), works: z.array(z.string()) })) }),
  z.object({ allowed: z.literal(false), reason: z.enum(["off", "budget", "daily", "burst"]) }),
]);

visitorRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/visitor/turn-start`, tags: ["visitor"],
    summary: "The assistant asks whether this visitor may have a turn (limits, budget) and gets the conversation so far",
    request: { params: SlugParam, headers: KeyHeader, body: body(z.object({ fresh: z.boolean().optional(), ip: z.string().max(64).optional() })) },
    responses: { 200: json(TurnStart), 400: errors[400], 403: errors[403], 404: errors[404] },
  }),
  async (c) => {
    fromAssistant(c);
    const studio = await studioOf(c, c.req.valid("param").slug);
    const { fresh, ip } = c.req.valid("json");
    const now = nowIso();
    const { site } = await siteFor(c.env, studio.id);
    const a = assistantSettings(site);
    if (!a.enabled) return noStore({ allowed: false, reason: "off" });
    if (Number((await spend(c, studio.id, now))?.cost_millicents ?? 0) >= a.budgetCents * 1000) return noStore({ allowed: false, reason: "budget" });
    const v = await visitorOf(c, studio.id, true);
    const ids = await linkedVisitorIds(c.env, v);
    const day = new Date(Date.parse(now) - 86_400_000).toISOString();
    const mine = await c.env.DB.prepare(
      `SELECT count(*) AS n FROM visitor_messages WHERE studio_id = ? AND role = 'user' AND created_at > ? AND visitor_id IN (${ids.map(() => "?").join(",")})`,
    ).bind(studio.id, day, ...ids).first<number>("n");
    if (Number(mine ?? 0) >= VISITOR_LIMITS.perVisitorPerDay) return noStore({ allowed: false, reason: "daily" });
    const ih = await ipHash(ip);
    if (ih) {
      const r = await c.env.DB.prepare(
        `SELECT sum(created_at > ?) AS minute, count(*) AS day FROM visitor_messages WHERE studio_id = ? AND ip_hash = ? AND role = 'user' AND created_at > ?`,
      ).bind(new Date(Date.parse(now) - 60_000).toISOString(), studio.id, ih, day).first<Row>();
      if (Number(r?.minute ?? 0) >= VISITOR_LIMITS.perAddressPerMinute || Number(r?.day ?? 0) >= VISITOR_LIMITS.perAddressPerDay) {
        return noStore({ allowed: false, reason: "burst" });
      }
    }
    const t = fresh ? { threadId: null, messages: [] } : await currentThread(c, v, now);
    return noStore({
      allowed: true, threadId: t.threadId ?? newId(), visitorId: v.id,
      history: t.messages.map((m) => ({ role: m.role as "user" | "assistant", text: m.text as string, works: parse<string[]>(m.works, []) })),
    });
  },
);

const TurnRecord = z.object({
  threadId: Id,
  user: z.string().min(1).max(VISITOR_LIMITS.messageChars),
  reply: z.string().max(VISITOR_LIMITS.replyChars),
  works: z.array(z.string().max(80)).max(12),
  /** The reply handed the question to the artist: the daily summary lists these (D-137). */
  askArtist: z.boolean(),
  /** Prices or titles the check replaced before the visitor saw the reply (the gate counts these). */
  fixed: z.number().int().min(0).max(100),
  model: z.string().max(60),
  usage: z.object({
    inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0),
    cacheReadTokens: z.number().int().min(0), cacheWriteTokens: z.number().int().min(0),
  }),
  ip: z.string().max(64).optional(),
  origin: z.string().max(200).optional(),
});

visitorRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/visitor/turn`, tags: ["visitor"],
    summary: "The assistant records a finished turn: the visitor's message, the checked reply and what it cost (D-136)",
    request: { params: SlugParam, headers: KeyHeader, body: body(TurnRecord) },
    responses: { 200: json(z.object({ ok: z.boolean(), capped: z.boolean() })), 400: errors[400], 403: errors[403], 404: errors[404] },
  }),
  async (c) => {
    fromAssistant(c);
    const studio = await studioOf(c, c.req.valid("param").slug);
    const v = await visitorOf(c, studio.id, false);
    const t = c.req.valid("json");
    // A thread belongs to one visitor (or browsers that proved the same email): never write into another's.
    const owner = await c.env.DB.prepare("SELECT visitor_id FROM visitor_messages WHERE studio_id = ? AND thread_id = ? LIMIT 1")
      .bind(studio.id, t.threadId).first<string>("visitor_id");
    if (owner && !(await linkedVisitorIds(c.env, v)).includes(owner)) throw new HttpError("forbidden", "Not this visitor's conversation");
    const now = nowIso(), later = new Date(Date.parse(now) + 1).toISOString();
    const ih = await ipHash(t.ip);
    const cost = costMillicents(t.model, t.usage);
    const actor = `guest:${v.id}`;
    const ins = (role: string, text: string, works: string[], at: string, meta: Row) => c.env.DB.prepare(
      `INSERT INTO visitor_messages (id, studio_id, visitor_id, thread_id, role, text, works, ip_hash, created_at, updated_at, created_by, actor_type, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(newId(), studio.id, v.id, t.threadId, role, text, JSON.stringify(works), role === "user" ? ih : null, at, at,
      role === "user" ? actor : "assistant", role === "user" ? "user" : "assistant", JSON.stringify(meta));
    await c.env.DB.batch([
      ins("user", t.user, [], now, t.origin ? { origin: t.origin } : {}),
      ins("assistant", t.reply, t.works, later, { askArtist: t.askArtist, fixed: t.fixed, model: t.model, costMillicents: cost }),
      c.env.DB.prepare(
        `INSERT INTO assistant_usage (studio_id, month, turns, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_millicents, updated_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(studio_id, month) DO UPDATE SET turns = turns + 1, input_tokens = input_tokens + excluded.input_tokens,
           output_tokens = output_tokens + excluded.output_tokens, cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
           cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens, cost_millicents = cost_millicents + excluded.cost_millicents,
           updated_at = excluded.updated_at`,
      ).bind(studio.id, month(now), t.usage.inputTokens, t.usage.outputTokens, t.usage.cacheReadTokens, t.usage.cacheWriteTokens, cost, now),
    ]);
    // At the cap, tell the artist once a month (D-130).
    const { site } = await siteFor(c.env, studio.id);
    const budget = assistantSettings(site).budgetCents;
    let capped = false;
    const used = await spend(c, studio.id, now);
    if (Number(used?.cost_millicents ?? 0) >= budget * 1000) {
      capped = true;
      const first = await c.env.DB.prepare("UPDATE assistant_usage SET capped_at = ? WHERE studio_id = ? AND month = ? AND capped_at IS NULL")
        .bind(now, studio.id, month(now)).run();
      if (first.meta.changes === 1) {
        const mail = sendCapMail(c.env, studio.id, budget, t.origin ?? null);
        try { c.executionCtx.waitUntil(mail); } catch { await mail; }
      }
    }
    return noStore({ ok: true, capped });
  },
);

// ------------------------------------------------------------------ the owner: leads and spend

async function leadOut(c: Context<AppEnv>, studioId: string, rows: Row[]): Promise<z.infer<typeof Lead>[]> {
  const ids = [...new Set(rows.flatMap((r) => parse<string[]>(r.artwork_ids, [])))];
  const works = new Map<string, Row>();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const { results } = await c.env.DB.prepare(
      `SELECT id, slug, title, status, price_cents, currency FROM artworks WHERE studio_id = ? AND id IN (${part.map(() => "?").join(",")})`,
    ).bind(studioId, ...part).all<Row>();
    for (const w of results) works.set(w.id as string, w);
  }
  return rows.map((r) => ({
    id: r.id as string, version: Number(r.version), kind: r.kind as "inquiry", source: r.source as "form", status: r.status as "new",
    name: (r.name as string | null) ?? null, email: (r.email as string | null) ?? null, phone: (r.phone as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    works: parse<string[]>(r.artwork_ids, []).flatMap((id) => {
      const w = works.get(id);
      return w ? [{ id, slug: (w.slug as string | null) ?? null, title: w.title as string, status: w.status as "available", priceCents: (w.price_cents as number | null) ?? null, currency: (w.currency as string | null) ?? null }] : [];
    }),
    fileIds: parse<string[]>(r.file_ids, []), clientId: (r.client_id as string | null) ?? null, threadId: (r.thread_id as string | null) ?? null,
    expiresAt: (r.expires_at as string | null) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  }));
}

visitorRoutes.openapi(
  createRoute({
    method: "get", path: "/leads", tags: ["leads"], summary: "Leads from the site, newest first: open (new and held) by default",
    request: { query: z.object({ status: z.union([LeadStatus, z.enum(["open", "all"])]).default("open") }) },
    responses: { 200: json(z.object({ items: z.array(Lead) })), 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "clients:read");
    const { status } = c.req.valid("query");
    const where = status === "all" ? "" : status === "open" ? "AND status IN ('new','held')" : "AND status = ?";
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM leads WHERE studio_id = ? AND deleted_at IS NULL ${where} ORDER BY created_at DESC LIMIT 200`,
    ).bind(actor.studioId, ...(status !== "all" && status !== "open" ? [status] : [])).all<Row>();
    return send(c, { items: await leadOut(c, actor.studioId, results) });
  },
);

visitorRoutes.openapi(
  createRoute({
    method: "get", path: "/leads/{id}", tags: ["leads"], summary: "One lead with the chat it came from",
    request: { params: PathId },
    responses: { 200: json(LeadDetail), 401: errors[401], 403: errors[403], 404: errors[404] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "clients:read");
    const row = await c.env.DB.prepare("SELECT * FROM leads WHERE studio_id = ? AND id = ? AND deleted_at IS NULL")
      .bind(actor.studioId, c.req.valid("param").id).first<Row>();
    if (!row) throw notFound("Lead");
    const [lead] = await leadOut(c, actor.studioId, [row]);
    const chat = row.thread_id ? (await threadMessages(c, actor.studioId, row.thread_id as string, 60)).map(messageOut) : [];
    return send(c, { ...lead, chat });
  },
);

for (const [path, action, summary] of [
  ["approve-hold", "lead.approve_hold", `Approve a hold request: the piece is reserved for ${HOLD_HOURS} hours`],
  ["decline", "lead.decline", "Decline a hold request or set an inquiry aside; a held piece goes back on sale"],
  ["close", "lead.close", "Mark a lead done"],
] as const) {
  visitorRoutes.openapi(
    createRoute({
      method: "post", path: `/leads/{id}/${path}`, tags: ["leads"], summary,
      request: { params: PathId, headers: IfMatchHeader },
      responses: { 200: json(Lead), 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404], 409: errors[409] },
    }),
    async (c) => {
      const actor = requireActor(c);
      const { result } = await run<Snapshot>(c, action, { id: c.req.valid("param").id, version: ifMatch(c) });
      const row = await c.env.DB.prepare("SELECT * FROM leads WHERE studio_id = ? AND id = ?").bind(actor.studioId, result.id).first<Row>();
      return send(c, (await leadOut(c, actor.studioId, [row!]))[0]);
    },
  );
}

visitorRoutes.openapi(
  createRoute({
    method: "get", path: "/site/assistant-usage", tags: ["leads"], summary: "What the site's assistant has spent this month, against its budget",
    responses: { 200: json(AssistantUsageOut), 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "settings:read");
    const now = nowIso();
    const used = await spend(c, actor.studioId, now);
    const { site } = await siteFor(c.env, actor.studioId);
    const budgetCents = assistantSettings(site).budgetCents;
    const spentCents = Math.round(Number(used?.cost_millicents ?? 0) / 10) / 100;
    return send(c, { month: month(now), turns: Number(used?.turns ?? 0), spentCents, budgetCents, capped: spentCents >= budgetCents } satisfies z.infer<typeof AssistantUsageOut>);
  },
);
