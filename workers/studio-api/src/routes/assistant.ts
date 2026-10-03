// Phase 3: the routes studio-assistant calls, and the ones a person's confirm
// card calls. Every decision about what the assistant may do is made here
// (D-045): the assistant proposes, studio-api decides.
import {
  ActRequest, ActResponse, AppendMessages, ConfirmResponse, PolicyEntry, PolicyUpdate, Proposal, SearchResponse,
  SearchType, ThreadResponse, ToolsResponse, db as schema, newId,
} from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { z } from "zod";
import { appendMessages, cardLines, nameOf, pendingEntity, propose, resolve } from "../actions/assistant";
import { getEntity, getRecord } from "../actions/records";
import {
  type ActionCtx, type ActionDef, type Level, type Snapshot, allowedLevels, assistantLevel, getAction, listActions,
  runAction, studioLevel,
} from "../actions/runner";
import { can, requirePermission, type Permission } from "../auth/permissions";
import { requireActor } from "../auth/session";
import type { Actor, AppEnv } from "../env";
import { HttpError, notFound } from "../lib/errors";
import { nowIso } from "../lib/time";
import { PathId, body, errors, json, newApp, requireHuman, run, send } from "./common";

export const assistantRoutes = newApp();

const origin = (c: Context) => new URL(c.req.url).origin;

function requireAssistant(c: Context<AppEnv>): Actor {
  const actor = requireActor(c);
  if (!actor.viaAssistant) throw new HttpError("forbidden", "Only studio-assistant calls this");
  return actor;
}

const ctxFor = (c: Context<AppEnv>, actor: Actor): ActionCtx => ({
  env: c.env, db: drizzle(c.env.DB), actor, source: "assistant", now: nowIso(), origin: origin(c),
});


// --------------------------------------------------------------- act

