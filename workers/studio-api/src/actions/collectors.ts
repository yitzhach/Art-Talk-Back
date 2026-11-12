// Collectors (Site 3.0 stage 6, D-163…D-168).
//
// The owner: a collector's private link (`collector.link`, `collector.invite`), who owns a work (`artwork.set_owner`,
// for pieces sold before the platform or by hand), first look on a work (`artwork.first_look`), commissions (CRUD,
// followed through the studio's five stages), and the first-look email (`first_look.announce`, his tap).
// The public site (internal, run only by the public routes): a browser that opened a collector's link or follows the
// studio sees first look (`collector.visit`, `follow.verify`), and a follower can stop (`follow.stop`).
// Ownership stays on the artwork, `meta.sale.clientId` (D-029, D-164), so the Show Tracker and the site agree.
import { CommissionInput, CommissionPatch, FirstLookInput, Id, SetOwnerInput, db as schema, newId } from "@studio/core";
import { z } from "zod";
import type { Env } from "../env";
import { DEFAULT_FIRST_LOOK_DAYS } from "../lib/collectors";
import { randomToken } from "../lib/crypto";
import { HttpError } from "../lib/errors";
import {
  type EntityDef, artworkEntity, bumpCatalogue, checkVersion, clientEntity, crudActions, defineEntity, findRecord, getRecord, insertWrite,
  showEntity, updateWrite,
} from "./records";
import { type ActionCtx, type Snapshot, type Write, defineAction } from "./runner";
import { visitorEntity } from "./visitors";

type Row = Record<string, unknown>;
const recordDefaults = { createdBy: null, deletedAt: null, meta: {}, version: 1, actorType: "user" };

export const collectorLinkEntity: EntityDef = defineEntity({
  type: "collector_link", table: schema.collectorLinks, key: schema.collectorLinks.id, studio: schema.collectorLinks.studioId,
  version: schema.collectorLinks.version, deletedAt: schema.collectorLinks.deletedAt, perm: "clients",
  defaults: { ...recordDefaults, revokedAt: null, invitedAt: null },
});

export const followerEntity: EntityDef = defineEntity({
  type: "follower", table: schema.followers, key: schema.followers.id, studio: schema.followers.studioId,
  version: schema.followers.version, deletedAt: schema.followers.deletedAt, perm: "clients",
  defaults: { ...recordDefaults, clientId: null, showId: null, verifiedAt: null, unsubscribedAt: null },
});

export const commissionEntity: EntityDef = defineEntity({
  type: "commission", table: schema.commissions, key: schema.commissions.id, studio: schema.commissions.studioId,
  version: schema.commissions.version, deletedAt: schema.commissions.deletedAt, perm: "clients",
  defaults: { ...recordDefaults, size: null, priceCents: null, currency: "USD", stage: "surface", status: "open", notes: {}, dueOn: null },
});

/** The collector's link tokens: 24 URL-safe characters (144 bits). */
export const LINK_TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/** The live link of a client, if any (one at a time, D-163). */
export async function liveLink(env: Env, studioId: string, clientId: string): Promise<Row | null> {
  return env.DB.prepare(
    "SELECT * FROM collector_links WHERE studio_id = ? AND client_id = ? AND revoked_at IS NULL AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
  ).bind(studioId, clientId).first<Row>();
}

/** A link by its token, still live, with its client. */
export async function linkByToken(env: Env, studioId: string, token: string): Promise<{ link: Row; client: Row } | null> {
  if (!LINK_TOKEN.test(token)) return null;
  const link = await env.DB.prepare(
    "SELECT * FROM collector_links WHERE studio_id = ? AND token = ? AND revoked_at IS NULL AND deleted_at IS NULL",
  ).bind(studioId, token).first<Row>();
  if (!link) return null;
  const client = await env.DB.prepare("SELECT * FROM clients WHERE studio_id = ? AND id = ? AND deleted_at IS NULL")
    .bind(studioId, link.client_id).first<Row>();
  return client ? { link, client } : null;
}

/** A follower by their token: every follower email and page carries it. */
export async function followerByToken(env: Env, studioId: string, token: string): Promise<Row | null> {
  if (!LINK_TOKEN.test(token)) return null;
  return env.DB.prepare("SELECT * FROM followers WHERE studio_id = ? AND token = ? AND deleted_at IS NULL").bind(studioId, token).first<Row>();
}

/**
 * Does this browser see first look? It does while the collector's link it opened is live, or while the follow it
 * proved stands (D-165). Checked each time, so a revoked link or a stopped follow ends it at once.
 */
