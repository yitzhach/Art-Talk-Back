// The tool registry and the one path every write takes:
//   validate → check permission → plan (reads) → write + activity_log in ONE D1 batch.
//
// A planned write that must change exactly one row (an update guarded by
// `version = ?`) is followed by an assertion statement. If the row didn't
// change, the assertion inserts a row with a NULL id into activity_log, which
// violates NOT NULL and rolls the whole batch back — so a stale write never
// half-applies and never gets logged.
import { newId } from "@studio/core";
import { drizzle } from "drizzle-orm/d1";
import type { z } from "zod";
import { type Permission, requirePermission } from "../auth/permissions";
import type { Actor, Db, Env, Source } from "../env";
import { HttpError, versionConflict } from "../lib/errors";
import { nowIso } from "../lib/time";

export type Snapshot = Record<string, unknown>;

export interface ActionCtx {
  env: Env;
  db: Db;
  actor: Actor;
  source: Source;
  now: string;
  /** Origin of the current request, for building links (file URLs). */
  origin: string;
}

/** One row-level change and the log entry that records it. */
export interface Write {
  query: { toSQL(): { sql: string; params: unknown[] } } | { sql: string; params: unknown[] };
  /** true → the batch aborts with 409 unless exactly one row changed. */
  expectOne: boolean;
  log?: {
    entityType: string;
    entityId: string;
    before: Snapshot | null;
    after: Snapshot | null;
    undoOf?: string;
  };
}

export interface Plan {
  writes: Write[];
}

export interface ActionDef<I extends z.ZodType = z.ZodType, R = unknown> {
  name: string;
  description: string;
  input: I;
  permission: Permission;
  risk: "auto" | "confirm" | "always_confirm";
  plan: (ctx: ActionCtx, input: z.output<I>) => Promise<Plan>;
  /**
   * Builds the response from the logged `after` snapshots, in write order.
   * The same function answers a repeated Idempotency-Key (D-017), so a repeat
   * returns what the first call returned without writing again.
   */
  respond: (ctx: ActionCtx, afters: (Snapshot | null)[]) => R;
}

const registry = new Map<string, ActionDef>();

export function defineAction<I extends z.ZodType, R>(def: ActionDef<I, R>): ActionDef<I, R> {
  if (registry.has(def.name)) throw new Error(`Action ${def.name} defined twice`);
  registry.set(def.name, def as unknown as ActionDef);
  return def;
}

export const getAction = (name: string) => registry.get(name);
export const listActions = () => [...registry.values()];

export interface RunResult<R> {
  result: R;
  activityIds: string[];
  replayed: boolean;
}

export interface RunOptions {
  env: Env;
  actor: Actor;
  origin: string;
  source?: Source;
  opId?: string | null;
}

export async function runAction<R>(def: ActionDef<z.ZodType, R>, rawInput: unknown, opts: RunOptions): Promise<RunResult<R>> {
  const parsed = def.input.safeParse(rawInput);
  if (!parsed.success) {
    throw new HttpError("bad_request", "Invalid input", { issues: parsed.error.issues });
  }
  requirePermission(opts.actor.role, def.permission);

  const ctx: ActionCtx = {
    env: opts.env,
    db: drizzle(opts.env.DB),
    actor: opts.actor,
    source: opts.source ?? "app",
    now: nowIso(),
    origin: opts.origin,
  };
  const opId = opts.opId ?? null;

  if (opId) {
    const replay = await findReplay(ctx, def, opId);
    if (replay) return replay;
  }

  const plan = await def.plan(ctx, parsed.data);
  const statements: D1PreparedStatement[] = [];
  const activityIds: string[] = [];
  const afters: (Snapshot | null)[] = [];

  for (const w of plan.writes) {
    const q = "toSQL" in w.query ? w.query.toSQL() : w.query;
    statements.push(opts.env.DB.prepare(q.sql).bind(...q.params));
    if (w.expectOne) statements.push(assertOneChanged(opts.env.DB));
    if (w.log) {
      const id = newId();
      activityIds.push(id);
      afters.push(w.log.after);
      statements.push(
        opts.env.DB.prepare(
          `INSERT INTO activity_log (id, studio_id, actor_id, actor_type, source, action, entity_type,
             entity_id, before, after, op_id, undo_of, created_at)
           VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id, ctx.actor.studioId, ctx.actor.userId, ctx.source, def.name, w.log.entityType, w.log.entityId,
          w.log.before ? JSON.stringify(w.log.before) : null,
          w.log.after ? JSON.stringify(w.log.after) : null,
          opId, w.log.undoOf ?? null, ctx.now,
        ),
      );
    }
  }

  try {
    if (statements.length) await opts.env.DB.batch(statements);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("NOT NULL constraint failed: activity_log.id")) throw versionConflict();
    if (opId && msg.includes("UNIQUE constraint failed: activity_log.studio_id, activity_log.op_id")) {
      // Lost a race with the same op: answer from what the winner logged.
      const replay = await findReplay(ctx, def, opId);
      if (replay) return replay;
    }
    const unique = /UNIQUE constraint failed: (\w+)\.(\w+)/.exec(msg);
    if (unique) throw new HttpError("bad_request", `That ${unique[2]} is already in use`, { field: unique[2] });
    throw err;
  }

  return { result: def.respond(ctx, afters), activityIds, replayed: false };
}

/** Inserts an invalid row (and so aborts the batch) unless the previous statement changed exactly one row. */
function assertOneChanged(db: D1Database): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO activity_log (id, studio_id, actor_type, source, action, entity_type, entity_id, created_at)
     SELECT NULL, '', 'system', 'system', 'assert', '', '', '' WHERE changes() <> 1`,
  );
}

async function findReplay<R>(ctx: ActionCtx, def: ActionDef<z.ZodType, R>, opId: string): Promise<RunResult<R> | null> {
  const rows = await ctx.env.DB.prepare(
    "SELECT id, action, after FROM activity_log WHERE studio_id = ? AND op_id = ? ORDER BY seq",
  ).bind(ctx.actor.studioId, opId).all<{ id: string; action: string; after: string | null }>();
  if (!rows.results.length) return null;
  if (rows.results[0]!.action !== def.name) {
    throw new HttpError("bad_request", "This Idempotency-Key was already used for a different action");
  }
  const afters = rows.results.map((r) => (r.after ? (JSON.parse(r.after) as Snapshot) : null));
  return { result: def.respond(ctx, afters), activityIds: rows.results.map((r) => r.id), replayed: true };
}

/** Raw SQL for a Write, when the query builder can't express it. */
export const rawSql = (sql: string, ...params: unknown[]) => ({ sql, params });

