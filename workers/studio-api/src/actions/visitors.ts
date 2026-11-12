// The public site's visitors (Site 3.0 stage 3, D-125…D-141). A visitor is a browser on a studio's site, known only
// by the hash of the site's per-browser key (D-134). Their writes are internal actions run by the public routes
// (routes/visitors.ts) with a guest actor whose studio is the site's: a lead (inquiry or 48-hour hold request), a made
// page, a proven email. The owner answers leads with approve hold / decline / close. Chat messages and usage are
// written directly, like sign-in sessions (they are logs, not records anyone edits).
import { Id, LEAD_LIMITS, LeadKind, LeadSource, Slug, db as schema, newId } from "@studio/core";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Actor, Env } from "../env";
import { randomToken, sha256 } from "../lib/crypto";
import { HttpError } from "../lib/errors";
import { live } from "../lib/collectors";
import { r2KeyFor } from "./files";
import {
  type EntityDef, artworkEntity, bumpCatalogue, checkVersion, clientEntity, defineEntity, fileEntity, getRecord, insertWrite, updateWrite,
} from "./records";
import { type ActionCtx, type Snapshot, type Write, defineAction } from "./runner";

const recordDefaults = { createdBy: null, deletedAt: null, meta: {}, version: 1, actorType: "user" };

export const visitorEntity: EntityDef = defineEntity({
  type: "visitor", table: schema.visitors, key: schema.visitors.id, studio: schema.visitors.studioId,
  version: schema.visitors.version, deletedAt: schema.visitors.deletedAt, perm: "clients",
  defaults: { ...recordDefaults, email: null, emailVerifiedAt: null },
});

export const visitorPageEntity: EntityDef = defineEntity({
  type: "visitor_page", table: schema.visitorPages, key: schema.visitorPages.id, studio: schema.visitorPages.studioId,
  version: schema.visitorPages.version, deletedAt: schema.visitorPages.deletedAt, perm: "clients",
  defaults: { ...recordDefaults, visitorId: null, question: null, artworkIds: [] },
});

export const leadEntity: EntityDef = defineEntity({
  type: "lead", table: schema.leads, key: schema.leads.id, studio: schema.leads.studioId,
  version: schema.leads.version, deletedAt: schema.leads.deletedAt, perm: "clients",
  defaults: {
    ...recordDefaults, visitorId: null, clientId: null, source: "form", status: "new", name: null, email: null, phone: null,
    note: null, artworkIds: [], fileIds: [], threadId: null, expiresAt: null, ipHash: null,
  },
});

/** The site's per-browser key (D-134): random, kept in an HttpOnly cookie by the site's Worker. */
export const VISITOR_KEY = /^[A-Za-z0-9_-]{24,64}$/;
/** A held piece stays reserved this long after Isaac approves the hold (D-127). */
export const HOLD_HOURS = 48;

/** The key's hash is per studio, so one browser on two studios' sites is two visitors. */
export const keyHash = (studioId: string, key: string) => sha256(`visitor\n${studioId}\n${key}`);
/** An address, hashed: kept only to limit how much one address can send. */
export const ipHash = (ip: string | null | undefined) => (ip ? sha256(`ip\n${ip}`) : Promise.resolve(null));

export interface Visitor { id: string; studioId: string; email: string | null; emailVerifiedAt: string | null }

