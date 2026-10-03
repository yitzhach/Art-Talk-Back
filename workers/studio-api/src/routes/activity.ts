import { ActionResult, Activity, db as schema } from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import { and, desc, eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { requirePermission } from "../auth/permissions";
import { requireActor } from "../auth/session";
import { HttpError } from "../lib/errors";
import { IdempotencyHeader, PageQuery, PathId, body, errors, json, newApp, run, send } from "./common";
import { getAction } from "../actions/runner";

export const activityRoutes = newApp();

activityRoutes.openapi(
  createRoute({
    method: "get", path: "/activity", tags: ["activity"], summary: "List activity, newest first",
    request: { query: PageQuery.extend({ entityType: z.string().optional(), entityId: z.string().optional() }) },
    responses: { 200: json(z.object({ items: z.array(Activity), nextCursor: z.string().nullable() })), 401: errors[401] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "activity:read");
    const q = c.req.valid("query");
    const t = schema.activityLog;
    const where = [eq(t.studioId, actor.studioId)];
    if (q.cursor && /^\d+$/.test(q.cursor)) where.push(lt(t.seq, Number(q.cursor)));
    if (q.entityType) where.push(eq(t.entityType, q.entityType));
    if (q.entityId) where.push(eq(t.entityId, q.entityId));
    const rows = await drizzle(c.env.DB).select().from(t).where(and(...where)).orderBy(desc(t.seq)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    return send(c, {
      items: page.map(({ seq: _s, studioId: _st, opId: _o, jobId: _j, ...rest }) => rest),
      nextCursor: rows.length > q.limit ? String(page.at(-1)!.seq) : null,
    });
  },
);

activityRoutes.openapi(
  createRoute({
    method: "post", path: "/activity/{id}/undo", tags: ["activity"], summary: "Undo one change",
    request: { params: PathId, headers: IdempotencyHeader },
    responses: { 200: json(ActionResult), 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const { result, activityIds } = await run(c, "activity.undo", { id: c.req.valid("param").id });
    return send(c, { ok: true, result, activityIds });
  },
);

activityRoutes.openapi(
  createRoute({
    method: "post", path: "/actions/{name}", tags: ["actions"], summary: "Run a named action from the tool registry",
    request: {
      params: z.object({ name: z.string().regex(/^[a-z_]+\.[a-z_]+$/).meta({ param: { name: "name", in: "path" } }) }),
      headers: IdempotencyHeader,
      body: body(z.record(z.string(), z.unknown())),
    },
    responses: { 200: json(ActionResult), 400: errors[400], 403: errors[403], 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const { name } = c.req.valid("param");
    if (!getAction(name) || getAction(name)!.internal) throw new HttpError("not_found", `No action named ${name}`);
    const { result, activityIds } = await run(c, name, c.req.valid("json"));
    return send(c, { ok: true, result, activityIds });
  },
);
