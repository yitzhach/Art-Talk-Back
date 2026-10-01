// Show actions: what went to a show and what sold there.
import { Id, MarkSoldInput, db as schema, newId } from "@studio/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../env";
import { HttpError } from "../lib/errors";
import {
  artworkEntity, checkVersion, clientEntity, getRecord, insertWrite, showArtworkEntity, showEntity, updateWrite,
} from "./records";
import { type Snapshot, type Write, defineAction } from "./runner";

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
    return { writes: [insertWrite(ctx, showArtworkEntity, { id: newId(), showId, artworkId, currency: art.currency })] };
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
    return { writes: [updateWrite(ctx, showArtworkEntity, row, { deletedAt: ctx.now })] };
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