assistantRoutes.openapi(
  createRoute({
    method: "post", path: "/assistant/act", tags: ["assistant"],
    summary: "The assistant asks to run an action: it runs, or becomes a confirm card",
    description: "studio-assistant only. Runs the action if the studio lets the assistant do it alone; otherwise stores a confirm card for the person and returns it. Edits and deletes may leave out `version`: the current one is used, and the card fails with 409 if the record changes before the tap.",
    request: { body: body(ActRequest) },
    responses: { 200: json(ActResponse), 400: errors[400], 403: errors[403], 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const actor = requireAssistant(c);
    const { action, summary } = c.req.valid("json");
    const def = getAction(action);
    if (!def || def.internal) throw notFound("Action");
    const ctx = ctxFor(c, actor);
    const input = await withVersion(ctx, def, c.req.valid("json").input);
    const parsed = def.input.safeParse(input);
    if (!parsed.success) throw new HttpError("bad_request", "Invalid input", { issues: parsed.error.issues });
    requirePermission(actor.role, def.permission);
    const level = assistantLevel(def, await studioLevel(c.env, actor.studioId, def.name), parsed.data);
    if (level === "never") {
      throw new HttpError("forbidden", `The assistant isn't allowed to ${def.description.split(".")[0]!.toLowerCase()} in this studio`, { action });
    }
    if (level === "auto") {
      const { result, activityIds } = await run(c, def.name, input);
      return send(c, { status: "done", result, activityIds });
    }
    // Card lines are written from the input, and fail now (404) if it names a record that isn't there.
    const details = await cardLines(ctx, def, input);
    const { result } = await runAction<Snapshot>(propose as never, { action, input, summary, details, level }, {
      env: c.env, actor, origin: origin(c), source: "assistant",
    });
    return send(c, { status: "needs_confirmation", proposal: result });
  },
);

/** Edits and deletes the model sends without a version get the current one (see the route's description). */
async function withVersion(ctx: ActionCtx, def: ActionDef, input: Snapshot): Promise<Snapshot> {
  const [type, verb] = def.name.split(".") as [string, string];
  if (!["update", "delete"].includes(verb) || input.version !== undefined) return input;
  const entity = getEntity(type);
  if (!entity) return input;
  const id = type === "settings" ? ctx.actor.studioId : input.id;
  if (typeof id !== "string") return input;
  const rec = await getRecord(ctx.db, entity, ctx.actor.studioId, id);
  return { ...input, version: rec.version };
}

// --------------------------------------------------------- proposals

assistantRoutes.openapi(
  createRoute({
    method: "get", path: "/assistant/proposals", tags: ["assistant"], summary: "My confirm cards still waiting for a tap",
    responses: { 200: json(z.object({ items: z.array(Proposal) })), 401: errors[401] },
  }),
  async (c) => {
    const actor = requireActor(c);
    const t = schema.pendingActions;
    const items = await drizzle(c.env.DB).select().from(t).where(and(
      eq(t.studioId, actor.studioId), eq(t.userId, actor.userId), eq(t.status, "pending"),
      gt(t.expiresAt, nowIso()), isNull(t.deletedAt),
    )).orderBy(desc(t.id)).limit(20);
    return send(c, { items });
  },
);

async function myPending(c: Context<AppEnv>, actor: Actor, id: string) {
  const p = await getRecord(drizzle(c.env.DB), pendingEntity, actor.studioId, id);
  // Only the person the assistant acted for can answer the card (D-045).
  if (p.userId !== actor.userId) throw notFound("Card");
  if (p.status !== "pending") throw new HttpError("version_conflict", `This card was already ${p.status}`);
  return p;
}

assistantRoutes.openapi(
  createRoute({
    method: "post", path: "/assistant/proposals/{id}/confirm", tags: ["assistant"],
    summary: "Confirm a card: run what it says, as the assistant, on your say-so",
    description: "A person only, never the assistant. Runs the action with the input the card shows. A second tap returns the first result. Undo with POST /activity/{activityIds[0]}/undo.",
    request: { params: PathId },
    responses: { 200: json(ConfirmResponse), 403: errors[403], 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const actor = requireHuman(c);
    const id = c.req.valid("param").id;
    const existing = await getRecord(drizzle(c.env.DB), pendingEntity, actor.studioId, id);
    if (existing.userId !== actor.userId) throw notFound("Card");
    const def = getAction(existing.action as string);
    if (!def) throw notFound("Action");
    if (existing.status === "pending" && (existing.expiresAt as string) < nowIso()) {
      throw new HttpError("version_conflict", "This card expired. Ask the assistant again.");
    }
    if (existing.status === "cancelled") throw new HttpError("version_conflict", "This card was cancelled");
    // The card's id is the op id, so a double tap (or a retry) replays instead of writing twice.
    const ran = await runAction<Snapshot>(def as never, existing.input, {
      env: c.env, actor, origin: origin(c), source: "assistant", confirmed: true, opId: id,
    });
    let proposal = existing;
    if (existing.status === "pending") {
      proposal = (await runAction<Snapshot>(resolve as never, { id, status: "confirmed", activityId: ran.activityIds[0] ?? null }, {
        env: c.env, actor, origin: origin(c), source: "assistant",
      })).result;
    }
    return send(c, { proposal: proposal, result: ran.result, activityIds: ran.activityIds });
  },
);

assistantRoutes.openapi(
  createRoute({
    method: "post", path: "/assistant/proposals/{id}/cancel", tags: ["assistant"], summary: "Dismiss a card; nothing is written",
    request: { params: PathId },
    responses: { 200: json(Proposal), 403: errors[403], 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const actor = requireHuman(c);
    const id = c.req.valid("param").id;
    await myPending(c, actor, id);
    const { result } = await runAction<Snapshot>(resolve as never, { id, status: "cancelled", activityId: null }, {
      env: c.env, actor, origin: origin(c), source: "app",
    });
    return send(c, result);
  },
);

// ------------------------------------------------------------ policy

const policyFor = async (c: Context<AppEnv>, actor: Actor) => {
  const rows = await c.env.DB.prepare("SELECT action, level FROM assistant_policy WHERE studio_id = ? AND deleted_at IS NULL")
    .bind(actor.studioId).all<{ action: string; level: Level }>();
  return new Map(rows.results.map((r) => [r.action, r.level]));
};

assistantRoutes.openapi(
  createRoute({
    method: "get", path: "/assistant/policy", tags: ["assistant"], summary: "What the assistant may do, action by action",
    responses: { 200: json(z.object({ items: z.array(PolicyEntry) })), 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "settings:read");
    const chosen = await policyFor(c, actor);
    const items = listActions().filter((d) => !d.internal).sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({
      action: d.name, description: d.description,
      defaultLevel: d.assistant === "never" ? "never" : d.risk,
      studioLevel: chosen.get(d.name) ?? null,
      level: assistantLevel(d, chosen.get(d.name) ?? null),
      allowed: allowedLevels(d),
    }));
    return send(c, { items });
  },
);

assistantRoutes.openapi(
  createRoute({
    method: "put", path: "/assistant/policy/{action}", tags: ["assistant"], summary: "Set how much the assistant may do with one action",
    description: "Owner only, and never the assistant. `always_confirm` actions can only stay there or be set to `never`.",
    request: {
      params: z.object({ action: z.string().regex(/^[a-z_]+\.[a-z_]+$/).meta({ param: { name: "action", in: "path" } }) }),
      body: body(PolicyUpdate),
    },
    responses: { 200: json(z.record(z.string(), z.unknown())), 400: errors[400], 403: errors[403], 404: errors[404] },
  }),
  async (c) => {
    requireHuman(c);
    const { result } = await run(c, "assistant_policy.set", { action: c.req.valid("param").action, level: c.req.valid("json").level });
    return send(c, result);
  },
);

// ------------------------------------------------------------- tools

/** The read tool every app gets. */
const SEARCH_TOOL = {
  name: "search",
  action: null,
  description: "Find shows, sales, artworks or clients by name, to get their ids. Use it before naming a record in any other tool. Several matches: ask the artist which one.",
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string", description: "Words from the name, e.g. \"winter park\"" },
      types: { type: "array", items: { type: "string", enum: SearchType.options }, description: "Only these kinds of record" },
    },
    required: ["q"],
  },
  level: "auto" as Level,
};

const LEVEL_NOTE: Record<Level, string> = {
  auto: "",
  confirm: " The artist confirms this with one tap before anything is saved.",
  always_confirm: " The artist always confirms this with one tap before anything is saved.",
  never: "",
};

export function toolFor(def: ActionDef, level: Level) {
  const schemaOut = z.toJSONSchema(def.input, { io: "input", unrepresentable: "any" }) as Snapshot;
  delete schemaOut.$schema;
  // Edits and deletes may leave out `version` (see /assistant/act).
  if (/\.(update|delete)$/.test(def.name) && Array.isArray(schemaOut.required)) {
    schemaOut.required = (schemaOut.required as string[]).filter((f) => f !== "version");
  }
  return {
    name: def.name.replace(/\./g, "_"),
    action: def.name,
    description: def.description + LEVEL_NOTE[level],
    inputSchema: schemaOut,
    level,
  };
}

assistantRoutes.openapi(
  createRoute({
    method: "get", path: "/assistant/tools", tags: ["assistant"],
    summary: "The tools the assistant gets in one app, from the action registry",
    description: "Only actions tagged for the app (all of them for app=studio), that the caller's role allows and the studio hasn't set to never. Sorted, so the list is stable for prompt caching.",
    request: { query: z.object({ app: z.string().regex(/^[a-z0-9-]+$/).default("studio") }) },
    responses: { 200: json(ToolsResponse), 401: errors[401] },
  }),
  async (c) => {
    const actor = requireActor(c);
    const { app } = c.req.valid("query");
    const chosen = await policyFor(c, actor);
    const tools = listActions()
      .filter((d) => !d.internal && d.assistant !== "never" && can(actor.role, d.permission))
      .filter((d) => app === "studio" || d.apps?.includes(app))
      .map((d) => ({ d, level: assistantLevel(d, chosen.get(d.name) ?? null) }))
      .filter(({ level }) => level !== "never")
      .sort((a, b) => a.d.name.localeCompare(b.d.name))
      .map(({ d, level }) => toolFor(d, level));
    return send(c, { app, tools: [SEARCH_TOOL, ...tools] });
  },
);

// ------------------------------------------------------------ thread

/** A conversation stays open this long after its last message, and up to this many messages (D-053). */
const THREAD_QUIET_MS = 12 * 3600_000;
const THREAD_MAX = 60;

assistantRoutes.openapi(
  createRoute({
    method: "get", path: "/assistant/thread", tags: ["assistant"],
    summary: "The current conversation, on any device",
    description: "A new thread starts after 12 quiet hours or 60 messages; the messages come back exactly as stored, so the model sees an unedited history.",
    responses: { 200: json(ThreadResponse), 401: errors[401] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "assistant:use");
    const t = schema.assistantMessages;
    const db = drizzle(c.env.DB);
    const last = (await db.select({ threadId: t.threadId, createdAt: t.createdAt }).from(t)
      .where(and(eq(t.studioId, actor.studioId), eq(t.userId, actor.userId), isNull(t.deletedAt)))
      .orderBy(desc(t.id)).limit(1))[0];
    if (last && Date.parse(last.createdAt) > Date.now() - THREAD_QUIET_MS) {
      const messages = await db.select({ id: t.id, threadId: t.threadId, role: t.role, content: t.content, app: t.app, createdAt: t.createdAt })
        .from(t).where(and(eq(t.studioId, actor.studioId), eq(t.userId, actor.userId), eq(t.threadId, last.threadId), isNull(t.deletedAt)))
        .orderBy(t.id).limit(THREAD_MAX + 1);
      if (messages.length <= THREAD_MAX) return send(c, { threadId: last.threadId, messages });
    }
    return send(c, { threadId: newId(), messages: [] });
  },
);

assistantRoutes.openapi(
  createRoute({
    method: "post", path: "/assistant/thread/messages", tags: ["assistant"], summary: "Add turns to the conversation (append-only)",
    request: { body: body(AppendMessages) },
    responses: { 200: json(z.object({ ids: z.array(z.string()) })), 400: errors[400], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireAssistant(c);
    const { result } = await runAction(appendMessages as never, c.req.valid("json"), {
      env: c.env, actor, origin: origin(c), source: "assistant",
    });
    return send(c, result);
  },
);

// ------------------------------------------------------------ search

interface SearchDef {
  type: z.infer<typeof SearchType>;
  perm: Permission;
  table: typeof schema.shows | typeof schema.sales | typeof schema.artworks | typeof schema.clients;
  fields: string[]; // SQL columns searched
  detail: (r: Snapshot) => string;
}

const money = (cents: unknown) => (typeof cents === "number" ? `$${(cents / 100).toFixed(2)}` : "unpriced");
const SEARCHABLE: SearchDef[] = [
  { type: "show", perm: "shows:read", table: schema.shows, fields: ["name", "venue", "city"],
    detail: (r) => [r.city, r.startsOn, r.status].filter(Boolean).join(" · ") },
  { type: "sale", perm: "sales:read", table: schema.sales, fields: ["title", "notes"],
    detail: (r) => [money(r.priceCents), r.quantity && (r.quantity as number) > 1 ? `x${r.quantity}` : "", r.soldOn].filter(Boolean).join(" · ") },
  { type: "artwork", perm: "artworks:read", table: schema.artworks, fields: ["title", "inventory_code", "medium"],
    detail: (r) => [r.inventoryCode, r.medium, r.status].filter(Boolean).join(" · ") },
  { type: "client", perm: "clients:read", table: schema.clients, fields: ["name", "email"],
    detail: (r) => [r.kind, r.email].filter(Boolean).join(" · ") },
];

/** LIKE pattern for one word, with LIKE's own wildcards escaped. */
const pattern = (w: string) => `%${w.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

assistantRoutes.openapi(
  createRoute({
    method: "get", path: "/search", tags: ["search"], summary: "Find records by name, for name resolution",
    description: "Every word must appear (in any searched field). Best matches first: the whole name, then a name that starts with the words, then the rest; newest first within each.",
    request: {
      query: z.object({
        q: z.string().trim().min(1).max(200),
        types: z.string().optional().meta({ description: "Comma-separated: show,sale,artwork,client" }),
        limit: z.coerce.number().int().min(1).max(25).default(10),
      }),
    },
    responses: { 200: json(SearchResponse), 400: errors[400], 401: errors[401] },
  }),
  async (c) => {
    const actor = requireActor(c);
    const { q, types, limit } = c.req.valid("query");
    const wanted = new Set(types ? types.split(",").map((t) => t.trim()) : SearchType.options);
    const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    const db = drizzle(c.env.DB);
    const found: { item: z.infer<typeof SearchResponse>["items"][number]; score: number; updatedAt: string }[] = [];
    for (const s of SEARCHABLE) {
      if (!wanted.has(s.type) || !can(actor.role, s.perm)) continue;
      const haystack = sql.raw(s.fields.map((f) => `coalesce(${f}, '')`).join(" || ' ' || "));
      const t = s.table as typeof schema.shows;
      const rows = await db.select().from(s.table).where(and(
        eq(t.studioId, actor.studioId), isNull(t.deletedAt),
        ...words.map((w) => sql`lower(${haystack}) LIKE ${pattern(w)} ESCAPE '\\'`),
      )).orderBy(desc(t.updatedAt)).limit(25) as Snapshot[];
      for (const r of rows) {
        const name = nameOf(r).toLowerCase();
        const score = name === q.toLowerCase() ? 3 : name.startsWith(q.toLowerCase()) ? 2 : words.every((w) => name.includes(w)) ? 1 : 0;
        found.push({ item: { type: s.type, id: r.id as string, version: r.version as number, label: nameOf(r), detail: s.detail(r) }, score, updatedAt: r.updatedAt as string });
      }
    }
    found.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
    return send(c, { items: found.slice(0, limit).map((f) => f.item) });
  },
);

