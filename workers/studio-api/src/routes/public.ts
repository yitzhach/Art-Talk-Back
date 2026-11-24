// The public catalogue (Site 3.0 stage 1, D-104…D-110) and the studio's site profile and photos (stage 2,
// D-118, D-119): read-only routes anyone may call, no sign-in.
// The studio comes from the path's slug and nothing else; a cookie changes nothing. A work shows only
// when it is public and not deleted, a picture only when it is ready, unlocked and has that size.
// Rows are turned into answers field by field, never spread, so a new column can't leak.
import {
  ArtworkKind, ArtworkStatus, IMAGE_WIDTHS, PublicArtwork, PublicArtworkDetail, PublicArtworkList, PublicCollections, PublicShowDetail,
  PublicShowList, PublicShowSummary, PublicSitePhotos, PublicStudio, ShowPage, SitePlace, SiteProfile, Slug,
} from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { sizeKey } from "../actions/files";
import type { AppEnv } from "../env";
import { live } from "../lib/collectors";
import { notFound } from "../lib/errors";
import { publicWorkShipping, shippingOf } from "../lib/shipping";
import { siteFor } from "../lib/site-mail";
import type { Shipping } from "@studio/core";
import { errors, json, newApp } from "./common";

export const publicRoutes = newApp();

const PAGE = 48;
const COLOUR_SCAN = 2000;
const MIN_SHARE = 500; // basis points: a swatch must cover at least 5% of the cover
const MAX_DELTA_E = 30;

const SlugParam = z.object({ slug: z.string().meta({ param: { name: "slug", in: "path" } }) });
const P = "/public/studios/{slug}";

