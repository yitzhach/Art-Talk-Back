// Visitor numbers (card G, D-177): the public site adds one to a count; the studio reads them.
import { SiteCountBody, SiteCounts } from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { requirePermission } from "../auth/permissions";
import { requireActor } from "../auth/session";
import { live } from "../lib/collectors";
import { bump, utcDay } from "../lib/counts";
import { body, errors, json, newApp, send } from "./common";
import { studioOf } from "./public";

export const countRoutes = newApp();

type Row = Record<string, unknown>;
const SlugParam = z.object({ slug: z.string().meta({ param: { name: "slug", in: "path" } }) });

countRoutes.openapi(
  createRoute({
    method: "post", path: "/public/studios/{slug}/counts", tags: ["public"],
    summary: "Add one to a visitor count (no sign-in, nothing about the visitor kept)",
    security: [], request: { params: SlugParam, body: body(SiteCountBody) },
    responses: { 204: { description: "Counted, or quietly not (a piece that isn't public, or the day's cap)" }, 400: errors[400], 404: errors[404] },
  }),
  async (c) => {
    const studio = await studioOf(c, c.req.valid("param").slug);
    const { kind, work } = c.req.valid("json");
    let artworkId = "";
    if (work) {
      const row = await c.env.DB.prepare(`SELECT id FROM artworks WHERE studio_id = ? AND slug = ? AND public = 1 AND deleted_at IS NULL AND kind = 'work' AND ${live()}`)
        .bind(studio.id, work).first<Row>();
      if (!row) return c.body(null, 204);
      artworkId = row.id as string;
    } else if (kind === "view") {
      return c.body(null, 204); // a view is always of a piece
    }
    await bump(c.env.DB, studio.id, kind, artworkId);
    return c.body(null, 204);
  },
);

const Days = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });

countRoutes.openapi(
  createRoute({
    method: "get", path: "/site/counts", tags: ["settings"], summary: "The studio's visitor numbers for the last N days",
    request: { query: Days },
    responses: { 200: json(SiteCounts), 400: errors[400], 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "activity:read");
    const { days } = c.req.valid("query");
    const from = utcDay(new Date(Date.now() - (days - 1) * 86_400_000));
    const db = c.env.DB;
    const sid = actor.studioId;
    const [kinds, questions, leads, orders, top] = await db.batch([
      db.prepare("SELECT kind, SUM(n) AS n FROM site_counts WHERE studio_id = ? AND day >= ? GROUP BY kind").bind(sid, from),
      db.prepare("SELECT COUNT(*) AS n FROM visitor_messages WHERE studio_id = ? AND role = 'user' AND deleted_at IS NULL AND created_at >= ?").bind(sid, from),
      db.prepare("SELECT COUNT(*) AS n FROM leads WHERE studio_id = ? AND deleted_at IS NULL AND created_at >= ?").bind(sid, from),
      db.prepare("SELECT COUNT(*) AS n FROM orders WHERE studio_id = ? AND deleted_at IS NULL AND created_at >= ?").bind(sid, from),
      db.prepare(
        `SELECT a.id, a.title, a.slug,
           SUM(CASE WHEN s.kind = 'view' THEN s.n ELSE 0 END) AS view, SUM(CASE WHEN s.kind = 'ask' THEN s.n ELSE 0 END) AS ask,
           SUM(CASE WHEN s.kind = 'wall' THEN s.n ELSE 0 END) AS wall, SUM(CASE WHEN s.kind = 'inquiry' THEN s.n ELSE 0 END) AS inquiry
         FROM site_counts s JOIN artworks a ON a.id = s.artwork_id AND a.studio_id = s.studio_id
         WHERE s.studio_id = ? AND s.day >= ? AND a.deleted_at IS NULL
         GROUP BY a.id ORDER BY view DESC, inquiry DESC, a.title COLLATE NOCASE LIMIT 5`,
      ).bind(sid, from),
    ]);
    const k = new Map((kinds!.results as Row[]).map((r) => [r.kind as string, Number(r.n)]));
    const one = (r: D1Result) => Number((r.results[0] as Row | undefined)?.n ?? 0);
    return send(c, {
      days, from,
      totals: {
        view: k.get("view") ?? 0, ask: k.get("ask") ?? 0, wall: k.get("wall") ?? 0, inquiry: k.get("inquiry") ?? 0,
        question: one(questions!), lead: one(leads!), order: one(orders!),
      },
      topWorks: (top!.results as Row[]).map((r) => ({
        id: r.id as string, title: r.title as string, slug: (r.slug as string | null) ?? null,
        view: Number(r.view), ask: Number(r.ask), wall: Number(r.wall), inquiry: Number(r.inquiry),
      })),
    } satisfies z.infer<typeof SiteCounts>);
  },
);
