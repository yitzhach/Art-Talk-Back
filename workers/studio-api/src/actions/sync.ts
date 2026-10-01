// Offline sync (spec → Online and offline; D-028).
// push: a device's outbox, applied in order through the same actions as the API.
// pull: the current state of everything changed since the device's cursor.
import { isProtectedField } from "@studio/core";
import { drizzle } from "drizzle-orm/d1";
import type { z } from "zod";
import type { SyncOp, SyncOpResult } from "@studio/core";
import type { Actor, Env } from "../env";
import { HttpError } from "../lib/errors";
import { publicFile } from "./files";
import { type EntityDef, findRecord, getEntity, getRecord } from "./records";
import { type ActionDef, type Snapshot, getAction, runAction } from "./runner";

type Op = z.infer<typeof SyncOp>;
type OpResult = z.infer<typeof SyncOpResult>;

/** Actions a device may queue offline. */
const SYNCABLE = new Set([
  "artwork.create", "artwork.update", "artwork.delete",
  "client.create", "client.update", "client.delete",
  "show.create", "show.update", "show.delete",
  "settings.update",
  "show.add_artwork", "show.remove_artwork", "artwork.mark_sold",
]);

/** Record types a device keeps a copy of. */
export const SYNCED_TYPES = ["artwork", "client", "show", "show_artwork", "settings", "file"] as const;

/** Bookkeeping that changes on every write and says nothing about what the user changed. */
const BOOKKEEPING = new Set(["version", "updatedAt"]);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const outward = (e: EntityDef, row: Snapshot) => (e.type === "file" ? publicFile(row) : row);

/** Fields the server changed on a record after `version`, read from the activity log. */
async function fieldsChangedSince(env: Env, studioId: string, e: EntityDef, id: string, version: number) {
  const rows = await env.DB.prepare(
    `SELECT before, after FROM activity_log
      WHERE studio_id = ? AND entity_type = ? AND entity_id = ? AND json_extract(after, '$.version') > ?`,
  ).bind(studioId, e.type, id, version).all<{ before: string | null; after: string | null }>();
  const changed = new Set<string>();
  for (const r of rows.results) {
    if (!r.before || !r.after) continue;
    const before = JSON.parse(r.before) as Snapshot;
    const after = JSON.parse(r.after) as Snapshot;
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!BOOKKEEPING.has(k) && !same(before[k], after[k])) changed.add(k);
    }
  }
  return changed;
}

export async function applyOp(env: Env, actor: Actor, origin: string, op: Op): Promise<OpResult> {
  const run = (name: string, input: unknown) =>
    // Every syncable action responds with a record snapshot.
    runAction<Snapshot>(getAction(name) as ActionDef<z.ZodType, Snapshot>, input, { env, actor, origin, source: "sync", opId: op.opId });

  try {
    if (!SYNCABLE.has(op.action) || !getAction(op.action)) {
      throw new HttpError("bad_request", `${op.action} can't be queued offline`);
    }
    const replay = await env.DB.prepare("SELECT 1 FROM activity_log WHERE studio_id = ? AND op_id = ? LIMIT 1")
      .bind(actor.studioId, op.opId).first();
    const [type, verb] = op.action.split(".") as [string, string];
    const entity = getEntity(type);
    const isRecordVerb = entity && ["create", "update", "delete"].includes(verb);

    if (!isRecordVerb || verb === "create") {
      const input = verb === "create" ? { ...op.input, id: op.entityId } : op.input;
      const { result } = await run(op.action, input);
      return { opId: op.opId, status: replay ? "duplicate" : "applied", record: result };
    }

    const id = type === "settings" ? actor.studioId : op.entityId;
    if (replay) {
      const current = await getRecord(drizzle(env.DB), entity, actor.studioId, id, { withDeleted: true });
      return { opId: op.opId, status: "duplicate", record: outward(entity, current) };
    }
    if (op.baseVersion === null) throw new HttpError("bad_request", "Edits and deletes need baseVersion");
    const current = await getRecord(drizzle(env.DB), entity, actor.studioId, id);

    if (verb === "delete") {
      if (current.version !== op.baseVersion) {
        return { opId: op.opId, status: "conflict", record: outward(entity, current),
          conflicts: [{ field: "deletedAt", serverValue: null, deviceValue: "deleted" }] };
      }
      const { result } = await run(op.action, { id, version: current.version });
      return { opId: op.opId, status: "applied", record: result };
    }

    // update
    const patch = (op.input.patch ?? {}) as Snapshot;
    const versionInput = (p: Snapshot) => (type === "settings" ? { version: current.version, patch: p } : { id, version: current.version, patch: p });
    if (current.version === op.baseVersion) {
      const { result } = await run(op.action, versionInput(patch));
      return { opId: op.opId, status: "applied", record: result };
    }

    const serverChanged = await fieldsChangedSince(env, actor.studioId, entity, id, op.baseVersion);
    const merge: Snapshot = {};
    const conflicts: { field: string; serverValue: unknown; deviceValue: unknown }[] = [];
    for (const [field, value] of Object.entries(patch)) {
      if (same(current[field], value)) continue; // already what the device wants
      if (serverChanged.has(field) || isProtectedField(field)) {
        conflicts.push({ field, serverValue: current[field] ?? null, deviceValue: value });
      } else {
        merge[field] = value;
      }
    }
    let record = current;
    if (Object.keys(merge).length) record = (await run(op.action, versionInput(merge))).result;
    return conflicts.length
      ? { opId: op.opId, status: "conflict", record: outward(entity, record), conflicts }
      : { opId: op.opId, status: "merged", record: outward(entity, record) };
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    return { opId: op.opId, status: "rejected", error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } };
  }
}

export async function pullChanges(env: Env, actor: Actor, since: number, limit: number) {
  const types = SYNCED_TYPES.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT entity_type, entity_id, MAX(seq) AS seq FROM activity_log
      WHERE studio_id = ? AND seq > ? AND entity_type IN (${types})
      GROUP BY entity_type, entity_id ORDER BY seq LIMIT ?`,
  ).bind(actor.studioId, since, ...SYNCED_TYPES, limit + 1).all<{ entity_type: string; entity_id: string; seq: number }>();
  const page = rows.results.slice(0, limit);
  const db = drizzle(env.DB);
  const changes = [];
  for (const r of page) {
    const e = getEntity(r.entity_type)!;
    const row = await findRecord(db, e, actor.studioId, r.entity_id, { withDeleted: true });
    if (row) changes.push({ entityType: r.entity_type, entityId: r.entity_id, record: outward(e, row) });
  }
  return { changes, cursor: String(page.at(-1)?.seq ?? since), hasMore: rows.results.length > limit };
}
