// Collectors (Site 3.0 stage 6, D-163…D-168).
//
// Owner: the collectors list and one collector (their works, link, commissions), their private link and invite,
// who owns a work, first look on a work and its email, commissions, followers.
// Public, no sign-in, under /public/studios/{slug} (the studio is the slug and nothing else): a collector's page by
// its token, its pictures and certificates; following the studio with an email code; a follower's page and stop; a
// show's name for its QR code's page. A browser that opens a collector's page or follows sees first look (D-165).
import {
  CollectorDetail, CollectorSummary, Commission, CommissionInput, CommissionPatch, FirstLookInput, FollowCodeInput, FollowVerifyInput, Follower,
  Id, PublicCollectorPage, PublicFollowerPage, PublicShow, SetOwnerInput,
} from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { followerByToken, linkByToken, liveLink } from "../actions/collectors";
import { getAction, runAction, type Snapshot } from "../actions/runner";
import { visitorActor, visitorFor } from "../actions/visitors";
import { requirePermission } from "../auth/permissions";
import { requireActor } from "../auth/session";
import { sizeKey } from "../actions/files";
import type { AppEnv } from "../env";
import {
  certificateNumber, collectorSettings, firstName, inFirstLook, live, sendCollectorInvite, sendFirstLook, sendFollowCode,
} from "../lib/collectors";
import { safeEqual, sha256, sixDigitCode } from "../lib/crypto";
import { HttpError, notFound } from "../lib/errors";
import { claimCodeSend } from "../lib/code-limits";
import { siteFor } from "../lib/site-mail";
import { inSeconds, nowIso } from "../lib/time";
import { IfMatchHeader, PathId, body, errors, ifMatch, json, newApp, run, send } from "./common";
import { COLS, filesOf, parse, publicWork, studioOf } from "./public";

export const collectorRoutes = newApp();

type Row = Record<string, unknown>;
const P = "/public/studios/{slug}";
const SlugParam = z.object({ slug: z.string().meta({ param: { name: "slug", in: "path" } }) });
const TokenParam = SlugParam.extend({ token: z.string().meta({ param: { name: "token", in: "path" } }) });
const KeyHeader = z.object({ "x-visitor-key": z.string().optional().meta({ description: "The site's per-browser key (D-134)" }) });
const noStore = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" },
  }) as never;
const err = (description: string) => ({ ...errors[400], description });

/** Where a collector's page lives on the studio's site (D-163). */
export const collectorPath = (token: string) => `/c/${token}`;
/** A follower's own page: first look and Stop following. */
export const followerPath = (token: string) => `/f/${token}`;

/** The site the studio's pages live on: the request's own origin (the site forwards /v1 through its Worker). */
const siteOrigin = (c: Context<AppEnv>, given?: string | null) => {
  const o = given && /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(given) ? given : new URL(c.req.url).origin;
  return o.replace(/\/$/, "");
};

// ------------------------------------------------------------------ the owner: collectors

const OWNED = "kind = 'work' AND status = 'sold' AND deleted_at IS NULL AND json_extract(meta, '$.sale.clientId') = ?";

