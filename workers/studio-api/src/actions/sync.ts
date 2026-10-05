// Offline sync (spec → Online and offline; D-028).
// push: a device's outbox, applied in order through the same actions as the API.
// pull: the current state of everything changed since the device's cursor.
import { isProtectedField } from "@studio/core";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { z } from "zod";
import type { SyncOp, SyncOpResult } from "@studio/core";
import type { Actor, Env } from "../env";
import { HttpError } from "../lib/errors";
import { publicFile } from "./files";
import { type EntityDef, getEntity, getRecord, keyProp } from "./records";
import { type ActionDef, type Snapshot, getAction, runAction } from "./runner";

type Op = z.infer<typeof SyncOp>;
type OpResult = z.infer<typeof SyncOpResult>;

/** Actions a device may queue offline. */
const SYNCABLE = new Set([
  "artwork.create", "artwork.update", "artwork.delete", "artwork.restore",
  "client.create", "client.update", "client.delete", "client.restore",
  "show.create", "show.update", "show.delete", "show.restore",
  "sale.create", "sale.update", "sale.delete", "sale.restore",
  "placement.create", "placement.update", "placement.delete", "placement.restore",
  "settings.update",
  "show.add_artwork", "show.remove_artwork", "artwork.mark_sold",
]);

/** Record types a device keeps a copy of. */
export const SYNCED_TYPES = ["artwork", "client", "show", "show_artwork", "sale", "settings", "file", "placement"] as const;

/** Ids per query when pull reads records back (D1 allows 100 bound parameters). */
const PULL_CHUNK = 50;

/**
 * Where a pull page ends early because of placements (D-065): each can carry
 * a scene of up to PLACEMENT_SCENE_MAX, so 200 of them would be ~140 MB.
 */
export const PULL_PAGE_BYTES = 8_000_000;

/** Bookkeeping that changes on every write and says nothing about what the user changed. */
const BOOKKEEPING = new Set(["version", "updatedAt"]);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isObject = (v: unknown): v is Snapshot => !!v && typeof v === "object" && !Array.isArray(v);
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
    // meta merges per key (D-036), so record which of its keys moved too.
    const bm = isObject(before.meta) ? before.meta : {};
    const am = isObject(after.meta) ? after.meta : {};
    for (const k of new Set([...Object.keys(bm), ...Object.keys(am)])) {
      if (!same(bm[k], am[k])) changed.add(`meta.${k}`);
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
    const [type, verb] = op.action.split(".") as [string, string];
    const entity = getEntity(type);
    const isRecordVerb = entity && ["create", "update", "delete"].includes(verb);

    if (!isRecordVerb || verb === "create") {
      const input = verb === "create" ? { ...op.input, id: op.entityId } : op.input;
      const { result, replayed } = await run(op.action, input);
      return { opId: op.opId, status: replayed ? "duplicate" : "applied", record: result };
    }

    // Edits and deletes check for a repeat first: the merge below must not run twice.
    const replay = await env.DB.prepare("SELECT 1 FROM activity_log WHERE studio_id = ? AND op_id = ? LIMIT 1")
      .bind(actor.studioId, op.opId).first();
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

    // update. A device's `meta` is the keys it changed, laid over the stored meta (D-036).
    const patch = { ...(op.input.patch ?? {}) } as Snapshot;
    const currentMeta = isObject(current.meta) ? current.meta : {};
    const versionInput = (p: Snapshot) => (type === "settings" ? { version: current.version, patch: p } : { id, version: current.version, patch: p });
    if (current.version === op.baseVersion) {
      if (isObject(patch.meta)) patch.meta = { ...currentMeta, ...patch.meta };
      const { result } = await run(op.action, versionInput(patch));
      return { opId: op.opId, status: "applied", record: result };
    }

    const serverChanged = await fieldsChangedSince(env, actor.studioId, entity, id, op.baseVersion);
    const merge: Snapshot = {};
    const conflicts: { field: string; serverValue: unknown; deviceValue: unknown }[] = [];
    for (const [field, value] of Object.entries(patch)) {
      if (field === "meta" && isObject(value)) {
        // Same rules as fields, one meta key at a time; `*Cents` keys never auto-merge.
        const metaMerge: Snapshot = {};
        for (const [k, v] of Object.entries(value)) {
          if (same(currentMeta[k], v)) continue;
          if (serverChanged.has(`meta.${k}`) || isProtectedField(k)) {
            conflicts.push({ field: `meta.${k}`, serverValue: currentMeta[k] ?? null, deviceValue: v });
          } else {
            metaMerge[k] = v;
          }
        }
        if (Object.keys(metaMerge).length) merge.meta = { ...currentMeta, ...metaMerge };
        continue;
      }
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
  let page = rows.results.slice(0, limit);
  let more = rows.results.length > limit;

  // Placements are measured before they're read, and the page ends once it
  // passes PULL_PAGE_BYTES (always keeping at least one change), D-065.
  const placementIds = page.filter((r) => r.entity_type === "placement").map((r) => r.entity_id);
  if (placementIds.length) {
    const bytes = new Map<string, number>();
    for (let i = 0; i < placementIds.length; i += PULL_CHUNK) {
      const ids = placementIds.slice(i, i + PULL_CHUNK);
      const sized = await env.DB.prepare(
        `SELECT id, length(scene) + length(images) + length(meta) AS bytes FROM placements
          WHERE studio_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
      ).bind(actor.studioId, ...ids).all<{ id: string; bytes: number }>();
      for (const r of sized.results) bytes.set(r.id, r.bytes);
    }
    let total = 0;
    for (let i = 0; i < page.length; i++) {
      const r = page[i]!;
      if (r.entity_type !== "placement") continue;
      total += bytes.get(r.entity_id) ?? 0;
      if (total > PULL_PAGE_BYTES && i > 0) {
        page = page.slice(0, i);
        more = true;
        break;
      }
    }
  }

  // One query per record type (in chunks), not one per record: a Worker on the
  // free plan may run 50 D1 queries per request (D-050).
  const db = drizzle(env.DB);
  const found = new Map<string, Snapshot>();
  const idsByType = new Map<string, string[]>();
  for (const r of page) idsByType.set(r.entity_type, [...(idsByType.get(r.entity_type) ?? []), r.entity_id]);
  for (const [type, ids] of idsByType) {
    const e = getEntity(type)!;
    for (let i = 0; i < ids.length; i += PULL_CHUNK) {
      const rows = await db.select().from(e.table)
        .where(and(eq(e.studio, actor.studioId), inArray(e.key, ids.slice(i, i + PULL_CHUNK))));
      for (const row of rows as Snapshot[]) found.set(`${type}:${row[keyProp(e)] as string}`, row);
    }
  }
  const changes = [];
  for (const r of page) {
    const row = found.get(`${r.entity_type}:${r.entity_id}`);
    if (row) changes.push({ entityType: r.entity_type, entityId: r.entity_id, record: outward(getEntity(r.entity_type)!, row) });
  }
  return { changes, cursor: String(page.at(-1)?.seq ?? since), hasMore: more };
}
