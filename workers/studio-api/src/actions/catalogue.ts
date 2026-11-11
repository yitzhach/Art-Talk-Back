// The catalogue (Site 3.0 stage 1, D-104…D-110): publishing a work, the
// assistant's draft of its words, and the order and alt text of its pictures.
import { DraftResult, FilePatch, FileReorder, Id, PublishRequest, db as schema } from "@studio/core";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { HttpError } from "../lib/errors";
import { artworkEntity, bumpCatalogue, checkVersion, fileEntity, findRecord, getRecord, updateWrite } from "./records";
import { type ActionCtx, type Snapshot, type Write, defineAction } from "./runner";

const VersionedId = { id: Id, version: z.number().int().min(1) };

/** "Heron at Dusk, No. 2" → "heron-at-dusk-no-2". */
export function slugify(title: string): string {
  const s = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return s || "work";
}

/** The first of base, base-2, base-3… no other undeleted work of the studio uses. */
async function freeSlug(ctx: ActionCtx, base: string, artworkId: string): Promise<string> {
  const t = schema.artworks;
  const rows = await ctx.db.select({ slug: t.slug }).from(t)
    .where(and(eq(t.studioId, ctx.actor.studioId), isNull(t.deletedAt), ne(t.id, artworkId)));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** A picture a public page can show: ready, attached to this work, with its web sizes (D-106). */
function checkCover(cover: Snapshot | null, artworkId: string) {
  if (!cover) throw new HttpError("bad_request", "Add a cover picture first");
  if (cover.status !== "ready" || cover.entityType !== "artwork" || cover.entityId !== artworkId) {
    throw new HttpError("bad_request", "The cover picture hasn't finished uploading");
  }
  // Only photos go public, never a receipt or a certificate attached to the work, nor a locked file.
  if (cover.kind !== "photo" || cover.locked) throw new HttpError("bad_request", "The cover must be a photo that isn't locked to the studio");
  const sizes = (cover.meta as { sizes?: unknown[] } | undefined)?.sizes;
  if (!Array.isArray(sizes) || !sizes.length) throw new HttpError("bad_request", "The cover has no web sizes; add the picture again from the studio app");
}

export const artworkPublish = defineAction({
  name: "artwork.publish",
  description: "Approve a work and make it public on the studio's site",
  input: z.object({ ...VersionedId, ...PublishRequest.shape }),
  permission: "artworks:write",
  risk: "confirm",
  // Publishing is the artist's tap in stage 1 (phase-6-site.md).
  assistant: "never",
  plan: async (ctx, { id, version, slug }) => {
    const before = await getRecord(ctx.db, artworkEntity, ctx.actor.studioId, id);
    checkVersion(before, version);
    const coverId = before.primaryFileId as string | null;
    checkCover(coverId ? await findRecord(ctx.db, fileEntity, ctx.actor.studioId, coverId) : null, id);
    const address = slug ?? (before.slug as string | null) ?? await freeSlug(ctx, slugify(before.title as string), id);
    return {
      writes: [
        // Approving is also accepting the assistant's words as they stand (D-104).
        updateWrite(ctx, artworkEntity, before, { public: true, publishedAt: before.publishedAt ?? ctx.now, slug: address, draftedFields: [] }),
        bumpCatalogue(ctx),
      ],
    };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

export const artworkUnpublish = defineAction({
  name: "artwork.unpublish",
  description: "Take a work off the studio's public site (it stays in the catalogue)",
  input: z.object(VersionedId),
  permission: "artworks:write",
  risk: "confirm",
  assistant: "never",
  plan: async (ctx, { id, version }) => {
    const before = await getRecord(ctx.db, artworkEntity, ctx.actor.studioId, id);
    checkVersion(before, version);
    if (!before.public) throw new HttpError("bad_request", "That work isn't public");
    return { writes: [updateWrite(ctx, artworkEntity, before, { public: false }), bumpCatalogue(ctx)] };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * The assistant's draft of a work's words (D-108). Writes a field only while it is
 * empty or still holds an earlier draft: anything the artist wrote stays. Never
 * publishes. Only studio-assistant's draft job runs it (its own route, never a tool).
 */
export const artworkApplyDraft = defineAction({
  name: "artwork.applyDraft",
  description: "Write the assistant's draft of a work's description, tags, collection and alt text",
  input: DraftResult.extend({ id: Id }),
  permission: "artworks:write",
  risk: "auto",
  internal: true,
  plan: async (ctx, { id, usage, altText, ...fields }) => {
    if (ctx.source !== "assistant") throw new HttpError("forbidden", "Only the assistant writes drafts");
    const before = await getRecord(ctx.db, artworkEntity, ctx.actor.studioId, id);
    // A public work's words are what the artist approved; a draft would go live unreviewed (D-104).
    if (before.public) throw new HttpError("bad_request", "This work is public: unpublish it to ask for a new draft");
    const drafted = new Set((before.draftedFields as string[] | undefined) ?? []);
    const open = (field: string, current: unknown) => drafted.has(field) || isEmpty(current);

    const changes: Snapshot = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && open(k, before[k])) { changes[k] = v; drafted.add(k); }
    }
    const writes: Write[] = [];
    const coverId = before.primaryFileId as string | null;
    const cover = coverId ? await findRecord(ctx.db, fileEntity, ctx.actor.studioId, coverId) : null;
    let coverWrite: Write | null = null;
    if (altText && cover && open("altText", cover.altText)) {
      coverWrite = updateWrite(ctx, fileEntity, cover, { altText });
      drafted.add("altText");
    }
    const meta = usage
      ? { ...(before.meta as Snapshot), draft: { model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, at: ctx.now } }
      : before.meta;
    writes.push(updateWrite(ctx, artworkEntity, before, { ...changes, draftedFields: [...drafted], meta }));
    if (coverWrite) writes.push(coverWrite);
    writes.push(bumpCatalogue(ctx));
    return { writes };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

/** If this file is a work's cover and its alt text was the assistant's, the artist's edit makes it theirs. */
async function claimAltText(ctx: ActionCtx, file: Snapshot): Promise<Write[]> {
  if (file.entityType !== "artwork" || !file.entityId) return [];
  const work = await findRecord(ctx.db, artworkEntity, ctx.actor.studioId, file.entityId as string);
  if (!work || work.primaryFileId !== file.id) return [];
  const drafted = (work.draftedFields as string[]) ?? [];
  return drafted.includes("altText") ? [updateWrite(ctx, artworkEntity, work, { draftedFields: drafted.filter((f) => f !== "altText") })] : [];
}

export const fileUpdate = defineAction({
  name: "file.update",
  description: "Change a file's alt text, its place among a record's pictures, or lock it to the studio",
  input: z.object({ ...VersionedId, patch: FilePatch }),
  permission: "files:write",
  risk: "auto",
  plan: async (ctx, { id, version, patch }) => {
    const before = await getRecord(ctx.db, fileEntity, ctx.actor.studioId, id);
    checkVersion(before, version);
    const writes = [updateWrite(ctx, fileEntity, before, patch)];
    if ("altText" in patch && ctx.source !== "assistant") writes.push(...(await claimAltText(ctx, before)));
    if (before.entityType === "artwork") writes.push(bumpCatalogue(ctx));
    return { writes };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

export const fileReorder = defineAction({
  name: "file.reorder",
  description: "Put a work's pictures in a new order; the first becomes its cover",
  input: FileReorder,
  permission: "files:write",
  risk: "auto",
  plan: async (ctx, { entityId, fileIds }) => {
    const work = await getRecord(ctx.db, artworkEntity, ctx.actor.studioId, entityId);
    const t = schema.files;
    const files = (await ctx.db.select().from(t).where(and(
      eq(t.studioId, ctx.actor.studioId), eq(t.entityType, "artwork"), eq(t.entityId, entityId), isNull(t.deletedAt),
    )).orderBy(t.position, t.id)) as Snapshot[];
    const byId = new Map(files.map((f) => [f.id as string, f]));
    if (new Set(fileIds).size !== fileIds.length) throw new HttpError("bad_request", "Each picture once");
    for (const fid of fileIds) if (!byId.has(fid)) throw new HttpError("not_found", "File not found");
    const order = [...fileIds, ...files.map((f) => f.id as string).filter((fid) => !fileIds.includes(fid))];
    const writes: Write[] = [];
    order.forEach((fid, position) => {
      const f = byId.get(fid)!;
      if (f.position !== position) writes.push(updateWrite(ctx, fileEntity, f, { position }));
    });
    if (work.primaryFileId !== fileIds[0]) {
      // The drafted alt text was the old cover's; the new cover's is the artist's.
      const drafted = (work.draftedFields as string[]) ?? [];
      writes.push(updateWrite(ctx, artworkEntity, work, { primaryFileId: fileIds[0], draftedFields: drafted.filter((f) => f !== "altText") }));
    }
    writes.push(bumpCatalogue(ctx));
    return { writes };
  },
  respond: (_c, a) => ({ records: a as Snapshot[] }),
});
