// Client links (D-090…D-095). The owner's routes (`/shares`) are ordinary signed-in
// routes. The public ones (`/public/shares/{token}/…`) need no sign-in: the token is
// the credential, and what they answer is limited to one board's live cards (or its
// chosen ones), never notes on pictures, tags or anything else in the studio. They
// speak the old Studio Wall Worker's JSON (snake_case, `{ "error": "<message>" }`),
// because Studio Wall's client page calls them unchanged through its Worker (D-090).
import { Id, Share, ShareInput, db as schema, newId } from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { z } from "zod";
import {
  LIMITS, type OpenShare, guestActor, inShare, openShare, ownerView, recordWrongTry, sharedPins, startUnlock, unlocked,
  wrongTries,
} from "../actions/shares";
import { r2KeyFor } from "../actions/files";
import { getAction, runAction, type Snapshot } from "../actions/runner";
import { cookie } from "../auth/access";
import { requirePermission } from "../auth/permissions";
import { requireActor } from "../auth/session";
import type { AppEnv } from "../env";
import { checkPassword, sha256 } from "../lib/crypto";
import { HttpError } from "../lib/errors";
import { sniffImage, stripMetadata } from "../lib/strip";
import { nowIso } from "../lib/time";
import { IdempotencyHeader, IfMatchHeader, PathId, body, errors, ifMatch, json, newApp, run, send } from "./common";

export const shareRoutes = newApp();

const ShareOut = Share.meta({ id: "Share" });

// ------------------------------------------------------------------ the owner

shareRoutes.openapi(
  createRoute({
    method: "post", path: "/shares", tags: ["shares"], summary: "Make a client link to a board",
    request: { headers: IdempotencyHeader, body: body(ShareInput) },
    responses: { 201: json(ShareOut, "Created; the token is in the link"), 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] },
  }),
  async (c) => {
    const { result, replayed } = await run<Snapshot>(c, "share.create", c.req.valid("json"));
    return send(c, await ownerView(c.env, result), replayed ? 200 : 201);
  },
);

shareRoutes.openapi(
  createRoute({
    method: "get", path: "/shares", tags: ["shares"], summary: "Client links that are on (expired ones too), newest first",
    request: { query: z.object({ boardId: Id.optional() }) },
    responses: { 200: json(z.object({ items: z.array(ShareOut) })), 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "boards:read");
    const { boardId } = c.req.valid("query");
    const s = schema.shares;
    const where = [eq(s.studioId, actor.studioId), isNull(s.deletedAt)];
    if (boardId) where.push(eq(s.boardId, boardId));
    const rows = (await drizzle(c.env.DB).select().from(s).where(and(...where)).orderBy(desc(s.createdAt)).limit(200)) as Snapshot[];
    return send(c, { items: await Promise.all(rows.map((r) => ownerView(c.env, r))) });
  },
);

shareRoutes.openapi(
  createRoute({
    method: "delete", path: "/shares/{id}", tags: ["shares"], summary: "Turn a client link off",
    request: { params: PathId, headers: IfMatchHeader.extend(IdempotencyHeader.shape) },
    responses: { 200: json(ShareOut), 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const { result } = await run<Snapshot>(c, "share.revoke", { id: c.req.valid("param").id, version: ifMatch(c) });
    return send(c, await ownerView(c.env, result));
  },
);

// ------------------------------------------------------------------ clients, through a link

const P = "/public/shares/{token}";
const Token = z.object({ token: z.string().meta({ param: { name: "token", in: "path" } }) });
const Old = z.object({ error: z.string(), password: z.boolean().optional() }).meta({ id: "LinkError" });
const oldErr = (description: string) => json(Old, description);
const Any = z.record(z.string(), z.unknown());

const NO_STORE = { "content-type": "application/json", "cache-control": "no-store" };
const reply = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...NO_STORE, ...headers } });
const fail = (message: string, status: number, extra: Record<string, unknown> = {}) => reply({ error: message, ...extra }, status);

