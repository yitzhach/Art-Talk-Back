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

export type Risk = "auto" | "confirm" | "always_confirm";
export type Level = Risk | "never";

export interface ActionDef<I extends z.ZodType = z.ZodType, R = unknown> {
  name: string;
  description: string;
  input: I;
  permission: Permission;
  /** How much the assistant may do with this on its own (spec → Autonomy levels). People are never asked. */
  risk: Risk;
  /** "never": the assistant can't run this at all, whatever the studio sets (e.g. changing its own policy). */
  assistant?: "never";
  /** Apps whose assistant gets this as a tool (D-052). Absent: only the general "studio" assistant. */
  apps?: readonly string[];
  /** Plumbing run only by studio-api's own routes: never a tool, never run by name. */
  internal?: true;
  /**
   * The confirm card's lines after "Action", when the generic field lines
   * would say nothing useful (a booth edit is a list of ops). Throws like
   * plan would, so a card that can't be done is never made.
   */
  card?: (ctx: ActionCtx, input: z.output<I>) => Promise<{ label: string; value: string }[]>;
  /** The tool's JSON Schema, when it is authored elsewhere than `input` (D-070: Booth Studio's ops). */
  toolSchema?: Record<string, unknown>;
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
  /** The person tapped this action's confirm card (pending actions, D-045). */
  confirmed?: boolean;
}

const RANK: Record<Level, number> = { auto: 0, confirm: 1, always_confirm: 2, never: 3 };

/** Does this input set a money amount (a `*Cents` field, at the top, in a patch, or in meta)? */
function touchesMoney(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  return Object.entries(input as Record<string, unknown>).some(([k, v]) =>
    /Cents$/.test(k) || ((k === "patch" || k === "meta") && touchesMoney(v)));
}

/**
 * The level that applies when the assistant runs `def` with `input` (D-045):
 * the studio's choice if it set one, else the registry's. A studio may lower
 * `confirm` to `auto` or raise anything, but `always_confirm` never goes below
 * itself; `never` is always allowed. Setting a money amount is at least `confirm`.
 */
export function assistantLevel(def: ActionDef, studioLevel: Level | null, input?: unknown): Level {
  if (def.assistant === "never") return "never";
  let level: Level = studioLevel ?? def.risk;
  if (def.risk === "always_confirm" && level !== "never") level = "always_confirm";
  if (level === "auto" && touchesMoney(input)) level = "confirm";
  return level;
}

/** Levels a studio may choose for an action. */
export function allowedLevels(def: ActionDef): Level[] {
  if (def.assistant === "never") return ["never"];
  return def.risk === "always_confirm" ? ["always_confirm", "never"] : ["auto", "confirm", "always_confirm", "never"];
}

export async function studioLevel(env: Env, studioId: string, action: string): Promise<Level | null> {
  const row = await env.DB.prepare(
    "SELECT level FROM assistant_policy WHERE studio_id = ? AND action = ? AND deleted_at IS NULL",
  ).bind(studioId, action).first<{ level: Level }>();
  return row?.level ?? null;
}

export const rankOf = (l: Level) => RANK[l];

export async function runAction<R>(def: ActionDef<z.ZodType, R>, rawInput: unknown, opts: RunOptions): Promise<RunResult<R>> {
  const parsed = def.input.safeParse(rawInput);
  if (!parsed.success) {
    throw new HttpError("bad_request", "Invalid input", { issues: parsed.error.issues });
  }
  requirePermission(opts.actor.role, def.permission);

  // The assistant's limits live here, on the data side, never in its prompt (D-045).
  if (opts.source === "assistant") {
    const level = assistantLevel(def, await studioLevel(opts.env, opts.actor.studioId, def.name), parsed.data);
    if (level === "never") {
      throw new HttpError("forbidden", `The assistant isn't allowed to ${def.description.toLowerCase()} in this studio`, { action: def.name });
    }
    if (level !== "auto" && !opts.confirmed) {
      throw new HttpError("needs_confirmation", "This needs a confirm tap first", { action: def.name, level });
    }
  }

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

  // Several logged records in one action share a job id, so one undo reverts them all (D-027).
  const jobId = plan.writes.filter((w) => w.log).length > 1 ? newId() : null;

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
             entity_id, before, after, op_id, job_id, undo_of, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id, ctx.actor.studioId, ctx.actor.userId, ctx.source === "assistant" ? "assistant" : "user",
          ctx.source, def.name, w.log.entityType, w.log.entityId,
          w.log.before ? JSON.stringify(w.log.before) : null,
          w.log.after ? JSON.stringify(w.log.after) : null,
          opId, jobId, w.log.undoOf ?? null, ctx.now,
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

