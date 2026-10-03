import { SYNC_PUSH_MAX_OPS, SyncPullResponse, SyncPushRequest, SyncPushResponse } from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { applyOp, pullChanges } from "../actions/sync";
import { requirePermission } from "../auth/permissions";
import { requireActor } from "../auth/session";
import { body, errors, json, newApp, send } from "./common";

export const syncRoutes = newApp();

syncRoutes.openapi(
  createRoute({
    method: "post", path: "/sync/push", tags: ["sync"], summary: "Apply a device's outbox, in order",
    description: `Each op runs through the same action as a normal API call. A repeated opId returns \`duplicate\` without writing again. One op failing doesn't stop the rest. Answers the first ${SYNC_PUSH_MAX_OPS} ops; send the others again (D-050).`,
    request: { body: body(SyncPushRequest) },
    responses: { 200: json(SyncPushResponse, "One result per answered op, same order"), 400: errors[400], 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireActor(c);
    const origin = new URL(c.req.url).origin;
    const results = [];
    for (const op of c.req.valid("json").ops.slice(0, SYNC_PUSH_MAX_OPS)) results.push(await applyOp(c.env, actor, origin, op));
    return send(c, { results });
  },
);

syncRoutes.openapi(
  createRoute({
    method: "get", path: "/sync/pull", tags: ["sync"], summary: "Everything changed since the cursor, deletions included",
    request: {
      query: z.object({
        since: z.string().regex(/^\d+$/).default("0").meta({ description: "Cursor from the last pull; '0' for a first sync" }),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      }),
    },
    responses: { 200: json(SyncPullResponse, "Call again with cursor while hasMore is true"), 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "activity:read");
    const { since, limit } = c.req.valid("query");
    return send(c, await pullChanges(c.env, actor, Number(since), limit));
  },
);