/** Errors in the old Worker's shape, so the client page shows the words. (`never`: these routes answer by hand, like `send`.) */
async function guarded(fn: () => Promise<Response>): Promise<never> {
  try {
    return (await fn()) as never;
  } catch (e) {
    if (e instanceof HttpError) {
      const msg = e.code === "bad_request" && e.message === "Invalid input" ? "Something in that wasn’t right. Please try again." : e.message;
      return fail(msg, e.status) as never;
    }
    throw e;
  }
}

const guestId = (c: Context<AppEnv>) => {
  const g = c.req.header("x-guest-id") ?? "";
  return /^[A-Za-z0-9_-]{16,64}$/.test(g) ? g : null;
};
const ctxOf = (c: Context<AppEnv>) => ({ db: drizzle(c.env.DB), now: nowIso() });

/** The link, if it works and (for a password link) this browser has unlocked it. Else the answer to send. */
async function gate(c: Context<AppEnv>, token: string): Promise<OpenShare | Response> {
  const ctx = ctxOf(c);
  const o = await openShare(ctx, { token });
  if (!o) return fail("This link is no longer active.", 404);
  if (o.share.passwordHash && !(await unlocked(c.env, o.share.id as string, cookie(c.req.raw, "sw_link") ?? null, ctx.now))) {
    return fail("This board needs a password.", 401, { password: true });
  }
  return o;
}

/** What a client may see of a card: never private picture notes, tags or drawings. Idea and link cards show their text. */
export function publicPin(p: Snapshot, guest: string | null) {
  const kind = (p.kind as string) || "image";
  return {
    id: p.id,
    file_ref: p.fileId ?? null,
    meta: { kind, title: String(p.title ?? "") },
    source_credit: p.isOwn ? "" : String(p.sourceCredit ?? ""),
    is_own: !!p.isOwn,
    source_url: kind === "link" ? String(p.sourceUrl ?? "") : "",
    note: kind === "image" ? "" : String(p.note ?? ""),
    palette: Array.isArray(p.palette) ? p.palette : [],
    contributor: String(p.contributorName ?? ""),
    created_at: p.createdAt,
    mine: !!guest && p.createdBy === `guest:${guest}`,
  };
}

const commentOut = (f: Snapshot) => ({
  id: f.id, pin_id: f.pinId ?? null, text: f.text,
  author: (f.authorName as string | null) || (String(f.createdBy ?? "").startsWith("guest:") ? "Client" : "Artist"),
  created_at: f.createdAt,
});

/** Runs a guest action (internal) as this browser, in the link's studio. */
async function asGuest<R>(c: Context<AppEnv>, o: OpenShare, guest: string, name: string, input: unknown) {
  const def = getAction(name)!;
  return (await runAction<R>(def as never, input, {
    env: c.env, actor: guestActor(o.share.studioId as string, guest), origin: new URL(c.req.url).origin, source: "app",
  })).result;
}

shareRoutes.openapi(
  createRoute({
    method: "get", path: P, tags: ["links"], summary: "A client link's board: its cards, comments and this browser's stars",
    security: [], request: { params: Token },
    responses: { 200: json(Any), 401: oldErr("Needs the password"), 404: oldErr("Off, expired or never existed") },
  }),
  (c) => guarded(async () => {
    const o = await gate(c, c.req.valid("param").token);
    if (o instanceof Response) return o;
    const ctx = ctxOf(c), g = guestId(c);
    const pins = await sharedPins(ctx, o);
    const f = schema.boardFeedback;
    // Board-wide comments always show; comments and stars on cards outside a selection never do.
    const feedback = ((await ctx.db.select().from(f).where(and(
      eq(f.studioId, o.share.studioId as string), eq(f.boardId, o.board.id as string), isNull(f.deletedAt),
    ))) as Snapshot[]).filter((x) => !x.pinId || inShare(o, x.pinId as string));
    const cover = pins.find((p) => p.id === o.board.coverPinId && p.fileId) ?? pins.find((p) => p.fileId);
    return reply({
      board: { name: o.board.name, description: o.board.description ?? "" },
      permission: o.permission,
      expires_at: o.share.expiresAt ?? null,
      pins: pins.map((p) => publicPin(p, g)),
      comments: feedback.filter((x) => x.text)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(commentOut),
      starred: g ? feedback.filter((x) => x.starred === true && x.createdBy === `guest:${g}`).map((x) => x.pinId) : [],
      // For link previews (Studio Wall's Worker); a password link answers 401 instead, so it names nothing.
      cover: cover?.fileId ?? null,
    });
  }),
);

shareRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/unlock`, tags: ["links"], summary: "Type a link's password; sets this browser's unlock cookie",
    security: [], request: { params: Token, body: body(z.object({ password: z.string() })) },
    responses: { 200: json(z.object({ ok: z.boolean() })), 400: oldErr("Wrong password"), 404: oldErr("Off or expired"), 429: oldErr("Too many tries") },
  }),
  (c) => guarded(async () => {
    const { token } = c.req.valid("param");
    const ctx = ctxOf(c);
    const o = await openShare(ctx, { token });
    if (!o) return fail("This link is no longer active.", 404);
    if (!o.share.passwordHash) return reply({ ok: true });
    const id = o.share.id as string;
    const ipHash = await sha256(`${c.req.header("cf-connecting-ip") ?? "unknown"}\n${id}`);
    if ((await wrongTries(c.env, id, ipHash, ctx.now)) >= LIMITS.wrongPasswords) {
      return fail("Too many tries. Wait 15 minutes, or ask the artist for the password.", 429);
    }
    const password = String(c.req.valid("json").password ?? "").slice(0, 200);
    if (!password || !(await checkPassword(password, o.share.passwordHash as string))) {
      await recordWrongTry(c.env, id, ipHash, ctx.now);
      return fail("That password isn’t right.", 400);
    }
    const session = await startUnlock(c.env, o.share, ctx.now);
    // The cookie goes back only to this link's own paths: Studio Wall says where its client page calls from.
    const base = c.req.header("x-share-path");
    const path = base && /^\/[A-Za-z0-9/_-]{1,200}$/.test(base) ? base : `/v1/public/shares/${token}`;
    return reply({ ok: true }, 200, {
      "set-cookie": `sw_link=${session.id}; Path=${path}; Max-Age=${session.maxAge}; HttpOnly; Secure; SameSite=Lax`,
    });
  }),
);

shareRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/files/{fileId}`, tags: ["links"], summary: "A picture on the link's board, without its hidden data",
    security: [], request: { params: Token.extend({ fileId: z.string().meta({ param: { name: "fileId", in: "path" } }) }) },
    responses: { 200: { description: "The picture" }, 404: oldErr("Not on this link") },
  }),
  (c) => guarded(async () => {
    const { token, fileId } = c.req.valid("param");
    const o = await gate(c, token);
    if (o instanceof Response) return o;
    const db = drizzle(c.env.DB), studioId = o.share.studioId as string;
    const p = schema.pins;
    const users = (await db.select({ id: p.id }).from(p).where(and(
      eq(p.studioId, studioId), eq(p.boardId, o.board.id as string), eq(p.fileId, fileId), isNull(p.deletedAt),
    ))) as { id: string }[];
    if (!Id.safeParse(fileId).success || !users.some((u) => inShare(o, u.id))) return fail("Not found.", 404);
    const fl = schema.files;
    const [file] = await db.select().from(fl).where(and(
      eq(fl.id, fileId), eq(fl.studioId, studioId), eq(fl.status, "ready"), isNull(fl.deletedAt),
    )).limit(1);
    const obj = file && (await c.env.FILES.get(file.r2Key));
    if (!file || !obj) return fail("Not found.", 404);
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const type = sniffImage(bytes.subarray(0, 16));
    if (!type) return fail("Not found.", 404);
    // Stripped on the way out: the owner's own uploads keep their hidden data in the studio (D-094).
    return new Response(stripMetadata(bytes, type), {
      headers: {
        "content-type": type, "cache-control": "private, max-age=600", "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  }),
);

shareRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/feedback`, tags: ["links"], summary: "A client's comment, or star on a card",
    security: [], request: { params: Token, body: body(z.object({
      pin_id: z.string().nullable().optional(), text: z.string().optional(), starred: z.boolean().optional(), name: z.string().optional(),
    })) },
    responses: { 200: json(Any), 400: oldErr("Bad input"), 403: oldErr("View only"), 404: oldErr("Off, or the card is gone"), 429: oldErr("Too many") },
  }),
  (c) => guarded(async () => {
    const o = await gate(c, c.req.valid("param").token);
    if (o instanceof Response) return o;
    const g = guestId(c);
    if (!g) return fail("Reload the page and try again.", 400);
    const b = c.req.valid("json");
    const pinId = b.pin_id ? String(b.pin_id) : null;
    if (pinId && !Id.safeParse(pinId).success) return fail("That image is no longer on this board.", 404);
    const name = String(b.name ?? "").slice(0, LIMITS.name);
    if (typeof b.starred === "boolean") {
      if (!pinId) return fail("Choose an image to star.", 400);
      await asGuest(c, o, g, "share.star", { shareId: o.share.id, pinId, starred: b.starred, name });
      return reply({ ok: true });
    }
    const text = String(b.text ?? "").trim();
    if (!text || text.length > LIMITS.comment) return fail("Write a comment (up to 2,000 characters).", 400);
    const f = await asGuest<Snapshot>(c, o, g, "share.comment", { shareId: o.share.id, pinId, text, name });
    return reply({ comment: commentOut(f) });
  }),
);

const okPalette = (v: string | null | undefined) => (v ?? "").split(",").filter((x) => /^#[0-9a-f]{6}$/i.test(x)).slice(0, 8);
const text = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const orNull = (s: string) => (s.trim() ? s : null);
type Card = { id: string; kind: "image" | "idea" | "link"; title: string | null; note: string | null; sourceUrl: string | null;
  sourceCredit: string | null; palette: string[]; file: { id: string; name: string; contentType: string; size: number } | null };
type Upload = { key: string; bytes: Uint8Array<ArrayBuffer>; type: string };

/** A picture as a new card: checked by its bytes, stripped, ready to store. */
function imageCard(bytes: Uint8Array<ArrayBuffer>, palette: string[], fields: Partial<Card>, studioId: string): { card: Card; upload: Upload } | Response {
  if (!bytes.byteLength || bytes.byteLength > LIMITS.fileBytes) {
    return fail(`Image too large (${Math.round(LIMITS.fileBytes / 1048576)} MB max).`, 413);
  }
  const type = sniffImage(bytes.subarray(0, 16));
  if (!type) return fail("Images only.", 415);
  const clean = stripMetadata(bytes, type);
  const fileId = newId(), name = `${fileId}.${type.split("/")[1]}`;
  return {
    card: { id: newId(), kind: "image", title: null, note: null, sourceUrl: null, sourceCredit: null, ...fields, palette,
      file: { id: fileId, name, contentType: type, size: clean.byteLength } },
    upload: { key: r2KeyFor(studioId, fileId, name), bytes: clean, type },
  };
}

shareRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/pins`, tags: ["links"],
    summary: "Add cards through a contribute link: up to 10 pictures (multipart: image, palette, title), one picture (its bytes), or a link or note (JSON)",
    security: [], request: { params: Token, query: z.object({ name: z.string().optional() }) },
    responses: { 200: json(Any), 400: oldErr("Bad input"), 403: oldErr("Can't add cards"), 413: oldErr("Too large"), 415: oldErr("Not a picture"), 429: oldErr("Over today's limit") },
  }),
  (c) => guarded(async () => {
    const o = await gate(c, c.req.valid("param").token);
    if (o instanceof Response) return o;
    if (o.permission !== "contribute") return fail("This link can’t add cards.", 403);
    const g = guestId(c);
    if (!g) return fail("Reload the page and try again.", 400);
    const url = new URL(c.req.url), studioId = o.share.studioId as string;
    const type = c.req.header("content-type") ?? "";
    const cards: Card[] = [], uploads: Upload[] = [];
    const many = type.startsWith("multipart/form-data");
    if (many) {
      const form = await c.req.raw.formData().catch(() => null);
      if (!form) return fail("Send the images again.", 400);
      const files = form.getAll("image").filter((f): f is File => typeof f !== "string");
      const palettes = form.getAll("palette").map(String);
      if (!files.length) return fail("Choose an image.", 400);
      if (files.length > LIMITS.batch) return fail(`Up to ${LIMITS.batch} images at a time.`, 400);
      const title = orNull(text(form.get("title"), 200));
      for (const [i, f] of files.entries()) {
        const made = imageCard(new Uint8Array(await f.arrayBuffer()), okPalette(palettes[i]), { title }, studioId);
        if (made instanceof Response) return made;
        cards.push(made.card);
        uploads.push(made.upload);
      }
    } else if (type.startsWith("application/json") || type.startsWith("text/")) {
      const raw = type.startsWith("text/") ? { url: (await c.req.text()).trim() } : await c.req.json().catch(() => null);
      if (!raw || typeof raw !== "object") return fail("Send an image, or JSON with url / note.", 400);
      // An iPhone Shortcut may send its URLs as a list or as several lines; the first link is kept.
      const link = text((Array.isArray(raw.url) ? String(raw.url[0] ?? "") : String(raw.url ?? "")).trim().split(/\s+/)[0], 2000);
      if (link && !/^https?:\/\/\S+$/i.test(link)) return fail("Use a complete http or https link.", 400);
      const note = text(raw.note, 4000);
      if (!link && !note.trim()) return fail("Nothing to save.", 400);
      cards.push({
        id: newId(), kind: link ? "link" : "idea", title: orNull(text(raw.title || url.searchParams.get("title"), 200)),
        note: orNull(note), sourceUrl: link || null, sourceCredit: orNull(text(raw.credit, 200)), palette: [], file: null,
      });
    } else {
      const src = text(url.searchParams.get("source"), 2000);
      const made = imageCard(new Uint8Array(await c.req.arrayBuffer()), okPalette(url.searchParams.get("palette")), {
        title: orNull(text(url.searchParams.get("title"), 200)), sourceCredit: orNull(text(url.searchParams.get("credit"), 200)),
        sourceUrl: /^https?:\/\/\S+$/i.test(src) ? src : null,
      }, studioId);
      if (made instanceof Response) return made;
      cards.push(made.card);
      uploads.push(made.upload);
    }
    // All or nothing: every picture is stored before the cards are written in one batch, and removed again if that fails.
    await Promise.all(uploads.map((u) => c.env.FILES.put(u.key, u.bytes, { httpMetadata: { contentType: u.type } })));
    let pins: Snapshot[];
    try {
      pins = (await asGuest<{ pins: Snapshot[] }>(c, o, g, "share.add", {
        shareId: o.share.id, name: text(url.searchParams.get("name"), LIMITS.name), cards,
      })).pins;
    } catch (e) {
      await Promise.all(uploads.map((u) => c.env.FILES.delete(u.key).catch(() => {})));
      throw e;
    }
    const out = pins.map((p) => publicPin(p, g));
    return reply(many ? { pins: out } : { pin: out[0] });
  }),
);

shareRoutes.openapi(
  createRoute({
    method: "delete", path: `${P}/pins/{id}`, tags: ["links"], summary: "Remove a card this browser added (the owner can restore it)",
    security: [], request: { params: Token.extend(PathId.shape) },
    responses: { 200: json(z.object({ ok: z.boolean() })), 403: oldErr("Not yours, or can't change cards"), 404: oldErr("Not on this board") },
  }),
  (c) => guarded(async () => {
    const { token, id } = c.req.valid("param");
    const o = await gate(c, token);
    if (o instanceof Response) return o;
    if (o.permission !== "contribute") return fail("This link can’t change cards.", 403);
    const g = guestId(c);
    if (!g) return fail("Reload the page and try again.", 400);
    if (!Id.safeParse(id).success) return fail("That card is no longer on this board.", 404);
    await asGuest(c, o, g, "share.remove", { shareId: o.share.id, pinId: id });
    return reply({ ok: true });
  }),
);
