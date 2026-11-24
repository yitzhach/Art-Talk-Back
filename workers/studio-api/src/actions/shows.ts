// Show actions: what went to a show and what sold there.
import { Id, MarkSoldInput, ShowPage, ShowPageInput, db as schema, newId } from "@studio/core";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../env";
import { HttpError } from "../lib/errors";
import {
  artworkEntity, bumpCatalogue, checkVersion, clientEntity, getRecord, insertWrite, showArtworkEntity, showEntity, updateWrite,
} from "./records";
import { type ActionCtx, type Snapshot, type Write, defineAction } from "./runner";

/** The live (not removed) row for an artwork at a show, if any. */
async function findShowArtwork(db: Db, studioId: string, showId: string, artworkId: string) {
  const t = schema.showArtworks;
  const rows = await db.select().from(t).where(and(
    eq(t.studioId, studioId), eq(t.showId, showId), eq(t.artworkId, artworkId), isNull(t.deletedAt),
  )).limit(1);
  return (rows[0] as Snapshot | undefined) ?? null;
}

const ShowArtworkRef = z.object({ showId: Id, artworkId: Id }).strict();

export const addArtworkToShow = defineAction({
  name: "show.add_artwork",
  description: "Record that an artwork went to a show",
  input: ShowArtworkRef,
  permission: "shows:write",
  risk: "auto",
  plan: async (ctx, { showId, artworkId }) => {
    await getRecord(ctx.db, showEntity, ctx.actor.studioId, showId);
    const art = await getRecord(ctx.db, artworkEntity, ctx.actor.studioId, artworkId);
    if (await findShowArtwork(ctx.db, ctx.actor.studioId, showId, artworkId)) {
      throw new HttpError("bad_request", "That artwork is already at this show");
    }
    return { writes: [insertWrite(ctx, showArtworkEntity, { id: newId(), showId, artworkId, currency: art.currency }), bumpCatalogue(ctx)] };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

export const removeArtworkFromShow = defineAction({
  name: "show.remove_artwork",
  description: "Take an artwork off a show's list (not for sold work: undo the sale instead)",
  input: ShowArtworkRef,
  permission: "shows:write",
  risk: "auto",
  plan: async (ctx, { showId, artworkId }) => {
    const row = await findShowArtwork(ctx.db, ctx.actor.studioId, showId, artworkId);
    if (!row) throw new HttpError("not_found", "That artwork isn't at this show");
    if (row.outcome === "sold") throw new HttpError("version_conflict", "It sold at this show; undo the sale instead");
    return { writes: [updateWrite(ctx, showArtworkEntity, row, { deletedAt: ctx.now }), bumpCatalogue(ctx)] };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

export const markSold = defineAction({
  name: "artwork.mark_sold",
  description: "Mark an artwork sold, optionally at a show and to a client",
  input: MarkSoldInput,
  permission: "artworks:write",
  risk: "confirm",
  plan: async (ctx, { artworkId, priceCents, currency, showId, clientId, version }) => {
    const art = await getRecord(ctx.db, artworkEntity, ctx.actor.studioId, artworkId);
    if (version !== undefined) checkVersion(art, version);
    if (art.status === "sold") throw new HttpError("version_conflict", "This artwork is already marked sold");
    if (clientId) await getRecord(ctx.db, clientEntity, ctx.actor.studioId, clientId);
    const cur = currency ?? (art.currency as string);

    // Until Phase 4's transactions table, the sale itself lives on the artwork (D-029).
    const saleMeta = { ...(art.meta as Snapshot), sale: { priceCents, currency: cur, clientId: clientId ?? null, showId: showId ?? null, soldAt: ctx.now } };
    const writes: Write[] = [updateWrite(ctx, artworkEntity, art, { status: "sold", meta: saleMeta })];
    if (showId) {
      await getRecord(ctx.db, showEntity, ctx.actor.studioId, showId);
      const sale = { outcome: "sold", soldPriceCents: priceCents, currency: cur, clientId: clientId ?? null, soldAt: ctx.now };
      const row = await findShowArtwork(ctx.db, ctx.actor.studioId, showId, artworkId);
      writes.push(row
        ? updateWrite(ctx, showArtworkEntity, row, sale)
        : insertWrite(ctx, showArtworkEntity, { id: newId(), showId, artworkId, ...sale }));
    }
    return { writes };
  },
  respond: (_c, a) => ({ artwork: a[0] as Snapshot, showArtwork: (a[1] as Snapshot | undefined) ?? null }),
});

// ------------------------------------------------------------------ the show's site page (D-182)

/** "Red Dot Miami" starting 2026-12-02 → "red-dot-miami-2026". */
export function showSlug(name: string, startsOn: string | null): string {
  const base = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "show";
  const year = startsOn?.slice(0, 4);
  return year && /^\d{4}$/.test(year) && !base.endsWith(year) ? `${base}-${year}` : base;
}

/** The slugs other live shows of the studio use for their pages. */
async function takenShowSlugs(ctx: ActionCtx, showId: string) {
  const t = schema.shows;
  const rows = await ctx.db.select({ meta: t.meta }).from(t)
    .where(and(eq(t.studioId, ctx.actor.studioId), isNull(t.deletedAt), ne(t.id, showId)));
  return new Set(rows.map((r) => ((r.meta ?? {}) as { publicPage?: { slug?: string } }).publicPage?.slug).filter(Boolean));
}

export const setShowPage = defineAction({
  name: "show.set_page",
  description: "Set a show's page on the studio's site: whether it is published, its address, words and photos",
  input: ShowPageInput,
  permission: "shows:write",
  risk: "confirm",
  // What the public site says is the artist's to change, like publishing a work (D-110).
  assistant: "never",
  plan: async (ctx, { showId, version, ...change }) => {
    const before = await getRecord(ctx.db, showEntity, ctx.actor.studioId, showId);
    checkVersion(before, version);
    const meta = (before.meta ?? {}) as Snapshot;
    const old = ShowPage.safeParse(meta.publicPage);
    const page = {
      published: change.published ?? (old.success ? old.data.published : false),
      slug: change.slug ?? (old.success ? old.data.slug : showSlug(before.name as string, before.startsOn as string | null)),
      description: change.description !== undefined ? change.description : (old.success ? old.data.description : null),
      photos: change.photos ?? (old.success ? old.data.photos : []),
    };
    if ((await takenShowSlugs(ctx, showId)).has(page.slug)) {
      throw new HttpError("bad_request", "Another show's page already uses that address", { field: "slug" });
    }
    const photos = [...new Set(page.photos)];
    if (photos.length) {
      const t = schema.artworks;
      const found = await ctx.db.select({ id: t.id }).from(t)
        .where(and(eq(t.studioId, ctx.actor.studioId), isNull(t.deletedAt), inArray(t.id, photos)));
      if (found.length !== photos.length) throw new HttpError("bad_request", "A photo isn't one of this studio's", { field: "photos" });
    }
    const publicPage = ShowPage.parse({ ...page, photos });
    return { writes: [updateWrite(ctx, showEntity, before, { meta: { ...meta, publicPage } }), bumpCatalogue(ctx)] };
  },
  respond: (_c, a) => a[0] as Snapshot,
});