/** The visitor this key names in this studio; made on first use when `create` (written directly, like a session). */
export async function visitorFor(env: Env, studioId: string, key: string, create: boolean): Promise<Visitor | null> {
  if (!VISITOR_KEY.test(key)) return null;
  const hash = await keyHash(studioId, key);
  const find = () => env.DB.prepare(
    "SELECT id, studio_id, email, email_verified_at FROM visitors WHERE key_hash = ? AND studio_id = ? AND deleted_at IS NULL",
  ).bind(hash, studioId).first<Record<string, string | null>>();
  let row = await find();
  if (!row && create) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO visitors (id, studio_id, key_hash, created_at, updated_at, actor_type) VALUES (?, ?, ?, ?, ?, 'system')
       ON CONFLICT(key_hash) DO NOTHING`,
    ).bind(newId(), studioId, hash, now, now).run();
    row = await find();
  }
  return row ? { id: row.id!, studioId: row.studio_id!, email: row.email ?? null, emailVerifiedAt: row.email_verified_at ?? null } : null;
}

/** This visitor and every other browser that proved the same email here: their chats are one person's (D-131). */
export async function linkedVisitorIds(env: Env, v: Visitor): Promise<string[]> {
  if (!v.email || !v.emailVerifiedAt) return [v.id];
  const { results } = await env.DB.prepare(
    "SELECT id FROM visitors WHERE studio_id = ? AND email = ? AND email_verified_at IS NOT NULL AND deleted_at IS NULL LIMIT 50",
  ).bind(v.studioId, v.email).all<{ id: string }>();
  return [...new Set([v.id, ...results.map((r) => r.id)])];
}

/** A visitor as an actor: a guest of the studio, never a member (D-092, D-134). */
export const visitorActor = (studioId: string, visitorId: string): Actor => ({
  userId: `guest:${visitorId}`, email: "", name: null, sessionId: null, studioId, role: "guest", clientId: null,
});

type Row = Record<string, unknown>;

/**
 * Public, undeleted works of this studio by slug, in the order asked; any slug that isn't one is left out. A work in
 * first look counts only for a browser that sees first look (`firstLook`, D-165).
 */
export async function publicWorksBySlug(env: Env, studioId: string, slugs: string[], opts: { firstLook?: boolean } = {}): Promise<Row[]> {
  const want = [...new Set(slugs)].slice(0, 90);
  if (!want.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT * FROM artworks WHERE studio_id = ? AND public = 1 AND deleted_at IS NULL AND kind = 'work'${opts.firstLook ? "" : ` AND ${live()}`}
     AND slug IN (${want.map(() => "?").join(",")})`,
  ).bind(studioId, ...want).all<Row>();
  const bySlug = new Map(results.map((r) => [r.slug as string, r]));
  return want.flatMap((s) => (bySlug.has(s) ? [bySlug.get(s)!] : []));
}

const since = (now: string, ms: number) => new Date(Date.parse(now) - ms).toISOString();

// ------------------------------------------------------------------ visitors (internal: run only by the public routes)