type Row = Record<string, unknown>;
export const parse = <T>(v: unknown, fallback: T): T => {
  try { return typeof v === "string" ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};

const reply = (c: Context<AppEnv>, data: unknown, version: number): never =>
  new Response(JSON.stringify({ ...(data as object), catalogueVersion: version }), {
    status: 200, headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
  }) as never;

export async function studioOf(c: Context<AppEnv>, slug: string): Promise<{ id: string; version: number; name: string }> {
  if (!Slug.safeParse(slug).success && !/^[A-Za-z0-9_-]{1,100}$/.test(slug)) throw notFound("Studio");
  const row = await c.env.DB.prepare("SELECT id, name, catalogue_version FROM studios WHERE slug = ? AND deleted_at IS NULL").bind(slug).first<Row>();
  if (!row) throw notFound("Studio");
  return { id: row.id as string, version: Number(row.catalogue_version ?? 0), name: row.name as string };
}

// ------------------------------------------------------------------ colour

const lab = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const lin = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const [r, g, b] = lin;
  const xyz = [
    (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883,
  ];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = xyz.map(f) as [number, number, number];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const deltaE = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The smallest distance from the wanted colour to a real swatch (share ≥ 5%) of the palette, or null. */
function bestMatch(palette: { hex: string; share: number }[], want: [number, number, number]): number | null {
  let best: number | null = null;
  for (const s of palette) {
    if (!(s.share >= MIN_SHARE) || !/^#[0-9a-f]{6}$/i.test(s.hex)) continue;
    const d = deltaE(lab(s.hex), want);
    if (d <= MAX_DELTA_E && (best === null || d < best)) best = d;
  }
  return best;
}

// ------------------------------------------------------------------ mapping

export const imageUrl = (slug: string, fileId: string, width: number) => `/v1/public/studios/${slug}/images/${fileId}/${width}.webp`;
const WIDTHS = new Set<number>(IMAGE_WIDTHS);
const sizesOf = (meta: Row): number[] => {
  const raw = meta.sizes;
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => Number((s as Row)?.width)).filter((w) => WIDTHS.has(w)).sort((a, b) => a - b);
};

/** A record's pictures that have web sizes: the cover first, then by position. */
function imagesOf(slug: string, files: Row[], cover: string | null): z.infer<typeof PublicArtwork>["images"] {
  return files
    .map((f) => ({ f, meta: parse<Row>(f.meta, {}) }))
    .map((x) => ({ ...x, widths: sizesOf(x.meta) }))
    .filter((x) => x.widths.length > 0)
    .sort((p, q) =>
      Number(q.f.id === cover) - Number(p.f.id === cover) ||
      Number(p.f.position) - Number(q.f.position) || String(p.f.id).localeCompare(String(q.f.id)))
    .map(({ f, meta, widths }) => {
      const px = meta.pixels as { width?: number; height?: number } | undefined;
      const ratio = px && px.width && px.height ? px.width / px.height : null;
      return {
        fileId: f.id as string,
        altText: (f.alt_text as string | null) ?? null,
        aspectRatio: ratio && ratio > 0 ? ratio : null,
        sizes: widths.map((w) => ({ width: w as 480 | 960 | 1600, url: imageUrl(slug, f.id as string, w) })),
      };
    });
}

export function publicWork(slug: string, a: Row, files: Row[], ship?: Shipping): z.infer<typeof PublicArtwork> {
  const priced = a.status === "available" && a.price_cents !== null && a.price_cents !== undefined;
  const cover = a.primary_file_id as string | null;
  const images = imagesOf(slug, files, cover);
  return {
    slug: a.slug as string,
    title: a.title as string,
    medium: (a.medium as string | null) ?? null,
    year: (a.year as number | null) ?? null,
    width: (a.width as number | null) ?? null,
    height: (a.height as number | null) ?? null,
    depth: (a.depth as number | null) ?? null,
    sizeUnit: a.size_unit as "in" | "cm",
    editionSize: (a.edition_size as number | null) ?? null,
    collection: (a.collection as string | null) ?? null,
    tags: parse<string[]>(a.tags, []),
    palette: parse<{ hex: string; share: number }[]>(a.palette, []),
    description: (a.description as string | null) ?? null,
    status: a.status as z.infer<typeof ArtworkStatus>,
    priceCents: priced ? (a.price_cents as number) : null,
    currency: priced ? (a.currency as "USD") : null,
    images,
    publishedAt: (a.published_at as string | null) ?? null,
    shipping: a.status === "available" ? publicWorkShipping(a, ship) : null,
  } as z.infer<typeof PublicArtwork>;
}

/** The ready, unlocked, undeleted pictures of these works, in one query. */
export async function filesOf(c: Context<AppEnv>, studioId: string, ids: string[]): Promise<Map<string, Row[]>> {
  const out = new Map<string, Row[]>();
  // D1 binds at most 100 values a query; a page of works is 48, a site's places up to 480 ids.
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const { results } = await c.env.DB.prepare(
      `SELECT id, entity_id, position, alt_text, meta FROM files WHERE studio_id = ? AND entity_type = 'artwork' AND status = 'ready'
       AND locked = 0 AND kind = 'photo' AND deleted_at IS NULL AND entity_id IN (${part.map(() => "?").join(",")})`,
    ).bind(studioId, ...part).all<Row>();
    for (const f of results) {
      const k = f.entity_id as string;
      out.set(k, [...(out.get(k) ?? []), f]);
    }
  }
  return out;
}

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = <T>(s: string): T | null => {
  try { return JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/"))) as T; } catch { return null; }
};

export const COLS = "id, title, medium, year, width, height, depth, size_unit, price_cents, currency, status, description, primary_file_id, slug, collection, tags, palette, edition_size, published_at, shipping";

// ------------------------------------------------------------------ routes

const Query = z.object({
  /** Works by default; site photos (D-118) only when asked. */
  kind: ArtworkKind.default("work"),
  status: ArtworkStatus.optional(),
  collection: z.string().max(80).optional(),
  tag: z.string().max(40).optional(),
  colour: z.string().regex(/^#?[0-9a-fA-F]{6}$/, "A hex colour like #c03020").optional(),
  cursor: z.string().max(500).optional(),
});

publicRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/artworks`, tags: ["public"], summary: "A studio's public works, newest first (no sign-in)",
    security: [], request: { params: SlugParam, query: Query },
    responses: { 200: json(PublicArtworkList), 400: errors[400], 404: errors[404] },
  }),
  async (c) => {
    const { slug } = c.req.valid("param");
    const q = c.req.valid("query");
    const studio = await studioOf(c, slug);
    const where = ["studio_id = ?", "public = 1", "deleted_at IS NULL", "kind = ?", live()];
    const args: unknown[] = [studio.id, q.kind];
    if (q.status) { where.push("status = ?"); args.push(q.status); }
    if (q.collection) { where.push("collection = ?"); args.push(q.collection); }
    if (q.tag) { where.push("EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)"); args.push(q.tag.trim().toLowerCase()); }
    const order = "ORDER BY COALESCE(published_at, '') DESC, id DESC";
    const cur = q.cursor ? unb64<{ p?: string; i?: string; o?: number }>(q.cursor) : null;
    if (q.cursor && !cur) throw notFound("Page");

    let works: Row[];
    let next: string | null = null;
    if (q.colour) {
      const want = lab(`#${q.colour.replace("#", "")}`);
      const { results } = await c.env.DB.prepare(`SELECT ${COLS} FROM artworks WHERE ${where.join(" AND ")} ${order} LIMIT ${COLOUR_SCAN}`)
        .bind(...args).all<Row>();
      const scored = results
        .map((r, n) => ({ r, n, d: bestMatch(parse(r.palette, []), want) }))
        .filter((x): x is { r: Row; n: number; d: number } => x.d !== null)
        .sort((a, b) => a.d - b.d || a.n - b.n);
      const from = Math.max(0, Math.floor(cur?.o ?? 0));
      works = scored.slice(from, from + PAGE).map((x) => x.r);
      if (scored.length > from + PAGE) next = b64({ o: from + PAGE });
    } else {
      if (cur?.i) {
        where.push("(COALESCE(published_at, '') < ? OR (COALESCE(published_at, '') = ? AND id < ?))");
        args.push(cur.p ?? "", cur.p ?? "", cur.i);
      }
      const { results } = await c.env.DB.prepare(`SELECT ${COLS} FROM artworks WHERE ${where.join(" AND ")} ${order} LIMIT ${PAGE + 1}`)
        .bind(...args).all<Row>();
      works = results.slice(0, PAGE);
      const last = works[works.length - 1];
      if (results.length > PAGE && last) next = b64({ p: (last.published_at as string | null) ?? "", i: last.id });
    }
    const files = await filesOf(c, studio.id, works.map((w) => w.id as string));
    const ship = shippingOf((await siteFor(c.env, studio.id)).site);
    return reply(c, { items: works.map((w) => publicWork(slug, w, files.get(w.id as string) ?? [], ship)), nextCursor: next }, studio.version);
  },
);

publicRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/artworks/{artworkSlug}`, tags: ["public"], summary: "One public work (no sign-in)",
    security: [], request: { params: SlugParam.extend({ artworkSlug: z.string().meta({ param: { name: "artworkSlug", in: "path" } }) }) },
    responses: { 200: json(PublicArtworkDetail), 404: errors[404] },
  }),
  async (c) => {
    const { slug, artworkSlug } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    const work = await c.env.DB.prepare(`SELECT ${COLS} FROM artworks WHERE studio_id = ? AND slug = ? AND public = 1 AND deleted_at IS NULL AND kind = 'work' AND ${live()}`)
      .bind(studio.id, artworkSlug).first<Row>();
    if (!work) throw notFound("Work");
    const files = await filesOf(c, studio.id, [work.id as string]);
    const ship = shippingOf((await siteFor(c.env, studio.id)).site);
    return reply(c, publicWork(slug, work, files.get(work.id as string) ?? [], ship), studio.version);
  },
);

publicRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/collections`, tags: ["public"], summary: "A studio's collections, counting public works only (no sign-in)",
    security: [], request: { params: SlugParam },
    responses: { 200: json(PublicCollections), 404: errors[404] },
  }),
  async (c) => {
    const studio = await studioOf(c, c.req.valid("param").slug);
    const { results } = await c.env.DB.prepare(
      `SELECT collection AS name, COUNT(*) AS n FROM artworks WHERE studio_id = ? AND public = 1 AND deleted_at IS NULL AND kind = 'work' AND ${live()} AND collection IS NOT NULL
       GROUP BY collection ORDER BY name COLLATE NOCASE`,
    ).bind(studio.id).all<Row>();
    return reply(c, { items: results.map((r) => ({ name: r.name as string, count: Number(r.n) })) }, studio.version);
  },
);

publicRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/images/{fileId}/{file}`, tags: ["public"],
    summary: "One WebP size of a public work's picture, without hidden data; the path ends in {width}.webp (no sign-in)",
    security: [], request: { params: SlugParam.extend({
      fileId: z.string().meta({ param: { name: "fileId", in: "path" } }),
      file: z.string().meta({ param: { name: "file", in: "path" }, description: "`480.webp`, `960.webp` or `1600.webp`" }),
    }) },
    responses: { 200: { description: "The picture", content: { "image/webp": { schema: { type: "string", format: "binary" } } } }, 404: errors[404] },
  }),
  async (c) => {
    const { slug, fileId, file } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    const m = /^(\d{2,4})\.webp$/.exec(file);
    if (!m || !/^[A-Za-z0-9]{26}$/.test(fileId)) throw notFound("Picture");
    const width = Number(m[1]);
    const row = await c.env.DB.prepare(
      `SELECT f.r2_key AS r2_key, f.meta AS meta FROM files f JOIN artworks a ON a.id = f.entity_id AND a.studio_id = f.studio_id
       WHERE f.id = ? AND f.studio_id = ? AND f.status = 'ready' AND f.deleted_at IS NULL AND f.locked = 0 AND f.kind = 'photo' AND f.entity_type = 'artwork'
       AND a.public = 1 AND a.deleted_at IS NULL AND ${live("a.")}`,
    ).bind(fileId, studio.id).first<Row>();
    if (!row || !sizesOf(parse<Row>(row.meta, {})).includes(width)) throw notFound("Picture");
    const obj = await c.env.FILES.get(sizeKey(row.r2_key as string, width));
    if (!obj) throw notFound("Picture");
    // Checked as WebP and stripped of hidden metadata once, when it was uploaded (D-094, D-109).
    return new Response(obj.body, {
      headers: { "content-type": "image/webp", "x-content-type-options": "nosniff", "cache-control": "public, max-age=86400" },
    }) as never;
  },
);

// ------------------------------------------------------------------ the site (D-118, D-119)

/** The studio's site profile as stored, or an empty one if it was never set or no longer parses. */
export async function siteOf(c: Context<AppEnv>, studioId: string): Promise<{ site: z.infer<typeof SiteProfile>; timezone: string }> {
  const row = await c.env.DB.prepare("SELECT meta, timezone FROM studio_settings WHERE studio_id = ? AND deleted_at IS NULL")
    .bind(studioId).first<Row>();
  const meta = parse<Row>(row?.meta, {});
  const ok = SiteProfile.safeParse(meta.site ?? {});
  return { site: ok.success ? ok.data : {}, timezone: (row?.timezone as string | undefined) ?? "America/New_York" };
}

publicRoutes.openapi(
  createRoute({
    method: "get", path: P, tags: ["public"],
    summary: "A studio's public profile: its site's words and how to reach it, nothing else of its settings (no sign-in)",
    security: [], request: { params: SlugParam },
    responses: { 200: json(PublicStudio), 404: errors[404] },
  }),
  async (c) => {
    const { slug } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    const { site, timezone } = await siteOf(c, studio.id);
    // Field by field: a new SiteProfile field stays private until it is added here (photo places never leave).
    return reply(c, {
      slug,
      name: site.name ?? studio.name,
      tagline: site.tagline ?? null,
      description: site.description ?? null,
      phone: site.phone ?? null,
      email: site.email ?? null,
      hours: site.hours ? { from: site.hours.from, to: site.hours.to } : null,
      timezone,
      pages: site.pages ?? {},
      links: (site.links ?? []).map((l) => ({ label: l.label, url: l.url })),
    } satisfies Omit<z.infer<typeof PublicStudio>, "catalogueVersion">, studio.version);
  },
);

publicRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/site-photos`, tags: ["public"],
    summary: "The photos each place on the studio's site pages shows, in order; only public ones (no sign-in)",
    security: [], request: { params: SlugParam, query: z.object({ place: SitePlace.optional() }) },
    responses: { 200: json(PublicSitePhotos), 400: errors[400], 404: errors[404] },
  }),
  async (c) => {
    const { slug } = c.req.valid("param");
    const { place } = c.req.valid("query");
    const studio = await studioOf(c, slug);
    const { site } = await siteOf(c, studio.id);
    const wanted = Object.entries(site.photos ?? {}).filter(([k]) => !place || k === place);
    const ids = [...new Set(wanted.flatMap(([, v]) => v))];
    const rows = new Map<string, Row>();
    for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90);
      const { results } = await c.env.DB.prepare(
        `SELECT id, title, slug, kind, primary_file_id FROM artworks WHERE studio_id = ? AND public = 1 AND deleted_at IS NULL AND ${live()}
         AND id IN (${part.map(() => "?").join(",")})`,
      ).bind(studio.id, ...part).all<Row>();
      for (const r of results) rows.set(r.id as string, r);
    }
    const files = await filesOf(c, studio.id, [...rows.keys()]);
    const places: Record<string, z.infer<typeof PublicSitePhotos>["places"][string]> = {};
    for (const [name, list] of wanted) {
      places[name] = list.flatMap((id) => {
        const a = rows.get(id);
        const img = a ? imagesOf(slug, files.get(id) ?? [], a.primary_file_id as string | null)[0] : undefined;
        if (!a || !img) return [];
        return [{ ...img, title: a.title as string, workSlug: a.kind === "work" && a.slug ? (a.slug as string) : null }];
      });
    }
    return reply(c, { places }, studio.version);
  },
);