async function summaries(c: Context<AppEnv>, studioId: string, rows: Row[]): Promise<z.infer<typeof CollectorSummary>[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as string);
  const counts = new Map<string, number>(), comms = new Map<string, number>(), links = new Map<string, Row>(), follows = new Set<string>();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90), q = part.map(() => "?").join(",");
    const owned = await c.env.DB.prepare(
      `SELECT json_extract(meta, '$.sale.clientId') AS cid, count(*) AS n FROM artworks WHERE studio_id = ? AND kind = 'work' AND status = 'sold'
       AND deleted_at IS NULL AND json_extract(meta, '$.sale.clientId') IN (${q}) GROUP BY cid`,
    ).bind(studioId, ...part).all<Row>();
    for (const r of owned.results) counts.set(r.cid as string, Number(r.n));
    const cm = await c.env.DB.prepare(
      `SELECT client_id, count(*) AS n FROM commissions WHERE studio_id = ? AND deleted_at IS NULL AND client_id IN (${q}) GROUP BY client_id`,
    ).bind(studioId, ...part).all<Row>();
    for (const r of cm.results) comms.set(r.client_id as string, Number(r.n));
    const lk = await c.env.DB.prepare(
      `SELECT client_id, token, invited_at, created_at FROM collector_links WHERE studio_id = ? AND revoked_at IS NULL AND deleted_at IS NULL
       AND client_id IN (${q}) ORDER BY created_at`,
    ).bind(studioId, ...part).all<Row>();
    for (const r of lk.results) links.set(r.client_id as string, r);
    const fl = await c.env.DB.prepare(
      `SELECT client_id FROM followers WHERE studio_id = ? AND verified_at IS NOT NULL AND unsubscribed_at IS NULL AND deleted_at IS NULL
       AND client_id IN (${q})`,
    ).bind(studioId, ...part).all<Row>();
    for (const r of fl.results) follows.add(r.client_id as string);
  }
  return rows.map((r) => {
    const l = links.get(r.id as string);
    return {
      id: r.id as string, version: Number(r.version), name: r.name as string, kind: r.kind as string,
      email: (r.email as string | null) ?? null, phone: (r.phone as string | null) ?? null,
      workCount: counts.get(r.id as string) ?? 0, commissionCount: comms.get(r.id as string) ?? 0,
      link: l ? { path: collectorPath(l.token as string), invitedAt: (l.invited_at as string | null) ?? null, createdAt: l.created_at as string } : null,
      following: follows.has(r.id as string),
      from: (parse<Row>(r.meta, {}).from as string | undefined) ?? null,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    };
  });
}

const commissionOut = (r: Row): z.infer<typeof Commission> => ({
  id: r.id as string, version: Number(r.version), clientId: (r.client_id ?? r.clientId) as string, title: r.title as string,
  size: (r.size as string | null) ?? null, priceCents: ((r.price_cents ?? r.priceCents) as number | null) ?? null, currency: r.currency as string,
  stage: r.stage as "surface", status: r.status as "open", notes: typeof r.notes === "string" ? parse(r.notes, {}) : ((r.notes ?? {}) as Record<string, string>),
  dueOn: ((r.due_on ?? r.dueOn) as string | null) ?? null, createdAt: (r.created_at ?? r.createdAt) as string, updatedAt: (r.updated_at ?? r.updatedAt) as string,
});

async function detail(c: Context<AppEnv>, studioId: string, id: string): Promise<z.infer<typeof CollectorDetail>> {
  const row = await c.env.DB.prepare("SELECT * FROM clients WHERE studio_id = ? AND id = ? AND deleted_at IS NULL").bind(studioId, id).first<Row>();
  if (!row) throw notFound("Collector");
  const [sum] = await summaries(c, studioId, [row]);
  const { name } = await siteFor(c.env, studioId);
  const { results: works } = await c.env.DB.prepare(
    `SELECT id, version, slug, title, year, status, meta, created_at FROM artworks WHERE studio_id = ? AND ${OWNED} ORDER BY updated_at DESC LIMIT 200`,
  ).bind(studioId, id).all<Row>();
  const { results: cms } = await c.env.DB.prepare(
    "SELECT * FROM commissions WHERE studio_id = ? AND client_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50",
  ).bind(studioId, id).all<Row>();
  return {
    ...sum!,
    notes: (row.notes as string | null) ?? null,
    works: works.map((w) => ({
      id: w.id as string, version: Number(w.version), slug: (w.slug as string | null) ?? null, title: w.title as string,
      year: (w.year as number | null) ?? null, status: w.status as "sold",
      soldAt: ((parse<Row>(w.meta, {}).sale as Row | undefined)?.soldAt as string | null | undefined) ?? null,
      certificate: certificateNumber(name, { id: w.id as string, year: w.year as number | null, createdAt: w.created_at as string }),
    })),
    commissions: cms.map(commissionOut),
  };
}

