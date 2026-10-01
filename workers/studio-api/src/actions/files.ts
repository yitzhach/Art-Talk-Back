import { AttachRequest, Id, UploadRequest, newId } from "@studio/core";
import { z } from "zod";
import { HttpError } from "../lib/errors";
import { signFileLink } from "../lib/signing";
import { fileEntity, getEntity, getRecord, insertWrite, updateWrite } from "./records";
import { type Snapshot, defineAction } from "./runner";

/** R2 key layout (D-018): flat per studio, so a file never moves when it's re-attached. */
export const r2KeyFor = (studioId: string, fileId: string, name: string) =>
  `studios/${studioId}/${fileId}-${name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80)}`;

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
    return { writes: [updateWrite(ctx, fileEntity, file, { status: "ready", entityType, entityId, size: object.size })] };
  },
  respond: (_c, a) => publicFile(a[0] as Snapshot),
});

export { publicFile, signFileLink };
export const UploadResponse = z.object({ file: z.record(z.string(), z.unknown()), uploadUrl: z.string(), expiresAt: z.string() });
