import {
  Artwork, ArtworkDetail, ArtworkInput, Board, DraftResult, PublishRequest, BoardInput, BoardPatch, Feedback, FeedbackInput, FeedbackPatch, Id, Pin, PinInput, PinKind,
  PinPatch, ArtworkPatch, ArtworkStatus, Client, ClientInput, ClientPatch, Placement, PlacementInput,
  PlacementPatch, Settings, SettingsPatch, Sale, SaleInput, SalePatch, Show, ShowDetail, ShowInput, ShowPatch, ShowStatus,
  db as schema,
} from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import {
  type EntityDef, artworkEntity, clientEntity, getRecord, placementEntity, saleEntity, settingsEntity, showEntity,
} from "../actions/records";
import { boothSummary } from "../actions/booth";
import { boardEntity, feedbackEntity, pinEntity } from "../actions/boards";
import { HttpError } from "../lib/errors";
import { shipWorkOf, shippingOf } from "../lib/shipping";
import { siteFor } from "../lib/site-mail";
import { ArtworkShipping, ShipTier, suggestTier } from "@studio/core";
import { type Snapshot, getAction, runAction } from "../actions/runner";
import { publicFile } from "../actions/files";
import type { Db } from "../env";
import { type Permission, requirePermission } from "../auth/permissions";
import { requireActor } from "../auth/session";
import { IdempotencyHeader, IfMatchHeader, PageQuery, PathId, body, errors, ifMatch, json, newApp, opId, run, send } from "./common";

export const recordRoutes = newApp();

interface RecordRoutesDef {
  entity: EntityDef;
  path: string;
  tag: string;
  record: z.ZodType;
  input: z.ZodType;
  patch: z.ZodType;
  filters?: z.ZodObject;
  /** Largest page a list may ask for (default PageQuery's 200): big records get a smaller one. */
  maxLimit?: number;
  /** GET /{id} returns this instead of the bare record (e.g. a show with its artworks). */
  detail?: { schema: z.ZodType; load: (db: Db, studioId: string, row: Snapshot) => Promise<Snapshot> };
}