collectorRoutes.openapi(
  createRoute({
    method: "get", path: "/collectors", tags: ["collectors"],
    summary: "Everyone who bought, inquired or followed: newest first, with how many works each owns and whether they have a link",
    request: { query: z.object({ q: z.string().max(100).optional() }) },
    responses: { 200: json(z.object({ items: z.array(CollectorSummary) })), 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "clients:read");
    const { q } = c.req.valid("query");
    const like = q ? `%${q.trim().toLowerCase().replace(/[%_]/g, "")}%` : null;
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM clients WHERE studio_id = ? AND deleted_at IS NULL ${like ? "AND (lower(name) LIKE ? OR lower(coalesce(email,'')) LIKE ?)" : ""}
       ORDER BY created_at DESC LIMIT 500`,
    ).bind(actor.studioId, ...(like ? [like, like] : [])).all<Row>();
    return send(c, { items: await summaries(c, actor.studioId, results) });
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "get", path: "/collectors/{id}", tags: ["collectors"],
    summary: "One collector: the works they own (with certificate numbers), their link, their commissions",
    request: { params: PathId },
    responses: { 200: json(CollectorDetail), 401: errors[401], 403: errors[403], 404: errors[404] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "clients:read");
    return send(c, await detail(c, actor.studioId, c.req.valid("param").id));
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "post", path: "/collectors/{id}/link", tags: ["collectors"],
    summary: "Make their private page link (any old one stops working)",
    request: { params: PathId },
    responses: { 200: json(CollectorDetail), 401: errors[401], 403: errors[403], 404: errors[404] },
  }),
  async (c) => {
    const actor = requireActor(c);
    const id = c.req.valid("param").id;
    await run(c, "collector.link", { clientId: id });
    return send(c, await detail(c, actor.studioId, id));
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "post", path: "/collectors/{id}/unlink", tags: ["collectors"],
    summary: "Stop their page link working",
    request: { params: PathId },
    responses: { 200: json(CollectorDetail), 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] },
  }),
  async (c) => {
    const actor = requireActor(c);
    const id = c.req.valid("param").id;
    await run(c, "collector.unlink", { clientId: id });
    return send(c, await detail(c, actor.studioId, id));
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "post", path: "/collectors/{id}/invite", tags: ["collectors"],
    summary: "Email them the link to their page (on staging the email goes to the studio's own inbox, D-167)",
    request: { params: PathId, body: body(z.object({ origin: z.string().max(200).optional(), note: z.string().trim().max(1000).optional() }).strict()) },
    responses: { 200: json(CollectorDetail.extend({ sent: z.boolean() })), 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] },
  }),
  async (c) => {
    const actor = requireActor(c);
    const id = c.req.valid("param").id;
    const b = c.req.valid("json");
    await run(c, "collector.invite", { clientId: id });
    const d = await detail(c, actor.studioId, id);
    const { name } = await siteFor(c.env, actor.studioId);
    const sent = await sendCollectorInvite(c.env, actor.studioId, {
      to: d.email!, name: d.name, studioName: name, url: `${siteOrigin(c, b.origin)}${d.link!.path}`, note: b.note ?? null,
    });
    return send(c, { ...d, sent });
  },
);

// ------------------------------------------------------------------ the owner: works

const ArtworkOut = z.object({ id: Id, version: z.number().int(), status: z.string(), publicFrom: z.string().nullable(), ownerId: Id.nullable() });
const artworkOut = (a: Snapshot) => ({
  id: a.id as string, version: a.version as number, status: a.status as string, publicFrom: (a.publicFrom as string | null) ?? null,
  ownerId: (((a.meta ?? {}) as Row).sale as Row | undefined)?.clientId as string | null ?? null,
});

collectorRoutes.openapi(
  createRoute({
    method: "post", path: "/artworks/{id}/owner", tags: ["collectors"],
    summary: "Who owns this work: a sold one gets its buyer; an unsold one is marked sold to them (D-164)",
    request: { params: PathId, headers: IfMatchHeader, body: body(SetOwnerInput) },
    responses: { 200: json(ArtworkOut), 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const b = c.req.valid("json");
    const version = c.req.header("If-Match") ? ifMatch(c) : undefined;
    const { result } = await run<Snapshot>(c, "artwork.set_owner", { artworkId: c.req.valid("param").id, ...b, ...(version ? { version } : {}) });
    return send(c, artworkOut(result));
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "post", path: "/artworks/{id}/first-look", tags: ["collectors"],
    summary: "First look: collectors and followers see this work before the public site does; `until` null ends it (D-165)",
    request: { params: PathId, headers: IfMatchHeader, body: body(FirstLookInput) },
    responses: { 200: json(ArtworkOut), 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const b = c.req.valid("json");
    const version = c.req.header("If-Match") ? ifMatch(c) : undefined;
    const { result } = await run<Snapshot>(c, "artwork.first_look", { artworkId: c.req.valid("param").id, ...b, ...(version ? { version } : {}) });
    return send(c, artworkOut(result));
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "post", path: "/first-look/announce", tags: ["collectors"],
    summary: "Email followers and collectors about the works in first look not announced yet (the artist's tap; staging: his inbox only)",
    request: { body: body(z.object({ origin: z.string().max(200).optional() }).strict()) },
    responses: { 200: json(z.object({ works: z.number().int(), emailed: z.number().int() })), 400: errors[400], 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireActor(c);
    const { origin } = c.req.valid("json");
    const { result } = await run<Snapshot[]>(c, "first_look.announce", {});
    const site = siteOrigin(c, origin);
    const { name } = await siteFor(c.env, actor.studioId);
    // Collectors with a live link get their page; followers their own page with Stop. One email per address.
    const { results: links } = await c.env.DB.prepare(
      `SELECT l.token, lower(cl.email) AS email FROM collector_links l JOIN clients cl ON cl.id = l.client_id AND cl.studio_id = l.studio_id
       WHERE l.studio_id = ? AND l.revoked_at IS NULL AND l.deleted_at IS NULL AND cl.deleted_at IS NULL AND cl.email IS NOT NULL LIMIT 1000`,
    ).bind(actor.studioId).all<Row>();
    const { results: fols } = await c.env.DB.prepare(
      `SELECT token, email FROM followers WHERE studio_id = ? AND verified_at IS NOT NULL AND unsubscribed_at IS NULL AND deleted_at IS NULL LIMIT 2000`,
    ).bind(actor.studioId).all<Row>();
    const to = new Map<string, { url: string; stopUrl: string | null }>();
    for (const l of links) to.set(l.email as string, { url: `${site}${collectorPath(l.token as string)}`, stopUrl: null });
    for (const f of fols) if (!to.has(f.email as string)) to.set(f.email as string, { url: `${site}${followerPath(f.token as string)}`, stopUrl: `${site}${followerPath(f.token as string)}` });
    let emailed = 0;
    // Outside production every one of these goes to the studio's own inbox (D-167): one is enough to see it.
    const list = c.env.ENVIRONMENT === "production" ? [...to.entries()] : [...to.entries()].slice(0, 1);
    for (const [email, u] of list) {
      if (await sendFirstLook(c.env, actor.studioId, { to: email, studioName: name, works: result as Row[], url: u.url, stopUrl: u.stopUrl })) emailed++;
    }
    return send(c, { works: result.length, emailed });
  },
);

// ------------------------------------------------------------------ the owner: commissions and followers

collectorRoutes.openapi(
  createRoute({
    method: "post", path: "/commissions", tags: ["collectors"], summary: "Start a commission for a collector (D-168)",
    request: { body: body(CommissionInput) },
    responses: { 201: json(Commission), 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] },
  }),
  async (c) => {
    const { result } = await run<Snapshot>(c, "commission.create", c.req.valid("json"));
    return send(c, commissionOut(result), 201);
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "patch", path: "/commissions/{id}", tags: ["collectors"], summary: "Change a commission: its stage, a stage's note, its status",
    request: { params: PathId, headers: IfMatchHeader, body: body(CommissionPatch) },
    responses: { 200: json(Commission), 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const { result } = await run<Snapshot>(c, "commission.update", { id: c.req.valid("param").id, version: ifMatch(c), patch: c.req.valid("json") });
    return send(c, commissionOut(result));
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "delete", path: "/commissions/{id}", tags: ["collectors"], summary: "Delete a commission (soft; can be undone)",
    request: { params: PathId, headers: IfMatchHeader },
    responses: { 200: json(Commission), 401: errors[401], 403: errors[403], 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const { result } = await run<Snapshot>(c, "commission.delete", { id: c.req.valid("param").id, version: ifMatch(c) });
    return send(c, commissionOut(result));
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "get", path: "/followers", tags: ["collectors"], summary: "Who follows the studio, newest first, and where they followed from",
    responses: { 200: json(z.object({ items: z.array(Follower) })), 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "clients:read");
    const { results } = await c.env.DB.prepare(
      `SELECT f.*, s.name AS show_name FROM followers f LEFT JOIN shows s ON s.id = f.show_id AND s.studio_id = f.studio_id
       WHERE f.studio_id = ? AND f.deleted_at IS NULL ORDER BY f.created_at DESC LIMIT 1000`,
    ).bind(actor.studioId).all<Row>();
    return send(c, {
      items: results.map((r) => ({
        id: r.id as string, email: r.email as string, clientId: (r.client_id as string | null) ?? null, showId: (r.show_id as string | null) ?? null,
        showName: (r.show_name as string | null) ?? null, verifiedAt: (r.verified_at as string | null) ?? null,
        unsubscribedAt: (r.unsubscribed_at as string | null) ?? null, createdAt: r.created_at as string,
      })),
    });
  },
);

// ------------------------------------------------------------------ public: helpers

/** A public answer's pictures, served through this page's token instead of the public picture route. */
function viaToken(slug: string, kind: "collectors" | "followers", token: string, w: ReturnType<typeof publicWork>) {
  const from = `/v1/public/studios/${slug}/images/`, to = `/v1/public/studios/${slug}/${kind}/${token}/images/`;
  return { ...w, images: w.images.map((i) => ({ ...i, sizes: i.sizes.map((s) => ({ ...s, url: s.url.replace(from, to) })) })) };
}

async function firstLookWorks(c: Context<AppEnv>, studioId: string, slug: string, kind: "collectors" | "followers", token: string) {
  const { results } = await c.env.DB.prepare(
    `SELECT ${COLS}, public_from FROM artworks WHERE studio_id = ? AND kind = 'work' AND public = 1 AND deleted_at IS NULL AND ${inFirstLook()}
     ORDER BY public_from LIMIT 24`,
  ).bind(studioId).all<Row>();
  const files = await filesOf(c, studioId, results.map((r) => r.id as string));
  return results.map((r) => ({ ...viaToken(slug, kind, token, publicWork(slug, r, files.get(r.id as string) ?? [])), publicFrom: r.public_from as string }));
}

/** One picture of a work this token may see: a collector's own works and first look; a follower's first look. */
async function tokenPicture(c: Context<AppEnv>, studioId: string, fileId: string, file: string, ownerId: string | null) {
  const m = /^(\d{2,4})\.webp$/.exec(file);
  if (!m || !/^[A-Za-z0-9]{26}$/.test(fileId)) throw notFound("Picture");
  const width = Number(m[1]);
  const row = await c.env.DB.prepare(
    `SELECT f.r2_key AS r2_key, f.meta AS meta FROM files f JOIN artworks a ON a.id = f.entity_id AND a.studio_id = f.studio_id
     WHERE f.id = ? AND f.studio_id = ? AND f.status = 'ready' AND f.deleted_at IS NULL AND f.locked = 0 AND f.kind = 'photo' AND f.entity_type = 'artwork'
     AND a.deleted_at IS NULL AND a.kind = 'work' AND (
       (a.public = 1 AND ${inFirstLook("a.")})
       ${ownerId ? "OR (a.status = 'sold' AND json_extract(a.meta, '$.sale.clientId') = ?)" : ""}
     )`,
  ).bind(fileId, studioId, ...(ownerId ? [ownerId] : [])).first<Row>();
  const sizes = Array.isArray(parse<Row>(row?.meta, {}).sizes) ? (parse<Row>(row?.meta, {}).sizes as Row[]).map((s) => Number(s.width)) : [];
  if (!row || !sizes.includes(width)) throw notFound("Picture");
  const obj = await c.env.FILES.get(sizeKey(row.r2_key as string, width));
  if (!obj) throw notFound("Picture");
  return new Response(obj.body, {
    headers: { "content-type": "image/webp", "x-content-type-options": "nosniff", "cache-control": "private, max-age=3600" },
  }) as never;
}

const ImageParams = TokenParam.extend({
  fileId: z.string().meta({ param: { name: "fileId", in: "path" } }),
  file: z.string().meta({ param: { name: "file", in: "path" }, description: "`480.webp`, `960.webp` or `1600.webp`" }),
});
const picture200 = { description: "The picture", content: { "image/webp": { schema: { type: "string" as const, format: "binary" } } } };

// ------------------------------------------------------------------ public: a collector's page (D-163)

collectorRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/collectors/{token}`, tags: ["collectors-public"], security: [],
    summary: "A collector's page: their first name, the works they own with certificates, care notes, first look and their commissions (unlisted)",
    request: { params: TokenParam },
    responses: { 200: json(PublicCollectorPage), 404: errors[404] },
  }),
  async (c) => {
    const { slug, token } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    const found = await linkByToken(c.env, studio.id, token);
    if (!found) throw notFound("Page");
    const { site, name } = await siteFor(c.env, studio.id);
    const clientId = found.client.id as string;
    const { results: owned } = await c.env.DB.prepare(
      `SELECT ${COLS}, meta, created_at FROM artworks WHERE studio_id = ? AND ${OWNED} ORDER BY updated_at DESC LIMIT 100`,
    ).bind(studio.id, clientId).all<Row>();
    const files = await filesOf(c, studio.id, owned.map((r) => r.id as string));
    const works = owned.map((r) => {
      const w = viaToken(slug, "collectors", token, publicWork(slug, r, files.get(r.id as string) ?? []));
      const soldAt = (parse<Row>(r.meta, {}).sale as Row | undefined)?.soldAt as string | null | undefined;
      return {
        ...w, slug: (r.slug as string | null) ?? "",
        certificate: certificateNumber(name, { id: r.id as string, year: r.year as number | null, createdAt: r.created_at as string }),
        soldOn: soldAt ? soldAt.slice(0, 10) : null,
      };
    });
    const { results: cms } = await c.env.DB.prepare(
      "SELECT * FROM commissions WHERE studio_id = ? AND client_id = ? AND deleted_at IS NULL AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 10",
    ).bind(studio.id, clientId).all<Row>();
    return noStore({
      firstName: firstName(found.client.name as string), studioName: name, works, care: collectorSettings(site).care,
      firstLook: await firstLookWorks(c, studio.id, slug, "collectors", token),
      commissions: cms.map((r) => {
        const o = commissionOut(r);
        return { title: o.title, size: o.size, stage: o.stage, status: o.status, notes: o.notes, dueOn: o.dueOn, updatedAt: o.updatedAt };
      }),
      catalogueVersion: studio.version,
    } satisfies z.infer<typeof PublicCollectorPage>);
  },
);

