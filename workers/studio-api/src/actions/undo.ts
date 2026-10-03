// Undo (D-007, D-027): write NEW changes that restore the logged `before`,
// logged with undo_of, and mark the originals undone. An entry that belongs to
// a multi-record action undoes the whole group. Refused if any record changed
// since, so a later edit is never silently overwritten.
import { Id } from "@studio/core";
import { z } from "zod";
import { HttpError, notFound } from "../lib/errors";
import { getEntity, getRecord, updateWrite } from "./records";
import { type Snapshot, type Write, defineAction, rawSql } from "./runner";

/** Fields an undo leaves alone; identity and bookkeeping stay as they are. */
const KEEP = new Set(["id", "studioId", "createdAt", "createdBy", "actorType", "version", "updatedAt"]);

interface Entry {
  id: string; entity_type: string; entity_id: string; before: string | null; after: string | null;
  undone_at: string | null; job_id: string | null;
}

export const undoAction = defineAction({
  name: "activity.undo",
  description: "Undo one logged change, or every change of the action it belongs to",
  input: z.object({ id: Id }),
  permission: "activity:undo",
  // A person's Undo tap runs at once; the assistant undoing on its own asks first.
  risk: "confirm",
  plan: async (ctx, { id }) => {
    const cols = "id, entity_type, entity_id, before, after, undone_at, job_id";
    const first = await ctx.env.DB.prepare(`SELECT ${cols} FROM activity_log WHERE id = ? AND studio_id = ?`)
      .bind(id, ctx.actor.studioId).first<Entry>();
    if (!first) throw notFound("Activity");
    const entries = first.job_id
      ? (await ctx.env.DB.prepare(`SELECT ${cols} FROM activity_log WHERE job_id = ? AND studio_id = ? ORDER BY seq DESC`)
          .bind(first.job_id, ctx.actor.studioId).all<Entry>()).results
      : [first];

    const writes: Write[] = [];
    for (const entry of entries) {
      if (entry.undone_at) throw new HttpError("version_conflict", "Already undone");
      const entity = getEntity(entry.entity_type);
      if (!entity || !entry.after) throw new HttpError("bad_request", "This change can't be undone");

      const current = await getRecord(ctx.db, entity, ctx.actor.studioId, entry.entity_id, { withDeleted: true });
      if (current.version !== (JSON.parse(entry.after) as Snapshot).version) {
        throw new HttpError("version_conflict", "This record changed after that edit; undo the later change first", {
          current: { entityType: entry.entity_type, entityId: entry.entity_id, version: current.version },
        });
      }
      const before = entry.before ? (JSON.parse(entry.before) as Snapshot) : null;
      // Undoing a create = soft-delete it.
      const restore = before ? Object.fromEntries(Object.entries(before).filter(([k]) => !KEEP.has(k))) : { deletedAt: ctx.now };
      const w = updateWrite(ctx, entity, current, restore);
      w.log!.undoOf = entry.id;
      writes.push(w, {
        query: rawSql("UPDATE activity_log SET undone_at = ? WHERE id = ? AND undone_at IS NULL", ctx.now, entry.id),
        expectOne: true,
      });
    }
    return { writes };
  },
  respond: (_c, afters) => ({ record: afters[0] as Snapshot, records: afters as Snapshot[] }),
});
