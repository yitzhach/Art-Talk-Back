import {
  Artwork, ArtworkInput, ArtworkPatch, ArtworkStatus, Client, ClientInput, ClientPatch, Placement, PlacementInput,
  PlacementPatch, Settings, SettingsPatch, Sale, SaleInput, SalePatch, Show, ShowDetail, ShowInput, ShowPatch, ShowStatus,
  db as schema,
} from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import {
  type EntityDef, artworkEntity, clientEntity, getRecord, placementEntity, saleEntity, settingsEntity, showEntity,
} from "../actions/records";
import { boothSummary } from "../actions/booth";
import { HttpError } from "../lib/errors";
import type { Snapshot } from "../actions/runner";
import type { Db } from "../env";
import { type Permission, requirePermission } from "../auth/permissions";
import { requireActor } from "../auth/session";
import { IdempotencyHeader, IfMatchHeader, PageQuery, PathId, body, errors, ifMatch, json, newApp, run, send } from "./common";

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
      const q = c.req.valid("query") as { cursor?: string; limit: number; status?: string };
      const where = [eq(e.studio, actor.studioId), isNull(e.deletedAt)];
      if (q.cursor) where.push(lt(e.key, q.cursor));
      if (q.status && "status" in e.table) where.push(eq((e.table as unknown as { status: typeof schema.artworks.status }).status, q.status as never));
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

mountRecordRoutes({
  entity: artworkEntity, path: "artworks", tag: "records", record: Artwork.meta({ id: "Artwork" }),
  input: ArtworkInput, patch: ArtworkPatch, filters: z.object({ status: ArtworkStatus.optional() }),
});
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