function mountRecordRoutes({ entity: e, path, tag, record, input, patch, filters, detail, maxLimit }: RecordRoutesDef) {
  const Page = z.object({ items: z.array(record), nextCursor: z.string().nullable() });
  const noun = e.type;

  recordRoutes.openapi(
    createRoute({
      method: "get", path: `/${path}`, tags: [tag], summary: `List ${path}`,
      request: {
        query: (() => {
          const page = maxLimit
            ? PageQuery.extend({ limit: z.coerce.number().int().min(1).max(maxLimit).default(Math.min(50, maxLimit)) })
            : PageQuery;
          return filters ? page.extend(filters.shape) : page;
        })(),
      },
      responses: { 200: json(Page), 401: errors[401], 403: errors[403] },
    }),
    async (c) => {
      const actor = requireActor(c);
      requirePermission(actor.role, `${e.perm}:read` as Permission);
      const q = c.req.valid("query") as { cursor?: string; limit: number } & Record<string, unknown>;
      const where = [eq(e.studio, actor.studioId), isNull(e.deletedAt)];
      if (q.cursor) where.push(lt(e.key, q.cursor));
      // Each declared filter is an equality on the column of the same name (D-086).
      const columns = e.table as unknown as Record<string, SQLiteColumn>;
      for (const k of Object.keys(filters?.shape ?? {})) if (q[k] !== undefined) where.push(eq(columns[k]!, q[k]));
      const rows = await drizzle(c.env.DB).select().from(e.table).where(and(...where)).orderBy(desc(e.key)).limit(q.limit + 1);
      const items = rows.slice(0, q.limit) as { id: string }[];
      return send(c, { items, nextCursor: rows.length > q.limit ? items.at(-1)!.id : null });
    },
  );

  recordRoutes.openapi(
    createRoute({
      method: "post", path: `/${path}`, tags: [tag], summary: `Create a ${noun}`,
      request: { headers: IdempotencyHeader, body: body(input) },
      responses: { 201: json(record, "Created"), 400: errors[400], 401: errors[401], 403: errors[403] },
    }),
    async (c) => {
      const { result, replayed } = await run(c, `${noun}.create`, c.req.valid("json"));
      return send(c, result, replayed ? 200 : 201);
    },
  );

  recordRoutes.openapi(
    createRoute({
      method: "get", path: `/${path}/{id}`, tags: [tag], summary: `Get a ${noun}`,
      request: { params: PathId },
      responses: { 200: json(detail?.schema ?? record), 401: errors[401], 404: errors[404] },
    }),
    async (c) => {
      const actor = requireActor(c);
      requirePermission(actor.role, `${e.perm}:read` as Permission);
      const db = drizzle(c.env.DB);
      const row = await getRecord(db, e, actor.studioId, c.req.valid("param").id);
      return send(c, detail ? await detail.load(db, actor.studioId, row) : row);
    },
  );

  recordRoutes.openapi(
    createRoute({
      method: "patch", path: `/${path}/{id}`, tags: [tag], summary: `Update a ${noun}`,
      request: { params: PathId, headers: IfMatchHeader.extend(IdempotencyHeader.shape), body: body(patch) },
      responses: { 200: json(record), 400: errors[400], 404: errors[404], 409: errors[409] },
    }),
    async (c) => {
      const { result } = await run(c, `${noun}.update`, { id: c.req.valid("param").id, version: ifMatch(c), patch: c.req.valid("json") });
      return send(c, result);
    },
  );

  recordRoutes.openapi(
    createRoute({
      method: "delete", path: `/${path}/{id}`, tags: [tag], summary: `Soft-delete a ${noun}`,
      request: { params: PathId, headers: IfMatchHeader.extend(IdempotencyHeader.shape) },
      responses: { 200: json(record, "Deleted; undo via /activity"), 404: errors[404], 409: errors[409] },
    }),
    async (c) => {
      const { result } = await run(c, `${noun}.delete`, { id: c.req.valid("param").id, version: ifMatch(c) });
      return send(c, result);
    },
  );
}

// ------------------------------------------------------------ the catalogue (Site 3.0 stage 1, D-104…D-110)
const ArtworkOut = Artwork.meta({ id: "Artwork" });

