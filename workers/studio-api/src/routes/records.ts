import { Artwork, ArtworkInput, ArtworkPatch, ArtworkStatus, Client, ClientInput, ClientPatch, Settings, SettingsPatch } from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { type EntityDef, artworkEntity, clientEntity, getRecord, settingsEntity } from "../actions/records";
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
}

function mountRecordRoutes({ entity: e, path, tag, record, input, patch, filters }: RecordRoutesDef) {
  const Page = z.object({ items: z.array(record), nextCursor: z.string().nullable() });
  const noun = e.type;

  recordRoutes.openapi(
    createRoute({
      method: "get", path: `/${path}`, tags: [tag], summary: `List ${path}`,
      request: { query: filters ? PageQuery.extend(filters.shape) : PageQuery },
      responses: { 200: json(Page), 401: errors[401], 403: errors[403] },
    }),
    async (c) => {
      const actor = requireActor(c);
      requirePermission(actor.role, `${e.perm}:read` as Permission);
      const q = c.req.valid("query") as { cursor?: string; limit: number; status?: string };
      const where = [eq(e.studio, actor.studioId), isNull(e.deletedAt)];
      if (q.cursor) where.push(lt(e.key, q.cursor));
      if (q.status && "status" in e.table) where.push(eq((e.table as typeof artworkEntity.table & { status: never }).status, q.status as never));
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
      responses: { 200: json(record), 401: errors[401], 404: errors[404] },
    }),
    async (c) => {
      const actor = requireActor(c);
      requirePermission(actor.role, `${e.perm}:read` as Permission);
      return send(c, await getRecord(drizzle(c.env.DB), e, actor.studioId, c.req.valid("param").id));
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