export const visitorVerifyEmail = defineAction({
  name: "visitor.verify_email",
  description: "A site visitor proved their email with a code: their chats follow that email",
  input: z.object({ visitorId: Id, email: z.email().max(200) }),
  permission: "site:visitor",
  risk: "auto",
  internal: true,
  plan: async (ctx, { visitorId, email }) => {
    const before = await getRecord(ctx.db, visitorEntity, ctx.actor.studioId, visitorId);
    return { writes: [updateWrite(ctx, visitorEntity, before, { email: email.toLowerCase(), emailVerifiedAt: ctx.now })] };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

export const visitorPageCreate = defineAction({
  name: "visitor_page.create",
  description: "A page of works from a chat, at its own unlisted link",
  input: z.object({
    visitorId: Id, title: z.string().trim().min(1).max(120), question: z.string().trim().max(500).nullable(),
    works: z.array(Slug).min(1).max(24),
  }),
  permission: "site:visitor",
  risk: "auto",
  internal: true,
  plan: async (ctx, { visitorId, title, question, works }) => {
    const p = schema.visitorPages;
    const [made] = await ctx.db.select({ n: sql<number>`count(*)` }).from(p).where(and(
      eq(p.studioId, ctx.actor.studioId), eq(p.visitorId, visitorId), gt(p.createdAt, since(ctx.now, 86_400_000)),
    ));
    if ((made?.n ?? 0) >= 30) throw new HttpError("rate_limited", "That's the limit of pages for today. Please try tomorrow.");
    const rows = await publicWorksBySlug(ctx.env, ctx.actor.studioId, works);
    if (!rows.length) throw new HttpError("not_found", "Those pieces are no longer on the site.");
    return {
      writes: [insertWrite(ctx, visitorPageEntity, {
        id: newId(), visitorId, token: randomToken(16), title, question, artworkIds: rows.map((r) => r.id as string),
      })],
    };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

/** A picture a visitor attached to a lead; already stripped and in R2 (routes/visitors.ts put it there). */
const LeadPicture = z.object({ id: Id, name: z.string().min(1).max(200), contentType: z.string().max(100), size: z.number().int().min(1) });

export const leadCreate = defineAction({
  name: "lead.create",
  description: "A visitor's inquiry or 48-hour hold request from the site: it reaches the artist",
  input: z.object({
    visitorId: Id,
    kind: LeadKind,
    source: LeadSource,
    works: z.array(Slug).max(LEAD_LIMITS.works),
    name: z.string().trim().max(120).nullable(),
    email: z.string().max(200).nullable(),
    phone: z.string().max(24).nullable(),
    note: z.string().max(LEAD_LIMITS.note).nullable(),
    threadId: Id.nullable(),
    ipHash: z.string().nullable(),
    origin: z.string().max(200),
    pictures: z.array(LeadPicture).max(LEAD_LIMITS.pictures),
  }),
  permission: "site:visitor",
  risk: "auto",
  internal: true,
  plan: async (ctx, input) => {
    const l = schema.leads;
    const day = since(ctx.now, 86_400_000);
    const [mine] = await ctx.db.select({ n: sql<number>`count(*)` }).from(l).where(and(
      eq(l.studioId, ctx.actor.studioId), eq(l.visitorId, input.visitorId), gt(l.createdAt, day)));
    const [here] = input.ipHash ? await ctx.db.select({ n: sql<number>`count(*)` }).from(l).where(and(
      eq(l.studioId, ctx.actor.studioId), eq(l.ipHash, input.ipHash), gt(l.createdAt, day))) : [{ n: 0 }];
    if ((mine?.n ?? 0) >= LEAD_LIMITS.perVisitorPerDay || (here?.n ?? 0) >= LEAD_LIMITS.perAddressPerDay) {
      throw new HttpError("rate_limited", "That's the limit for today. Please text or call instead.");
    }
    const firstLook = await (await import("./collectors")).firstLookAccess(ctx.env, ctx.actor.studioId, input.visitorId);
    const works = await publicWorksBySlug(ctx.env, ctx.actor.studioId, input.works, { firstLook });
    if (works.length < input.works.length) throw new HttpError("not_found", "A piece in your list is no longer on the site. Remove it and send again.");
    if (input.kind === "hold") {
      if (works.length !== 1) throw new HttpError("bad_request", "A hold is for one piece.");
      if (works[0]!.status !== "available") throw new HttpError("bad_request", "That piece isn't available to hold.");
    }

    // The lead creates or matches a client (D-129): same email, or the same phone digits.
    const all = (input.phone ?? "").replace(/\D/g, "");
    const digits = all.length >= 7 ? all.slice(-10) : "";
    let clientId: string | null = null;
    const writes: Write[] = [];
    if (input.email || digits) {
      const match = await ctx.env.DB.prepare(
        `SELECT id FROM clients WHERE studio_id = ? AND deleted_at IS NULL AND (
           (? IS NOT NULL AND lower(email) = ?) OR (? <> '' AND replace(replace(replace(replace(replace(replace(coalesce(phone,''),' ',''),'-',''),'(',''),')',''),'.',''),'+','') LIKE '%' || ?)
         ) ORDER BY created_at LIMIT 1`,
      ).bind(ctx.actor.studioId, input.email, input.email?.toLowerCase() ?? null, digits, digits).first<{ id: string }>();
      clientId = match?.id ?? null;
      if (!clientId) {
        clientId = newId();
        writes.push(insertWrite(ctx, clientEntity, {
          id: clientId, name: input.name || input.email || input.phone || "Site visitor", email: input.email?.toLowerCase() ?? null,
          phone: input.phone, notes: "From the website", meta: { from: "site" },
        }));
      }
    }

    const id = newId();
    for (const p of input.pictures) {
      writes.push(insertWrite(ctx, fileEntity, {
        id: p.id, r2Key: r2KeyFor(ctx.actor.studioId, p.id, p.name), name: p.name, contentType: p.contentType, size: p.size,
        kind: "photo", status: "ready", entityType: "lead", entityId: id,
      }));
    }
    writes.push(insertWrite(ctx, leadEntity, {
      id, visitorId: input.visitorId, clientId, kind: input.kind, source: input.source, status: "new",
      name: input.name || null, email: input.email?.toLowerCase() ?? null, phone: input.phone, note: input.note || null,
      artworkIds: works.map((w) => w.id as string), fileIds: input.pictures.map((p) => p.id), threadId: input.threadId,
      ipHash: input.ipHash, meta: { origin: input.origin },
    }));
    return { writes };
  },
  respond: (_c, a) => a.at(-1) as Snapshot,
});

// ------------------------------------------------------------------ the owner

const LeadAction = z.object({ id: Id, version: z.number().int().min(1) });

export const leadApproveHold = defineAction({
  name: "lead.approve_hold",
  description: "Approve a visitor's hold request: the piece is reserved for 48 hours",
  input: LeadAction,
  permission: "artworks:write",
  risk: "always_confirm",
  // A hold reserves a piece for a stranger: the artist's tap, never the assistant's (D-127).
  assistant: "never",
  plan: async (ctx, { id, version }) => {
    const lead = await getRecord(ctx.db, leadEntity, ctx.actor.studioId, id);
    checkVersion(lead, version);
    if (lead.kind !== "hold") throw new HttpError("bad_request", "This lead isn't a hold request.");
    if (lead.status !== "new") throw new HttpError("bad_request", "This hold request was already answered.");
    const artworkId = (lead.artworkIds as string[])[0];
    if (!artworkId) throw new HttpError("bad_request", "This hold request has no piece.");
    const work = await getRecord(ctx.db, artworkEntity, ctx.actor.studioId, artworkId);
    if (work.status !== "available") throw new HttpError("bad_request", `“${work.title}” is ${String(work.status).replace(/_/g, " ")} now, so it can't be held.`);
    const until = new Date(Date.parse(ctx.now) + HOLD_HOURS * 3_600_000).toISOString();
    return {
      writes: [
        updateWrite(ctx, artworkEntity, work, { status: "reserved", meta: { ...(work.meta as Row), hold: { leadId: id, until } } }),
        bumpCatalogue(ctx),
        updateWrite(ctx, leadEntity, lead, { status: "held", expiresAt: until }),
      ],
    };
  },
  respond: (_c, a) => a.at(-1) as Snapshot,
});

/** Puts a piece held for this lead back on sale, if it still is held for it. */
async function release(ctx: ActionCtx, lead: Snapshot): Promise<Write[]> {
  const artworkId = (lead.artworkIds as string[])[0];
  if (!artworkId) return [];
  const [work] = (await ctx.db.select().from(schema.artworks).where(and(
    eq(schema.artworks.id, artworkId), eq(schema.artworks.studioId, ctx.actor.studioId), isNull(schema.artworks.deletedAt),
  )).limit(1)) as Snapshot[];
  const hold = (work?.meta as Row | undefined)?.hold as { leadId?: string } | undefined;
  if (!work || work.status !== "reserved" || hold?.leadId !== lead.id) return [];
  const { hold: _h, ...meta } = work.meta as Row;
  // The visitor may be paying for it right now (an order, D-144): it stays set aside for the order.
  return [updateWrite(ctx, artworkEntity, work, { status: meta.order ? "reserved" : "available", meta }), bumpCatalogue(ctx)];
}

export const leadDecline = defineAction({
  name: "lead.decline",
  description: "Decline a visitor's hold request (a held piece goes back on sale) or set aside an inquiry",
  input: LeadAction,
  permission: "artworks:write",
  risk: "always_confirm",
  assistant: "never",
  plan: async (ctx, { id, version }) => {
    const lead = await getRecord(ctx.db, leadEntity, ctx.actor.studioId, id);
    checkVersion(lead, version);
    if (lead.status !== "new" && lead.status !== "held") throw new HttpError("bad_request", "This lead was already answered.");
    return { writes: [...(lead.status === "held" ? await release(ctx, lead) : []), updateWrite(ctx, leadEntity, lead, { status: "declined" })] };
  },
  respond: (_c, a) => a.at(-1) as Snapshot,
});

export const leadClose = defineAction({
  name: "lead.close",
  description: "Mark a lead done (a held piece stays reserved until its hold ends)",
  input: LeadAction,
  permission: "clients:write",
  risk: "confirm",
  plan: async (ctx, { id, version }) => {
    const lead = await getRecord(ctx.db, leadEntity, ctx.actor.studioId, id);
    checkVersion(lead, version);
    if (lead.status === "closed") throw new HttpError("bad_request", "This lead is already done.");
    return { writes: [updateWrite(ctx, leadEntity, lead, { status: "closed" })] };
  },
  respond: (_c, a) => a.at(-1) as Snapshot,
});

export const leadExpireHold = defineAction({
  name: "lead.expire_hold",
  description: "A 48-hour hold ended: the piece goes back on sale",
  input: z.object({ id: Id }),
  permission: "artworks:write",
  risk: "auto",
  internal: true,
  plan: async (ctx, { id }) => {
    const lead = await getRecord(ctx.db, leadEntity, ctx.actor.studioId, id);
    if (lead.status !== "held" || !lead.expiresAt || (lead.expiresAt as string) > ctx.now) return { writes: [] };
    return {
      writes: [...(await release(ctx, lead)), updateWrite(ctx, leadEntity, lead, { status: "closed", meta: { ...(lead.meta as Row), holdEnded: ctx.now } })],
    };
  },
  respond: (_c, a) => (a.at(-1) ?? null) as Snapshot | null,
});