// ------------------------------------------------------------------ show pages (D-182)

type ShowPageT = z.infer<typeof ShowPage>;
/** A show's page, only when it is stored whole and published. */
const pageOf = (meta: unknown): ShowPageT | null => {
  const ok = ShowPage.safeParse(parse<Row>(meta, {}).publicPage);
  return ok.success && ok.data.published ? ok.data : null;
};
const SHOW_COLS = "id, name, venue, city, starts_on, ends_on, booth, meta";
const PUBLISHED = "studio_id = ? AND deleted_at IS NULL AND status <> 'cancelled' AND json_extract(meta, '$.publicPage.published') = 1";

/** The public, live photos among these ids (works or site photos), each with its first picture, in the ids' order. */
async function photosOf(c: Context<AppEnv>, studio: { id: string }, slug: string, ids: string[]) {
  const rows = new Map<string, Row>();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const { results } = await c.env.DB.prepare(
      `SELECT id, title, slug, kind, primary_file_id FROM artworks WHERE studio_id = ? AND public = 1 AND deleted_at IS NULL AND ${live()}
       AND id IN (${part.map(() => "?").join(",")})`,
    ).bind(studio.id, ...part).all<Row>();
    for (const r of results) rows.set(r.id as string, r);
  }
  const files = await filesOf(c, studio.id, [...rows.keys()]);
  const out = new Map<string, z.infer<typeof PublicShowDetail>["photos"][number]>();
  for (const id of ids) {
    const a = rows.get(id);
    const img = a ? imagesOf(slug, files.get(id) ?? [], a.primary_file_id as string | null)[0] : undefined;
    if (a && img) out.set(id, { ...img, title: a.title as string, workSlug: a.kind === "work" && a.slug ? (a.slug as string) : null });
  }
  return out;
}

/** The public works each show brought, in the order they were added (sold ones too: "exactly what I had"). */
async function worksOf(c: Context<AppEnv>, studioId: string, showIds: string[]): Promise<Map<string, Row[]>> {
  const out = new Map<string, Row[]>();
  for (let i = 0; i < showIds.length; i += 90) {
    const part = showIds.slice(i, i + 90);
    const { results } = await c.env.DB.prepare(
      `SELECT sa.show_id AS show_id, ${COLS.split(", ").map((k) => `a.${k}`).join(", ")}
       FROM show_artworks sa JOIN artworks a ON a.id = sa.artwork_id AND a.studio_id = sa.studio_id
       WHERE sa.studio_id = ? AND sa.deleted_at IS NULL AND a.public = 1 AND a.deleted_at IS NULL AND a.kind = 'work' AND ${live("a.")}
       AND sa.show_id IN (${part.map(() => "?").join(",")}) ORDER BY sa.created_at, sa.id`,
    ).bind(studioId, ...part).all<Row>();
    for (const r of results) out.set(r.show_id as string, [...(out.get(r.show_id as string) ?? []), r]);
  }
  return out;
}

