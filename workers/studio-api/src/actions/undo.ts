// Undo (D-007): write a NEW change that restores the logged `before`, logged
// with undo_of, and mark the original undone. Refused if the record changed
// since, so a later edit is never silently overwritten.
import { Id } from "@studio/core";
import { z } from "zod";
import { HttpError, notFound } from "../lib/errors";
import { getEntity, getRecord, updateWrite } from "./records";
import { type Snapshot, defineAction, rawSql } from "./runner";

/** Fields an undo writes back; identity and bookkeeping stay as they are. */
const KEEP = new Set(["id", "studioId", "createdAt", "createdBy", "actorType", "version", "updatedAt"]);

export const undoAction = defineAction({
  name: "activity.undo",
  description: "Undo one logged change",
  input: z.object({ id: Id }),
  permission: "activity:undo",
  risk: "auto",
  plan: async (ctx, { id }) => {
    const entry = await ctx.env.DB.prepare(
      "SELECT id, entity_type, entity_id, before, after, undone_at FROM activity_log WHERE id = ? AND studio_id = ?",
    ).bind(id, ctx.actor.studioId).first<{
      id: string; entity_type: string; entity_id: string; before: string | null; after: string | null; undone_at: string | null;
    }>();
    if (!entry) throw notFound("Activity");
    if (entry.undone_at) throw new HttpError("version_conflict", "Already undone");
    const entity = getEntity(entry.entity_type);
    if (!entity || !entry.after) throw new HttpError("bad_request", "This change can't be undone");

    const current = await getRecord(ctx.db, entity, ctx.actor.studioId, entry.entity_id, { withDeleted: true });
    const loggedAfter = JSON.parse(entry.after) as Snapshot;
    if (current.version !== loggedAfter.version) {
      throw new HttpError("version_conflict", "This record changed after that edit; undo the later change first", {
        current: { version: current.version },
      });
    }

    const before = entry.before ? (JSON.parse(entry.before) as Snapshot) : null;
    // Undoing a create = soft-delete it.
    const restore = before
      ? Object.fromEntries(Object.entries(before).filter(([k]) => !KEEP.has(k)))
      : { deletedAt: ctx.now };

    const restoreWrite = updateWrite(ctx, entity, current, restore);
    restoreWrite.log!.undoOf = entry.id;
    return {
      writes: [
        restoreWrite,
        {
          query: rawSql("UPDATE activity_log SET undone_at = ? WHERE id = ? AND undone_at IS NULL", ctx.now, entry.id),
          expectOne: true,
        },
      ],
    };
  },
  respond: (_c, afters) => ({ record: afters[0] as Snapshot }),
});