export async function firstLookAccess(env: Env, studioId: string, visitorId: string | null | undefined): Promise<boolean> {
  if (!visitorId) return false;
  const v = await env.DB.prepare("SELECT meta FROM visitors WHERE studio_id = ? AND id = ? AND deleted_at IS NULL").bind(studioId, visitorId).first<Row>();
  let fl: { kind?: string; id?: string } | undefined;
  try { fl = (JSON.parse(String(v?.meta ?? "{}")) as Row).firstLook as typeof fl; } catch { fl = undefined; }
  if (!fl?.id) return false;
  if (fl.kind === "collector") {
    return !!(await env.DB.prepare("SELECT 1 AS ok FROM collector_links WHERE studio_id = ? AND id = ? AND revoked_at IS NULL AND deleted_at IS NULL")
      .bind(studioId, fl.id).first());
  }
  if (fl.kind === "follower") {
    return !!(await env.DB.prepare(
      "SELECT 1 AS ok FROM followers WHERE studio_id = ? AND id = ? AND verified_at IS NOT NULL AND unsubscribed_at IS NULL AND deleted_at IS NULL",
    ).bind(studioId, fl.id).first());
  }
  return false;
}

/** The client this email belongs to, if the studio has one. */
async function clientByEmail(ctx: ActionCtx, email: string): Promise<string | null> {
  const r = await ctx.env.DB.prepare("SELECT id FROM clients WHERE studio_id = ? AND deleted_at IS NULL AND lower(email) = ? ORDER BY created_at LIMIT 1")
    .bind(ctx.actor.studioId, email.toLowerCase()).first<{ id: string }>();
  return r?.id ?? null;
}

/** This browser now sees first look through a link or a follow. */
async function grantFirstLook(ctx: ActionCtx, visitorId: string, kind: "collector" | "follower", id: string): Promise<Write[]> {
  const v = await findRecord(ctx.db, visitorEntity, ctx.actor.studioId, visitorId);
  if (!v) return [];
  const meta = (v.meta ?? {}) as Row;
  const had = meta.firstLook as { kind?: string; id?: string } | undefined;
  if (had?.kind === kind && had.id === id) return [];
  return [updateWrite(ctx, visitorEntity, v, { meta: { ...meta, firstLook: { kind, id, at: ctx.now } } })];
}

// ------------------------------------------------------------------ the owner: a collector's link

const ClientRef = z.object({ clientId: Id });

/** Revokes a client's live links and makes a new one. */
async function newLinkWrites(ctx: ActionCtx, clientId: string, invited: boolean): Promise<Write[]> {
  const { results } = await ctx.env.DB.prepare(
    "SELECT id FROM collector_links WHERE studio_id = ? AND client_id = ? AND revoked_at IS NULL AND deleted_at IS NULL",
  ).bind(ctx.actor.studioId, clientId).all<{ id: string }>();
  const writes: Write[] = [];
  for (const r of results) {
    const old = await getRecord(ctx.db, collectorLinkEntity, ctx.actor.studioId, r.id);
    writes.push(updateWrite(ctx, collectorLinkEntity, old, { revokedAt: ctx.now }));
  }
  writes.push(insertWrite(ctx, collectorLinkEntity, { id: newId(), clientId, token: randomToken(18), invitedAt: invited ? ctx.now : null }));
  return writes;
}

export const collectorLink = defineAction({
  name: "collector.link",
  description: "Make a collector's private page link; any link they had stops working",
  input: ClientRef,
  permission: "clients:write",
  risk: "confirm",
  plan: async (ctx, { clientId }) => {
    await getRecord(ctx.db, clientEntity, ctx.actor.studioId, clientId);
    return { writes: await newLinkWrites(ctx, clientId, false) };
  },
  respond: (_c, a) => a.at(-1) as Snapshot,
});

export const collectorInvite = defineAction({
  name: "collector.invite",
  description: "Email a collector the link to their page (their live link, or a new one)",
  input: ClientRef,
  permission: "clients:write",
  risk: "always_confirm",
  // It emails a person: the artist's tap, never the assistant's.
  assistant: "never",
  plan: async (ctx, { clientId }) => {
    const client = await getRecord(ctx.db, clientEntity, ctx.actor.studioId, clientId);
    if (!client.email) throw new HttpError("bad_request", "Add their email first.");
    const live = await liveLink(ctx.env, ctx.actor.studioId, clientId);
    if (!live) return { writes: await newLinkWrites(ctx, clientId, true) };
    const link = await getRecord(ctx.db, collectorLinkEntity, ctx.actor.studioId, live.id as string);
    return { writes: [updateWrite(ctx, collectorLinkEntity, link, { invitedAt: ctx.now })] };
  },
  respond: (_c, a) => a.at(-1) as Snapshot,
});