const showFields = (s: Row, page: ShowPageT) => ({
  slug: page.slug,
  name: s.name as string,
  venue: (s.venue as string | null) ?? null,
  city: (s.city as string | null) ?? null,
  startsOn: (s.starts_on as string | null) ?? null,
  endsOn: (s.ends_on as string | null) ?? null,
  booth: (s.booth as string | null) ?? null,
});
/** Newest first; a show with no date last. */
const byDate = (a: Row, b: Row) =>
  Number(!a.starts_on) - Number(!b.starts_on) || String(b.starts_on ?? "").localeCompare(String(a.starts_on ?? "")) ||
  String(a.name).localeCompare(String(b.name));

publicRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/show-pages`, tags: ["public"],
    summary: "The studio's published show pages, newest first: name, place, dates, booth and a cover (no sign-in)",
    security: [], request: { params: SlugParam },
    responses: { 200: json(PublicShowList), 404: errors[404] },
  }),
  async (c) => {
    const { slug } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    const { results } = await c.env.DB.prepare(`SELECT ${SHOW_COLS} FROM shows WHERE ${PUBLISHED} LIMIT 500`).bind(studio.id).all<Row>();
    const shows = results.map((s) => ({ s, page: pageOf(s.meta) })).filter((x): x is { s: Row; page: ShowPageT } => !!x.page)
      .sort((x, y) => byDate(x.s, y.s));
    const photos = await photosOf(c, studio, slug, [...new Set(shows.flatMap((x) => x.page.photos))]);
    const works = await worksOf(c, studio.id, shows.map((x) => x.s.id as string));
    const covers = await filesOf(c, studio.id, shows.map((x) => works.get(x.s.id as string)?.[0]?.id as string).filter(Boolean));
    const items = shows.map(({ s, page }): z.infer<typeof PublicShowSummary> => {
      const shown = page.photos.flatMap((id) => photos.get(id) ?? []);
      const list = works.get(s.id as string) ?? [];
      const first = list[0];
      const fromWork = first ? imagesOf(slug, covers.get(first.id as string) ?? [], first.primary_file_id as string | null)[0] : undefined;
      const top = shown[0];
      return {
        ...showFields(s, page),
        cover: top ? { fileId: top.fileId, altText: top.altText, aspectRatio: top.aspectRatio, sizes: top.sizes } : (fromWork ?? null),
        workCount: list.length,
        photoCount: shown.length,
      };
    });
    return reply(c, { items }, studio.version);
  },
);

publicRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/show-pages/{showSlug}`, tags: ["public"],
    summary: "One published show page: its words, booth photos and the public works shown there (no sign-in)",
    security: [], request: { params: SlugParam.extend({ showSlug: z.string().meta({ param: { name: "showSlug", in: "path" } }) }) },
    responses: { 200: json(PublicShowDetail), 404: errors[404] },
  }),
  async (c) => {
    const { slug, showSlug } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    if (!Slug.safeParse(showSlug).success) throw notFound("Show");
    const s = await c.env.DB.prepare(`SELECT ${SHOW_COLS} FROM shows WHERE ${PUBLISHED} AND json_extract(meta, '$.publicPage.slug') = ? LIMIT 1`)
      .bind(studio.id, showSlug).first<Row>();
    const page = s ? pageOf(s.meta) : null;
    if (!s || !page || page.slug !== showSlug) throw notFound("Show");
    const photos = await photosOf(c, studio, slug, page.photos);
    const shown = page.photos.flatMap((id) => photos.get(id) ?? []);
    const list = (await worksOf(c, studio.id, [s.id as string])).get(s.id as string) ?? [];
    const files = await filesOf(c, studio.id, list.map((w) => w.id as string));
    const ship = shippingOf((await siteFor(c.env, studio.id)).site);
    const works = list.map((w) => publicWork(slug, w, files.get(w.id as string) ?? [], ship));
    const url = parse<Row>(s.meta, {}).url;
    const top = shown[0];
    return reply(c, {
      ...showFields(s, page),
      cover: top ? { fileId: top.fileId, altText: top.altText, aspectRatio: top.aspectRatio, sizes: top.sizes } : (works[0]?.images[0] ?? null),
      workCount: works.length,
      photoCount: shown.length,
      description: page.description,
      website: typeof url === "string" && /^https?:\/\/[^\s]+$/.test(url) && url.length <= 500 ? url : null,
      photos: shown,
      works,
    } satisfies Omit<z.infer<typeof PublicShowDetail>, "catalogueVersion">, studio.version);
  },
);
