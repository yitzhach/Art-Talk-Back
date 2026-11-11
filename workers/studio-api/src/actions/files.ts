import { AttachRequest, Id, UploadRequest, db as schema, newId } from "@studio/core";
import { and, eq, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { HttpError } from "../lib/errors";
import { signFileLink } from "../lib/signing";
import { bumpCatalogue, fileEntity, getEntity, getRecord, insertWrite, updateWrite } from "./records";
import { type Snapshot, defineAction } from "./runner";

/** R2 key layout (D-018): flat per studio, so a file never moves when it's re-attached. */
export const r2KeyFor = (studioId: string, fileId: string, name: string) =>
  `studios/${studioId}/${fileId}-${name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80)}`;

/** Where a picture's WebP copy at one width lives (D-106): beside the original. */
export const sizeKey = (r2Key: string, width: number) => `${r2Key}@${width}.webp`;

/** The sizes a file was uploaded with (meta.sizes), as declared at upload. */
export const fileSizes = (file: Snapshot): { width: number; size: number }[] => {
  const sizes = (file.meta as { sizes?: unknown } | undefined)?.sizes;
  return Array.isArray(sizes) ? (sizes as { width: number; size: number }[]) : [];
};

const publicFile = (row: Snapshot) => {
  const { r2Key: _k, thumbKey: _t, ...rest } = row;
  return rest;
};

export const fileUpload = defineAction({
  name: "file.upload",
  description: "Start an upload: create a pending file and a signed upload link",
  input: UploadRequest,
  permission: "files:write",
  risk: "auto",
  plan: async (ctx, req) => {
    const id = newId();
    return {
      writes: [insertWrite(ctx, fileEntity, {
        id, r2Key: r2KeyFor(ctx.actor.studioId, id, req.name), name: req.name,
        contentType: req.contentType, size: req.size, kind: req.kind ?? "other", status: "pending",
        ...(req.sizes || req.pixels ? { meta: { ...(req.sizes ? { sizes: req.sizes } : {}), ...(req.pixels ? { pixels: req.pixels } : {}) } } : {}),
      })],
    };
  },
  // Async signing can't happen in respond, so the route adds the link (see routes/files.ts).
  respond: (_c, a) => a[0] as Snapshot,
});

export const fileAttach = defineAction({
  name: "file.attach",
  description: "Confirm an upload landed and link the file to a record",
  input: AttachRequest.extend({ id: Id }),
  permission: "files:write",
  risk: "auto",
  plan: async (ctx, { id, entityType, entityId }) => {
    const file = await getRecord(ctx.db, fileEntity, ctx.actor.studioId, id);
    const target = getEntity(entityType)!;
    await getRecord(ctx.db, target, ctx.actor.studioId, entityId); // 404 if it isn't in this studio
    const object = await ctx.env.FILES.head(file.r2Key as string);
    if (!object) throw new HttpError("version_conflict", "The upload hasn't finished yet");
    for (const s of fileSizes(file)) {
      if (!(await ctx.env.FILES.head(sizeKey(file.r2Key as string, s.width)))) {
        throw new HttpError("version_conflict", `The ${s.width}-pixel copy hasn't finished uploading yet`);
      }
    }
    const changes: Snapshot = { status: "ready", entityType, entityId, size: object.size };
    // A new picture goes after the record's others (a work's cover is chosen by primaryFileId and reorder).
    if (file.entityType !== entityType || file.entityId !== entityId) {
      const t = schema.files;
      const [row] = await ctx.db.select({ last: max(t.position) }).from(t).where(and(
        eq(t.studioId, ctx.actor.studioId), eq(t.entityType, entityType), eq(t.entityId, entityId), isNull(t.deletedAt),
      ));
      changes.position = row?.last == null ? 0 : row.last + 1;
    }
    return { writes: [updateWrite(ctx, fileEntity, file, changes), ...(entityType === "artwork" || file.entityType === "artwork" ? [bumpCatalogue(ctx)] : [])] };
  },
  respond: (_c, a) => publicFile(a[0] as Snapshot),
});

export { publicFile, signFileLink };
export const UploadResponse = z.object({ file: z.record(z.string(), z.unknown()), uploadUrl: z.string(), expiresAt: z.string() });