/** Runs a visitor's internal action as that visitor. */
function asVisitor<R>(c: Context<AppEnv>, studioId: string, visitorId: string, name: string, input: unknown) {
  return runAction<R>(getAction(name) as never, input, { env: c.env, actor: visitorActor(studioId, visitorId), origin: new URL(c.req.url).origin, source: "app" });
}

collectorRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/collectors/{token}/visit`, tags: ["collectors-public"], security: [],
    summary: "The collector's page was opened in this browser: it sees first look while the link is live (D-165)",
    request: { params: TokenParam, headers: KeyHeader },
    responses: { 204: { description: "Done" }, 400: errors[400], 404: errors[404] },
  }),
  async (c) => {
    const { slug, token } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    const found = await linkByToken(c.env, studio.id, token);
    if (!found) throw notFound("Page");
    const v = await visitorFor(c.env, studio.id, c.req.header("x-visitor-key") ?? "", true);
    if (!v) throw new HttpError("bad_request", "Reload the page and try again.");
    await asVisitor(c, studio.id, v.id, "collector.visit", { visitorId: v.id, linkId: found.link.id });
    return c.body(null, 204) as never;
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/collectors/{token}/images/{fileId}/{file}`, tags: ["collectors-public"], security: [],
    summary: "A picture of a work on this collector's page (their own works, first look)",
    request: { params: ImageParams },
    responses: { 200: picture200, 404: errors[404] },
  }),
  async (c) => {
    const { slug, token, fileId, file } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    const found = await linkByToken(c.env, studio.id, token);
    if (!found) throw notFound("Picture");
    return tokenPicture(c, studio.id, fileId, file, found.client.id as string);
  },
);

