// Studio Wall's client links (Phase 5 stage 5, D-090…D-095). The owner makes and
// turns off links (`share.create`, `share.revoke`); a client with a link writes
// comments, stars and cards through the internal guest actions below, run by the
// public routes (routes/shares.ts) with a guest actor whose studio is the link's
// (D-092). Each guest action reads the link again and checks what it allows, so a
// link turned off or expired between two requests writes nothing.
import { Id, PinKind, ShareInput, db as schema, newId } from "@studio/core";
import { and, eq, gt, inArray, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import type { Actor, Env } from "../env";
import { hashPassword, hmac, randomToken, sha256 } from "../lib/crypto";
import { HttpError } from "../lib/errors";
import { boardEntity, feedbackEntity, pinEntity } from "./boards";
import { r2KeyFor } from "./files";
import { type EntityDef, checkVersion, defineEntity, fileEntity, getRecord, insertWrite, updateWrite } from "./records";
import { type ActionCtx, type Snapshot, type Write, defineAction } from "./runner";

const APPS = ["studio-wall"] as const;

export const shareEntity: EntityDef = defineEntity({
  type: "share", table: schema.shares, key: schema.shares.id, studio: schema.shares.studioId,
  version: schema.shares.version, deletedAt: schema.shares.deletedAt, perm: "boards",
  defaults: {
    createdBy: null, deletedAt: null, meta: {}, version: 1, actorType: "user",
    expiresAt: null, passwordHash: null, pinIds: null,
  },
});

/** The link's token: derived from its id with the signing key, never stored (D-091). 64 hex characters. */
export const shareToken = (key: string, shareId: string) => hmac(key, `share\n${shareId}`);
export const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;

// Limits carried over from Studio Wall's old Worker (D-093).
export const LIMITS = {
  comment: 2000, name: 60, perHourPerGuest: 60,
  batch: 10, fileBytes: 10 * 1024 * 1024, perDayPerBoard: 100, perDayPerGuest: 25,
  wrongPasswords: 10, lockoutMs: 15 * 60_000, unlockDays: 30,
} as const;

/** What the owner sees of a link (Share in @studio/core): the token again, never the hashes. */
export async function ownerView(env: Env, row: Snapshot) {
  const pinIds = row.pinIds as string[] | null;
  return {
    id: row.id, version: row.version, boardId: row.boardId, token: await shareToken(env.SIGNING_KEY, row.id as string),
    permission: row.permission, createdAt: row.createdAt, expiresAt: row.expiresAt ?? null,
    locked: !!row.passwordHash, pinCount: pinIds ? pinIds.length : null,
  };
}

export interface OpenShare {
  share: Snapshot;
  board: Snapshot;
  /** What the link allows now: a board with comments off makes every link view only. */
  permission: "view" | "comment" | "contribute";
  /** The chosen cards, or null for the whole board. */
  only: Set<string> | null;
}

/** A link that works: not turned off, not expired, its board still there. Anything else is null. */
export async function openShare(ctx: Pick<ActionCtx, "db" | "now">, where: { token?: string; tokenHash?: string; id?: string }): Promise<OpenShare | null> {
  const s = schema.shares;
  const cond = where.id
    ? eq(s.id, where.id)
    : eq(s.tokenHash, where.tokenHash ?? (where.token && TOKEN.test(where.token) ? await sha256(where.token) : "-"));
  const [share] = (await ctx.db.select().from(s).where(and(cond, isNull(s.deletedAt))).limit(1)) as Snapshot[];
  if (!share || (share.expiresAt && (share.expiresAt as string) <= ctx.now)) return null;
  const b = schema.boards;
  const [board] = (await ctx.db.select().from(b).where(and(
    eq(b.id, share.boardId as string), eq(b.studioId, share.studioId as string), isNull(b.deletedAt),
  )).limit(1)) as Snapshot[];
  if (!board) return null;
  const pinIds = share.pinIds as string[] | null;
  return {
    share, board,
    permission: board.commentsEnabled === false ? "view" : share.permission as OpenShare["permission"],
    only: pinIds ? new Set(pinIds) : null,
  };
}

export const inShare = (o: OpenShare, pinId: string | null | undefined) => !o.only || (!!pinId && o.only.has(pinId));

/** The link's live cards, newest first, narrowed to its chosen cards. */
export async function sharedPins(ctx: Pick<ActionCtx, "db">, o: OpenShare) {
  const p = schema.pins;
  const rows = (await ctx.db.select().from(p).where(and(
    eq(p.studioId, o.share.studioId as string), eq(p.boardId, o.board.id as string), isNull(p.deletedAt),
  ))) as Snapshot[];
  return rows.filter((r) => inShare(o, r.id as string))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** A guest: someone with a link, known only by the page's per-browser id (D-092). */
export const guestActor = (studioId: string, guestId: string): Actor => ({
  userId: `guest:${guestId}`, email: "", name: null, sessionId: null, studioId, role: "guest", clientId: null,
});

// ------------------------------------------------------------------ the owner

export const shareCreate = defineAction({
  name: "share.create",
  description: "Make a client link to a board: view, comment, or comment and add cards; optionally a password, an expiry and only chosen cards.",
  input: ShareInput,
  permission: "boards:write",
  risk: "always_confirm",
  // The password would sit in a confirm card (D-095).
  assistant: "never",
  apps: APPS,
  plan: async (ctx, { boardId, permission, expiresDays, password, pinIds }) => {
    await getRecord(ctx.db, boardEntity, ctx.actor.studioId, boardId);
    let only: string[] | null = null;
    if (pinIds) {
      const p = schema.pins, live = new Set<string>(), want = [...new Set(pinIds)];
      for (let i = 0; i < want.length; i += 50) {
        const rows = await ctx.db.select({ id: p.id }).from(p).where(and(
          eq(p.studioId, ctx.actor.studioId), eq(p.boardId, boardId), inArray(p.id, want.slice(i, i + 50)), isNull(p.deletedAt),
        ));
        for (const r of rows) live.add(r.id);
      }
      only = want.filter((id) => live.has(id));
      if (!only.length) throw new HttpError("bad_request", "Those cards aren't on this board in the studio yet. Wait for sync and try again.");
    }
    const id = newId();
    return {
      writes: [insertWrite(ctx, shareEntity, {
        id, boardId, permission, pinIds: only,
        tokenHash: await sha256(await shareToken(ctx.env.SIGNING_KEY, id)),
        expiresAt: expiresDays ? new Date(Date.parse(ctx.now) + expiresDays * 86_400_000).toISOString() : null,
        passwordHash: password ? await hashPassword(password) : null,
      })],
    };
  },
  // The route adds the token (it needs an async HMAC).
  respond: (_c, a) => a[0] as Snapshot,
});

export const shareRevoke = defineAction({
  name: "share.revoke",
  description: "Turn off a client link: anyone using it loses access at once.",
  input: z.object({ id: Id, version: z.number().int().min(1) }),
  permission: "boards:write",
  risk: "always_confirm",
  apps: APPS,
  plan: async (ctx, { id, version }) => {
    const before = await getRecord(ctx.db, shareEntity, ctx.actor.studioId, id);
    checkVersion(before, version);
    return { writes: [updateWrite(ctx, shareEntity, before, { deletedAt: ctx.now })] };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

// ------------------------------------------------------------------ guests (internal: run only by the public routes)

/** The link again, inside the action, with what it must allow. */
async function linkFor(ctx: ActionCtx, shareId: string, need: "comment" | "contribute") {
  const o = await openShare(ctx, { id: shareId });
  if (!o || o.share.studioId !== ctx.actor.studioId) throw new HttpError("not_found", "This link is no longer active.");
  if (need === "contribute" && o.permission !== "contribute") throw new HttpError("forbidden", "This link can’t add cards.");
  if (o.permission === "view") throw new HttpError("forbidden", "This link is view only.");
  return o;
}

/** A live card on the link's board, inside its chosen cards. */
async function cardOn(ctx: ActionCtx, o: OpenShare, pinId: string, missing: string) {
  const p = schema.pins;
  const [pin] = (await ctx.db.select().from(p).where(and(
    eq(p.id, pinId), eq(p.studioId, ctx.actor.studioId), eq(p.boardId, o.board.id as string), isNull(p.deletedAt),
  )).limit(1)) as Snapshot[];
  if (!pin || !inShare(o, pinId)) throw new HttpError("not_found", missing);
  return pin;
}

/** Comments and stars from one browser, an hour at a time. */
async function hourly(ctx: ActionCtx) {
  const f = schema.boardFeedback;
  const [row] = await ctx.db.select({ n: sql<number>`count(*)` }).from(f).where(and(
    eq(f.studioId, ctx.actor.studioId), eq(f.createdBy, ctx.actor.userId),
    gt(f.updatedAt, new Date(Date.parse(ctx.now) - 3_600_000).toISOString()),
  ));
  if ((row?.n ?? 0) >= LIMITS.perHourPerGuest) throw new HttpError("rate_limited", "Too many messages — please wait a little.");
}

const Guest = { shareId: Id, name: z.string().max(LIMITS.name) };
const author = (name: string) => name.trim().slice(0, LIMITS.name) || "Client";

export const guestComment = defineAction({
  name: "share.comment",
  description: "A client's comment through a link, on the board or one of its cards",
  input: z.object({ ...Guest, pinId: Id.nullable(), text: z.string().trim().min(1).max(LIMITS.comment) }),
  permission: "shares:guest",
  risk: "auto",
  internal: true,
  plan: async (ctx, { shareId, pinId, text, name }) => {
    const o = await linkFor(ctx, shareId, "comment");
    if (pinId) await cardOn(ctx, o, pinId, "That image is no longer on this board.");
    await hourly(ctx);
    return {
      writes: [insertWrite(ctx, feedbackEntity, {
        id: newId(), boardId: o.board.id, pinId, text, starred: null, authorName: author(name),
      })],
    };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

export const guestStar = defineAction({
  name: "share.star",
  description: "A client's star on a card through a link (one per browser per card)",
  input: z.object({ ...Guest, pinId: Id, starred: z.boolean() }),
  permission: "shares:guest",
  risk: "auto",
  internal: true,
  plan: async (ctx, { shareId, pinId, starred, name }) => {
    const o = await linkFor(ctx, shareId, "comment");
    await cardOn(ctx, o, pinId, "That image is no longer on this board.");
    await hourly(ctx);
    const f = schema.boardFeedback;
    const [prior] = (await ctx.db.select().from(f).where(and(
      eq(f.studioId, ctx.actor.studioId), eq(f.createdBy, ctx.actor.userId), eq(f.pinId, pinId),
      sql`${f.starred} IS NOT NULL`, isNull(f.deletedAt),
    )).limit(1)) as Snapshot[];
    const fields = { starred, authorName: author(name) };
    return {
      writes: [prior
        ? updateWrite(ctx, feedbackEntity, prior, fields)
        : insertWrite(ctx, feedbackEntity, { id: newId(), boardId: o.board.id, pinId, text: "", ...fields })],
    };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

/** A card a client adds; a picture is already in R2 (routes/shares.ts put it there, stripped). */
const NewCard = z.object({
  id: Id,
  kind: PinKind,
  title: z.string().max(500).nullable(),
  note: z.string().max(4000).nullable(),
  sourceUrl: z.string().max(2000).regex(/^https?:\/\/\S+$/i).nullable(),
  sourceCredit: z.string().max(500).nullable(),
  palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).max(12),
  file: z.object({ id: Id, name: z.string().min(1).max(200), contentType: z.string().max(100), size: z.number().int().min(1) }).nullable(),
});

export const guestAdd = defineAction({
  name: "share.add",
  description: "Cards a client adds through a link: all of them or none",
  input: z.object({ ...Guest, cards: z.array(NewCard).min(1).max(LIMITS.batch) }),
  permission: "shares:guest",
  risk: "auto",
  internal: true,
  plan: async (ctx, { shareId, name, cards }) => {
    const o = await linkFor(ctx, shareId, "contribute");
    const p = schema.pins;
    const [added] = await ctx.db.select({
      n: sql<number>`count(*)`,
      mine: sql<number>`coalesce(sum(${p.createdBy} = ${ctx.actor.userId}), 0)`,
    }).from(p).where(and(
      eq(p.studioId, ctx.actor.studioId), eq(p.boardId, o.board.id as string), like(p.createdBy, "guest:%"),
      gt(p.createdAt, new Date(Date.parse(ctx.now) - 86_400_000).toISOString()),
    ));
    const left = Math.min(LIMITS.perDayPerBoard - Number(added?.n ?? 0), LIMITS.perDayPerGuest - Number(added?.mine ?? 0));
    if (cards.length > left) {
      throw new HttpError("rate_limited", left > 0
        ? `You can add ${left} more today. Choose fewer images.`
        : "That’s the limit for today. Please send more tomorrow.");
    }
    const writes: Write[] = [];
    for (const c of cards) {
      // The file row first: a card's file_id references it.
      if (c.file) {
        writes.push(insertWrite(ctx, fileEntity, {
          id: c.file.id, r2Key: r2KeyFor(ctx.actor.studioId, c.file.id, c.file.name), name: c.file.name,
          contentType: c.file.contentType, size: c.file.size, kind: "photo", status: "ready", entityType: "pin", entityId: c.id,
        }));
      }
      writes.push(insertWrite(ctx, pinEntity, {
        id: c.id, boardId: o.board.id, fileId: c.file?.id ?? null, kind: c.kind, title: c.title, note: c.note,
        sourceUrl: c.sourceUrl, sourceCredit: c.sourceCredit, palette: c.palette, contributorName: author(name),
      }));
    }
    // A link to chosen cards also shows the cards its clients add.
    if (o.only) writes.push(updateWrite(ctx, shareEntity, o.share, { pinIds: [...o.only, ...cards.map((c) => c.id)] }));
    return { writes };
  },
  respond: (_c, a) => ({ pins: a.filter((x) => x && "boardId" in x && "kind" in x) as Snapshot[] }),
});

export const guestRemove = defineAction({
  name: "share.remove",
  description: "A client removes a card they added through a link (soft: the owner can restore it)",
  input: z.object({ shareId: Id, pinId: Id }),
  permission: "shares:guest",
  risk: "auto",
  internal: true,
  plan: async (ctx, { shareId, pinId }) => {
    const o = await linkFor(ctx, shareId, "contribute");
    const pin = await cardOn(ctx, o, pinId, "That card is no longer on this board.");
    if (pin.createdBy !== ctx.actor.userId) throw new HttpError("forbidden", "You can only remove cards you added.");
    return { writes: [updateWrite(ctx, pinEntity, pin, { deletedAt: ctx.now, deletedBy: ctx.actor.userId })] };
  },
  respond: (_c, a) => a[0] as Snapshot,
});


// ------------------------------------------------------------------ password links (D-092: written directly, like sign-in sessions)

const sinceMs = (now: string, ms: number) => new Date(Date.parse(now) - ms).toISOString();

/** Is this browser's unlock cookie good for this link? */
export async function unlocked(env: Env, shareId: string, cookieValue: string | null, now: string) {
  if (!cookieValue || !/^[A-Za-z0-9_-]{16,64}$/.test(cookieValue)) return false;
  return !!(await env.DB.prepare("SELECT 1 FROM share_sessions WHERE id_hash = ? AND share_id = ? AND expires_at > ?")
    .bind(await sha256(cookieValue), shareId, now).first());
}

/** Wrong tries from this address at this link in the last 15 minutes. */
export async function wrongTries(env: Env, shareId: string, ipHash: string, now: string) {
  return (await env.DB.prepare("SELECT count(*) AS n FROM share_attempts WHERE share_id = ? AND ip_hash = ? AND at > ?")
    .bind(shareId, ipHash, sinceMs(now, LIMITS.lockoutMs)).first<{ n: number }>())?.n ?? 0;
}

export async function recordWrongTry(env: Env, shareId: string, ipHash: string, now: string) {
  await env.DB.prepare("INSERT INTO share_attempts (share_id, ip_hash, at) VALUES (?, ?, ?)").bind(shareId, ipHash, now).run();
}

/** A browser typed the right password: a session for this link, until it expires or 30 days. Returns the cookie value. */
export async function startUnlock(env: Env, share: Snapshot, now: string) {
  const id = randomToken(24);
  const until = Math.min(Date.parse(now) + LIMITS.unlockDays * 86_400_000,
    share.expiresAt ? Date.parse(share.expiresAt as string) : Infinity);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO share_sessions (id_hash, share_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256(id), share.id, now, new Date(until).toISOString()),
    // Old rows go while we're here: expired unlocks, and tries older than a day.
    env.DB.prepare("DELETE FROM share_sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM share_attempts WHERE at < ?").bind(sinceMs(now, 86_400_000)),
  ]);
  return { id, maxAge: Math.max(1, Math.floor((until - Date.parse(now)) / 1000)) };
}