// Registered before /artworks/{id} so "collections" isn't an id.
recordRoutes.openapi(
  createRoute({
    method: "get", path: "/artworks/collections", tags: ["records"], summary: "The studio's collections and how many works each has",
    description: "Every undeleted work, public or not. The assistant's draft picks a collection from this list.",
    responses: { 200: json(z.object({ items: z.array(z.object({ name: z.string(), count: z.number().int() })) })), 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "artworks:read");
    const t = schema.artworks;
    const rows = await drizzle(c.env.DB).select({ name: t.collection, count: sql<number>`count(*)` }).from(t)
      .where(and(eq(t.studioId, actor.studioId), isNull(t.deletedAt), sql`${t.collection} IS NOT NULL`))
      .groupBy(t.collection).orderBy(t.collection);
    return send(c, { items: rows });
  },
);

// Studio's shipping list (D-150): every work with its tier and the size's suggestion, which counts only once accepted.
recordRoutes.openapi(
  createRoute({
    method: "get", path: "/artworks/shipping", tags: ["records"], summary: "Every work's shipping tier and the tier its size suggests",
    description: "A suggestion never sets a tier: the owner accepts it (PATCH the work's `shipping`). `check` marks a size near a line or missing.",
    responses: {
      200: json(z.object({ items: z.array(z.object({
        id: z.string(), title: z.string(), slug: z.string().nullable(), status: z.string(), public: z.boolean(), priceCents: z.number().int().nullable(),
        width: z.number().nullable(), height: z.number().nullable(), depth: z.number().nullable(), sizeUnit: z.string(), version: z.number().int(),
        shipping: ArtworkShipping.nullable(),
        suggestion: z.object({ tier: ShipTier.nullable(), check: z.boolean(), reason: z.string() }),
      })) })),
      401: errors[401], 403: errors[403],
    },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "artworks:read");
    const s = shippingOf((await siteFor(c.env, actor.studioId)).site);
    const { results } = await c.env.DB.prepare(
      `SELECT id, title, slug, status, public, price_cents, width, height, depth, size_unit, version, shipping FROM artworks
       WHERE studio_id = ? AND deleted_at IS NULL AND kind = 'work' ORDER BY title LIMIT 2000`,
    ).bind(actor.studioId).all<Record<string, unknown>>();
    return send(c, { items: results.map((r) => {
      const w = shipWorkOf(r);
      return {
        id: w.id, title: w.title, slug: w.slug, status: w.status, public: !!r.public, priceCents: w.priceCents,
        width: w.width, height: w.height, depth: w.depth, sizeUnit: w.sizeUnit, version: Number(r.version), shipping: w.shipping,
        suggestion: suggestTier(w, s),
      };
    }) });
  },
);

mountRecordRoutes({
  entity: artworkEntity, path: "artworks", tag: "records", record: ArtworkOut,
  input: ArtworkInput, patch: ArtworkPatch,
  filters: z.object({ status: ArtworkStatus.optional(), collection: z.string().max(80).optional() }),
  detail: {
    schema: ArtworkDetail.meta({ id: "ArtworkDetail" }),
    // The work's pictures in order: the owner's screens and the assistant's draft read them here.
    load: async (db, studioId, row) => {
      const t = schema.files;
      const images = (await db.select().from(t).where(and(
        eq(t.studioId, studioId), eq(t.entityType, "artwork"), eq(t.entityId, row.id as string), eq(t.status, "ready"), isNull(t.deletedAt),
      )).orderBy(t.position, t.id)) as Snapshot[];
      return { ...row, images: images.map(publicFile) };
    },
  },
});

recordRoutes.openapi(
  createRoute({
    method: "post", path: "/artworks/{id}/publish", tags: ["records"], summary: "Approve a work: make it public (D-104)",
    description: "Needs a title and a cover picture with its web sizes. Makes the slug from the title unless one is sent or set. Clears draftedFields: approving accepts the assistant's words as they stand.",
    request: { params: PathId, headers: IfMatchHeader.extend(IdempotencyHeader.shape), body: { required: false, content: { "application/json": { schema: PublishRequest } } } },
    responses: { 200: json(ArtworkOut), 400: errors[400], 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const extra = PublishRequest.safeParse(raw ?? {});
    if (!extra.success) throw new HttpError("bad_request", "Invalid input", { issues: extra.error.issues });
    const { result } = await run(c, "artwork.publish", { id: c.req.valid("param").id, version: ifMatch(c), ...extra.data });
    return send(c, result);
  },
);

recordRoutes.openapi(
  createRoute({
    method: "post", path: "/artworks/{id}/unpublish", tags: ["records"], summary: "Take a work off the public site",
    request: { params: PathId, headers: IfMatchHeader.extend(IdempotencyHeader.shape) },
    responses: { 200: json(ArtworkOut), 400: errors[400], 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const { result } = await run(c, "artwork.unpublish", { id: c.req.valid("param").id, version: ifMatch(c) });
    return send(c, result);
  },
);

recordRoutes.openapi(
  createRoute({
    method: "post", path: "/artworks/{id}/draft", tags: ["assistant"], summary: "The assistant writes its draft of a work's words (studio-assistant only)",
    description: "studio-assistant's draft job calls this with the person's session and its key (D-046, D-108). Writes description, tags, collection and the cover's alt text only where the field is empty or still the assistant's earlier draft. Never publishes.",
    request: { params: PathId, headers: IdempotencyHeader, body: body(DraftResult) },
    responses: { 200: json(ArtworkOut), 400: errors[400], 403: errors[403], 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const actor = requireActor(c);
    if (!actor.viaAssistant) throw new HttpError("forbidden", "Only the assistant writes drafts");
    const def = getAction("artwork.applyDraft")!;
    const { result } = await runAction(def, { ...c.req.valid("json"), id: c.req.valid("param").id }, {
      env: c.env, actor, origin: new URL(c.req.url).origin, opId: opId(c), source: "assistant",
    });
    return send(c, result);
  },
);
mountRecordRoutes({
  entity: clientEntity, path: "clients", tag: "records", record: Client.meta({ id: "Client" }),
  input: ClientInput, patch: ClientPatch,
});

// Shows by date, for "what do I need to apply to this week?" (D-076): the
// assistant's find_shows tool. The Show Tracker keeps its apply-by date in
// meta (D-038), so this reads it there; a value that isn't YYYY-MM-DD never
// matches a date range. Registered before /shows/{id} so "dates" isn't an id.
const ShowDateItem = z.object({
  id: z.string(), version: z.number().int(), name: z.string(), venue: z.string().nullable(), city: z.string().nullable(),
  status: ShowStatus, trackerStatus: z.string().nullable(), applyBy: z.string().nullable(),
  startsOn: z.string().nullable(), endsOn: z.string().nullable(), url: z.string().nullable(),
  feeCents: z.number().int().nullable(), juryFeeCents: z.number().int().nullable(), currency: z.string(),
}).meta({ id: "ShowDateItem" });
const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const DAY_GLOB = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]";

recordRoutes.openapi(
  createRoute({
    method: "get", path: "/shows/dates", tags: ["records"],
    summary: "Shows by apply-by or start date, soonest first",
    description: "For the assistant's find_shows tool and for agents. `by` picks the date (applyBy is the Show Tracker's, from meta); `from` and `to` are inclusive. Shows the tracker hides are left out. Without a range, shows with no date come last.",
    request: {
      query: z.object({
        by: z.enum(["applyBy", "startsOn"]).default("applyBy"),
        from: IsoDay.optional(),
        to: IsoDay.optional(),
        status: z.string().regex(/^[a-z]+(,[a-z]+)*$/).optional().meta({ description: "Comma-separated: planned,applied,accepted,declined,done,cancelled" }),
        limit: z.coerce.number().int().min(1).max(50).default(25),
      }),
    },
    responses: { 200: json(z.object({ items: z.array(ShowDateItem) })), 400: errors[400], 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "shows:read");
    const q = c.req.valid("query");
    const statuses = q.status ? q.status.split(",") : [];
    const bad = statuses.find((v) => !ShowStatus.safeParse(v).success);
    if (bad) throw new HttpError("bad_request", `Unknown status "${bad}".`, { allowed: ShowStatus.options });
    const t = schema.shows;
    const day = q.by === "applyBy" ? sql`json_extract(${t.meta}, '$.applyBy')` : sql`${t.startsOn}`;
    const where = [eq(t.studioId, actor.studioId), isNull(t.deletedAt), sql`coalesce(json_extract(${t.meta}, '$.hidden'), 0) = 0`];
    if (statuses.length) where.push(inArray(t.status, statuses as never[]));
    if (q.from || q.to) where.push(sql`${day} GLOB ${DAY_GLOB}`);
    if (q.from) where.push(sql`${day} >= ${q.from}`);
    if (q.to) where.push(sql`${day} <= ${q.to}`);
    const rows = await drizzle(c.env.DB).select().from(t).where(and(...where))
      .orderBy(sql`${day} IS NULL`, sql`${day}`, t.name).limit(q.limit);
    const text = (v: unknown) => (typeof v === "string" && v ? v : null);
    const cents = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);
    const items = rows.map((r) => {
      const m = (r.meta ?? {}) as Record<string, unknown>;
      return {
        id: r.id, version: r.version, name: r.name, venue: r.venue, city: r.city, status: r.status,
        trackerStatus: text(m.trackerStatus), applyBy: text(m.applyBy), startsOn: r.startsOn, endsOn: r.endsOn,
        url: text(m.url), feeCents: r.feeCents, juryFeeCents: cents(m.juryFeeCents), currency: r.currency,
      };
    });
    return send(c, { items });
  },
);

mountRecordRoutes({
  entity: showEntity, path: "shows", tag: "records", record: Show.meta({ id: "Show" }),
  input: ShowInput, patch: ShowPatch, filters: z.object({ status: ShowStatus.optional() }),
  detail: {
    schema: ShowDetail.meta({ id: "ShowDetail" }),
    load: async (db, studioId, row) => {
      const t = schema.showArtworks;
      const artworks = await db.select().from(t)
        .where(and(eq(t.studioId, studioId), eq(t.showId, row.id as string), isNull(t.deletedAt)))
        .orderBy(t.id);
      return { ...row, artworks };
    },
  },
});

mountRecordRoutes({
  entity: saleEntity, path: "sales", tag: "records", record: Sale.meta({ id: "Sale" }),
  input: SaleInput, patch: SalePatch,
});

// A placement carries its whole scene (up to PLACEMENT_SCENE_MAX), so a list page is small.
mountRecordRoutes({
  entity: placementEntity, path: "placements", tag: "records", record: Placement.meta({ id: "Placement" }),
  input: PlacementInput, patch: PlacementPatch, maxLimit: 20,
});

// Studio Wall (D-082…D-086). Cards and comments are read per board.
mountRecordRoutes({
  entity: boardEntity, path: "boards", tag: "boards", record: Board.meta({ id: "Board" }),
  input: BoardInput, patch: BoardPatch,
});
mountRecordRoutes({
  entity: pinEntity, path: "pins", tag: "boards", record: Pin.meta({ id: "Pin" }),
  input: PinInput, patch: PinPatch, filters: z.object({ boardId: Id.optional(), kind: PinKind.optional() }),
});
mountRecordRoutes({
  entity: feedbackEntity, path: "feedback", tag: "boards", record: Feedback.meta({ id: "Feedback" }),
  input: FeedbackInput, patch: FeedbackPatch, filters: z.object({ boardId: Id.optional(), pinId: Id.optional() }),
});

// What is in a Booth Studio booth, small enough for a model or an agent: the
// booth, its walls, each work and piece of furniture with its id and place
// (D-070). The ops that change it run through POST /actions/placement.edit.
const Item = z.record(z.string(), z.unknown());
const BoothSummary = z.object({
  id: z.string(), version: z.number().int(), format: z.string(), name: z.string(), units: z.literal("inches"),
  frame: z.string().meta({ description: "How x, y and z are measured" }),
  booth: Item, walls: z.array(Item), art: z.array(Item), furniture: z.array(Item), limits: Item,
}).meta({ id: "BoothSummary" });

recordRoutes.openapi(
  createRoute({
    method: "get", path: "/placements/{id}/summary", tags: ["records"],
    summary: "What is in a Booth Studio booth: its walls, work and furniture with ids and positions",
    description: "For the assistant's describe_booth tool and for agents. Never the images or the scene itself. 400 for a placement in another format.",
    request: { params: PathId },
    responses: { 200: json(BoothSummary), 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "placements:read");
    return send(c, await boothSummary(drizzle(c.env.DB), actor.studioId, c.req.valid("param").id));
  },
);

recordRoutes.openapi(
  createRoute({
    method: "get", path: "/settings", tags: ["settings"], summary: "Get the active studio's settings",
    responses: { 200: json(Settings), 401: errors[401] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "settings:read");
    return send(c, await getRecord(drizzle(c.env.DB), settingsEntity, actor.studioId, actor.studioId));
  },
);

recordRoutes.openapi(
  createRoute({
    method: "patch", path: "/settings", tags: ["settings"], summary: "Update studio settings",
    request: { headers: IfMatchHeader, body: body(SettingsPatch) },
    responses: { 200: json(Settings), 400: errors[400], 403: errors[403], 409: errors[409] },
  }),
  async (c) => {
    const { result } = await run(c, "settings.update", { version: ifMatch(c), patch: c.req.valid("json") });
    return send(c, result);
  },
);