export const collectorUnlink = defineAction({
  name: "collector.unlink",
  description: "Stop a collector's page link working (no new one is made)",
  input: ClientRef,
  permission: "clients:write",
  risk: "confirm",
  plan: async (ctx, { clientId }) => {
    await getRecord(ctx.db, clientEntity, ctx.actor.studioId, clientId);
    const live = await liveLink(ctx.env, ctx.actor.studioId, clientId);
    if (!live) throw new HttpError("bad_request", "They have no link.");
    const link = await getRecord(ctx.db, collectorLinkEntity, ctx.actor.studioId, live.id as string);
    return { writes: [updateWrite(ctx, collectorLinkEntity, link, { revokedAt: ctx.now })] };
  },
  respond: (_c, a) => a.at(-1) as Snapshot,
});

// ------------------------------------------------------------------ the owner: works

export const artworkSetOwner = defineAction({
  name: "artwork.set_owner",
  description: "Record who owns a work: a sold piece gets its buyer; an unsold one is marked sold to them",
  input: SetOwnerInput.extend({ artworkId: Id, version: z.number().int().min(1).optional() }),
  permission: "artworks:write",
  risk: "confirm",
  plan: async (ctx, { artworkId, clientId, priceCents, version }) => {
    const art = await getRecord(ctx.db, artworkEntity, ctx.actor.studioId, artworkId);
    if (version !== undefined) checkVersion(art, version);
    if (art.kind !== "work") throw new HttpError("bad_request", "Only a work can have an owner.");
    if (clientId) await getRecord(ctx.db, clientEntity, ctx.actor.studioId, clientId);
    const meta = (art.meta ?? {}) as Row;
    const sale = (meta.sale ?? null) as Row | null;
    if (art.status === "sold") {
      return { writes: [updateWrite(ctx, artworkEntity, art, { meta: { ...meta, sale: { ...(sale ?? { soldAt: null, showId: null }), clientId } } })] };
    }
    if (!clientId) throw new HttpError("bad_request", "This work isn't sold, so it has no owner to remove.");
    if (art.status === "reserved") throw new HttpError("version_conflict", "This work is set aside for an order or a hold. Finish or cancel that first.");
    // As Mark sold (D-029): the sale lives on the artwork.
    const cents = priceCents ?? (art.priceCents as number | null) ?? null;
    const { hold: _h, order: _o, ...rest } = meta;
    return {
      writes: [
        updateWrite(ctx, artworkEntity, art, {
          status: "sold",
          meta: { ...rest, sale: { priceCents: cents, currency: art.currency ?? "USD", clientId, showId: null, soldAt: ctx.now } },
        }),
        bumpCatalogue(ctx),
      ],
    };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

export const artworkFirstLook = defineAction({
  name: "artwork.first_look",
  description: "Show a work to collectors and followers first: it reaches the public site at `until` (default: the studio's first-look days from now); null ends first look now",
  input: FirstLookInput.extend({ artworkId: Id, version: z.number().int().min(1).optional() }),
  permission: "artworks:write",
  risk: "confirm",
  plan: async (ctx, { artworkId, until, version }) => {
    const art = await getRecord(ctx.db, artworkEntity, ctx.actor.studioId, artworkId);
    if (version !== undefined) checkVersion(art, version);
    if (art.kind !== "work") throw new HttpError("bad_request", "First look is for works.");
    let when: string | null;
    if (until === null) when = null;
    else if (until) {
      when = new Date(until).toISOString();
      if (when <= ctx.now) throw new HttpError("bad_request", "Pick a time after now.");
    } else {
      const { site } = await (await import("../lib/site-mail")).siteFor(ctx.env, ctx.actor.studioId);
      const days = site.collectors?.firstLookDays ?? DEFAULT_FIRST_LOOK_DAYS;
      when = new Date(Date.parse(ctx.now) + days * 86_400_000).toISOString();
    }
    const meta = (art.meta ?? {}) as Row;
    const { firstLook: _f, ...rest } = meta;
    return {
      writes: [
        updateWrite(ctx, artworkEntity, art, { publicFrom: when, meta: when ? { ...rest, firstLook: { setAt: ctx.now } } : rest }),
        bumpCatalogue(ctx),
      ],
    };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

export const firstLookAnnounce = defineAction({
  name: "first_look.announce",
  description: "Mark the works in first look as announced; studio-api then emails followers and collectors (the artist's tap)",
  input: z.object({}),
  permission: "clients:write",
  risk: "always_confirm",
  assistant: "never",
  plan: async (ctx) => {
    const { results } = await ctx.env.DB.prepare(
      `SELECT id FROM artworks WHERE studio_id = ? AND kind = 'work' AND public = 1 AND deleted_at IS NULL
       AND public_from IS NOT NULL AND public_from > ? AND json_extract(meta, '$.firstLook.announcedAt') IS NULL LIMIT 24`,
    ).bind(ctx.actor.studioId, ctx.now).all<{ id: string }>();
    if (!results.length) throw new HttpError("bad_request", "Nothing new in first look to announce. Publish a work and turn on First look first.");
    const writes: Write[] = [];
    for (const r of results) {
      const art = await getRecord(ctx.db, artworkEntity, ctx.actor.studioId, r.id);
      const meta = (art.meta ?? {}) as Row;
      writes.push(updateWrite(ctx, artworkEntity, art, { meta: { ...meta, firstLook: { ...((meta.firstLook ?? {}) as Row), announcedAt: ctx.now } } }));
    }
    return { writes };
  },
  respond: (_c, a) => a as Snapshot[],
});

// ------------------------------------------------------------------ the owner: commissions (D-168)

export const commissionActions = crudActions(commissionEntity, CommissionInput as never, CommissionPatch as never, {
  about: "A commission for a client, followed through the five stages (surface, layering, color, erosion, finished), with a note per stage.",
  risk: "confirm",
  refs: async (ctx, f) => {
    if (f.clientId) await getRecord(ctx.db, clientEntity, ctx.actor.studioId, f.clientId as string);
  },
});

// ------------------------------------------------------------------ the public site (internal)

export const collectorVisit = defineAction({
  name: "collector.visit",
  description: "A browser opened a collector's page: it sees first look while the link is live",
  input: z.object({ visitorId: Id, linkId: Id }),
  permission: "site:visitor",
  risk: "auto",
  internal: true,
  plan: async (ctx, { visitorId, linkId }) => ({ writes: await grantFirstLook(ctx, visitorId, "collector", linkId) }),
  respond: (_c, a) => (a[0] ?? null) as Snapshot | null,
});

export const followVerify = defineAction({
  name: "follow.verify",
  description: "A visitor proved their email: they follow the studio (and this browser sees first look)",
  input: z.object({ visitorId: Id, email: z.email().max(200), showId: Id.nullable() }),
  permission: "site:visitor",
  risk: "auto",
  internal: true,
  plan: async (ctx, { visitorId, email, showId }) => {
    const addr = email.toLowerCase();
    const show = showId ? await findRecord(ctx.db, showEntity, ctx.actor.studioId, showId) : null;
    const existing = await ctx.env.DB.prepare("SELECT id FROM followers WHERE studio_id = ? AND email = ?").bind(ctx.actor.studioId, addr).first<{ id: string }>();
    const clientId = await clientByEmail(ctx, addr);
    const writes: Write[] = [];
    let id: string;
    if (existing) {
      const f = await getRecord(ctx.db, followerEntity, ctx.actor.studioId, existing.id, { withDeleted: true });
      id = f.id as string;
      writes.push(updateWrite(ctx, followerEntity, f, {
        verifiedAt: (f.verifiedAt as string | null) ?? ctx.now, unsubscribedAt: null, deletedAt: null,
        clientId: (f.clientId as string | null) ?? clientId, showId: (f.showId as string | null) ?? (show ? show.id : null),
      }));
    } else {
      id = newId();
      writes.push(insertWrite(ctx, followerEntity, { id, email: addr, clientId, showId: show ? show.id : null, token: randomToken(18), verifiedAt: ctx.now }));
    }
    writes.push(...(await grantFirstLook(ctx, visitorId, "follower", id)));
    return { writes };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

export const followStop = defineAction({
  name: "follow.stop",
  description: "A follower stopped following: no more emails, and first look ends",
  input: z.object({ followerId: Id }),
  permission: "site:visitor",
  risk: "auto",
  internal: true,
  plan: async (ctx, { followerId }) => {
    const f = await getRecord(ctx.db, followerEntity, ctx.actor.studioId, followerId);
    if (f.unsubscribedAt) return { writes: [] };
    return { writes: [updateWrite(ctx, followerEntity, f, { unsubscribedAt: ctx.now })] };
  },
  respond: (_c, a) => (a[0] ?? null) as Snapshot | null,
});

/** First look ended for some work since the last hour: the public site's caches move on so it shows. */
export const firstLookEnded = defineAction({
  name: "first_look.ended",
  description: "First look ended on a work: public pages pick it up",
  input: z.object({}),
  permission: "artworks:write",
  risk: "auto",
  internal: true,
  plan: async (ctx) => ({ writes: [bumpCatalogue(ctx)] }),
  respond: () => null,
});