// ------------------------------------------------------------------ public: following (D-163)

const CODE_TTL = 15 * 60, CODE_TRIES = 6, CODES_PER_HOUR = 5;
const codeKey = (studioId: string, email: string) => `follow:${studioId}:${email}`;

collectorRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/follow/email-code`, tags: ["collectors-public"], security: [],
    summary: "Follow the studio: email a six-digit code to prove the address (204 for any address)",
    request: { params: SlugParam, headers: KeyHeader, body: body(FollowCodeInput) },
    responses: { 204: { description: "Sent" }, 400: errors[400], 404: errors[404], 429: err("Too many codes") },
  }),
  async (c) => {
    const studio = await studioOf(c, c.req.valid("param").slug);
    const b = c.req.valid("json");
    // The hidden trap (as D-133): a person never fills it.
    if (b.website) return c.body(null, 204) as never;
    // Only a browser the site knows may ask (as the visitor's own email code, D-131).
    if (!(await visitorFor(c.env, studio.id, c.req.header("x-visitor-key") ?? "", true))) throw new HttpError("bad_request", "Reload the page and try again.");
    const email = b.email.toLowerCase();
    const key = codeKey(studio.id, email);
    const prev = await c.env.DB.prepare("SELECT sends, created_at FROM login_codes WHERE email = ?").bind(key).first<Row>();
    const hourOpen = !!prev && Date.parse(prev.created_at as string) > Date.now() - 3_600_000;
    if (prev && hourOpen && Number(prev.sends) >= CODES_PER_HOUR) throw new HttpError("rate_limited", "That's 5 codes this hour. Use the newest one.");
    await claimCodeSend(c.env, studio.id, c.req.header("cf-connecting-ip"));
    const code = sixDigitCode();
    await c.env.DB.prepare(
      `INSERT INTO login_codes (email, code_hash, attempts, expires_at, created_at, sends) VALUES (?, ?, 0, ?, ?, 1)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at,
         created_at = CASE WHEN ? THEN login_codes.created_at ELSE excluded.created_at END,
         sends = CASE WHEN ? THEN login_codes.sends + 1 ELSE 1 END`,
    ).bind(key, await sha256(code + key), inSeconds(CODE_TTL), nowIso(), hourOpen ? 1 : 0, hourOpen ? 1 : 0).run();
    const { name } = await siteFor(c.env, studio.id);
    await sendFollowCode(c.env, studio.id, { to: email, studioName: name, code });
    return c.body(null, 204) as never;
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/follow/verify`, tags: ["collectors-public"], security: [],
    summary: "Follow the studio: the code proves the email; this browser sees first look. Answers the follower's own page",
    request: { params: SlugParam, headers: KeyHeader, body: body(FollowVerifyInput) },
    responses: { 200: json(z.object({ path: z.string() })), 400: errors[400], 404: errors[404], 429: err("Too many tries") },
  }),
  async (c) => {
    const studio = await studioOf(c, c.req.valid("param").slug);
    const b = c.req.valid("json");
    const email = b.email.toLowerCase();
    const key = codeKey(studio.id, email);
    const row = await c.env.DB.prepare("SELECT code_hash, attempts, expires_at FROM login_codes WHERE email = ?").bind(key).first<Row>();
    if (!row || (row.expires_at as string) < nowIso()) throw new HttpError("bad_request", "That code expired. Ask for a new one.");
    if (Number(row.attempts) >= CODE_TRIES) throw new HttpError("rate_limited", "Too many tries. Ask for a new code.");
    if (!safeEqual(row.code_hash as string, await sha256(b.code + key))) {
      await c.env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?").bind(key).run();
      throw new HttpError("bad_request", "That code is not right.");
    }
    await c.env.DB.prepare("DELETE FROM login_codes WHERE email = ?").bind(key).run();
    const v = await visitorFor(c.env, studio.id, c.req.header("x-visitor-key") ?? "", true);
    if (!v) throw new HttpError("bad_request", "Reload the page and try again.");
    await asVisitor(c, studio.id, v.id, "follow.verify", { visitorId: v.id, email, showId: b.showId ?? null });
    const f = await c.env.DB.prepare("SELECT token FROM followers WHERE studio_id = ? AND email = ?").bind(studio.id, email).first<{ token: string }>();
    return noStore({ path: followerPath(f!.token) });
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/followers/{token}`, tags: ["collectors-public"], security: [],
    summary: "A follower's page: first look while they follow (unlisted)",
    request: { params: TokenParam },
    responses: { 200: json(PublicFollowerPage), 404: errors[404] },
  }),
  async (c) => {
    const { slug, token } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    const f = await followerByToken(c.env, studio.id, token);
    if (!f || !f.verified_at) throw notFound("Page");
    const { name } = await siteFor(c.env, studio.id);
    const following = !f.unsubscribed_at;
    const [user, domain] = String(f.email).split("@");
    return noStore({
      email: `${user!.slice(0, 2)}…@${domain}`, following, studioName: name,
      firstLook: following ? await firstLookWorks(c, studio.id, slug, "followers", token) : [],
    } satisfies z.infer<typeof PublicFollowerPage>);
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/followers/{token}/stop`, tags: ["collectors-public"], security: [],
    summary: "Stop following: no more emails, and first look ends",
    request: { params: TokenParam },
    responses: { 204: { description: "Stopped" }, 404: errors[404] },
  }),
  async (c) => {
    const { slug, token } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    const f = await followerByToken(c.env, studio.id, token);
    if (!f) throw notFound("Page");
    await asVisitor(c, studio.id, f.id as string, "follow.stop", { followerId: f.id });
    return c.body(null, 204) as never;
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/followers/{token}/images/{fileId}/{file}`, tags: ["collectors-public"], security: [],
    summary: "A picture of a work in first look, for a follower",
    request: { params: ImageParams },
    responses: { 200: picture200, 404: errors[404] },
  }),
  async (c) => {
    const { slug, token, fileId, file } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    const f = await followerByToken(c.env, studio.id, token);
    if (!f || !f.verified_at || f.unsubscribed_at) throw notFound("Picture");
    return tokenPicture(c, studio.id, fileId, file, null);
  },
);

collectorRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/shows/{id}`, tags: ["collectors-public"], security: [],
    summary: "A show's name and dates, for the follow page its QR code opens",
    request: { params: SlugParam.extend({ id: z.string().meta({ param: { name: "id", in: "path" } }) }) },
    responses: { 200: json(PublicShow), 404: errors[404] },
  }),
  async (c) => {
    const { slug, id } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) throw notFound("Show");
    const s = await c.env.DB.prepare("SELECT id, name, venue, city, starts_on, ends_on FROM shows WHERE studio_id = ? AND id = ? AND deleted_at IS NULL AND status <> 'cancelled'")
      .bind(studio.id, id).first<Row>();
    if (!s) throw notFound("Show");
    return new Response(JSON.stringify({
      id: s.id as string, name: s.name as string, venue: (s.venue as string | null) ?? null, city: (s.city as string | null) ?? null,
      startsOn: (s.starts_on as string | null) ?? null, endsOn: (s.ends_on as string | null) ?? null,
    } satisfies z.infer<typeof PublicShow>), { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } }) as never;
  },
);

// Unused-import guard: `live` documents that public queries elsewhere hide first look.
void live;
void liveLink;
