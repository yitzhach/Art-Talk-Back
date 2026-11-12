// The public catalogue routes (Site 3.0 stage 1, gate item 3): what anyone may see, and never more.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { call, countingEnv, makeStudio, type Studio } from "./helpers";
import { addPicture, makeWork, studioSlug } from "./catalogue-helpers";

let A: Studio, B: Studio, slugA: string, slugB: string;
const P = (slug: string) => `/v1/public/studios/${slug}`;
const patch = (s: Studio, w: any, json: unknown) =>
  call(`/v1/artworks/${w.id}`, { method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(w.version) }, json });
const unpublish = (s: Studio, w: any) => call(`/v1/artworks/${w.id}/unpublish`, { method: "POST", cookie: s.cookie, headers: { "If-Match": String(w.version) } });

const KEYS = ["collection", "currency", "depth", "description", "editionSize", "height", "images", "medium", "palette", "priceCents",
  "publishedAt", "shipping", "sizeUnit", "slug", "status", "tags", "title", "width", "year"];

const w: Record<string, any> = {};

beforeAll(async () => {
  A = await makeStudio("A");
  B = await makeStudio("B");
  slugA = await studioSlug(A.studioId);
  slugB = await studioSlug(B.studioId);
  const red = [{ hex: "#c03020", share: 6000 }, { hex: "#101010", share: 300 }];
  const blue = [{ hex: "#2040c0", share: 7000 }];
  w.heron = (await makeWork(A, { title: "Heron", medium: "Oil", year: 2024, priceCents: 120000, status: "available", collection: "Birds",
    tags: ["bird", "water"], palette: red, inventoryCode: "SECRET-1", description: "Words" }, { publish: true }));
  w.sold = (await makeWork(A, { title: "Sold one", status: "sold", priceCents: 5000, collection: "Birds", tags: ["bird"], palette: blue }, { publish: true }));
  w.free = (await makeWork(A, { title: "Unpriced", status: "available", collection: "Land" }, { publish: true }));
  w.reserved = (await makeWork(A, { title: "Reserved", status: "reserved", priceCents: 900 }, { publish: true }));
  w.draft = (await makeWork(A, { title: "Draft", collection: "Birds" }));
  w.gone = (await makeWork(A, { title: "Gone", collection: "Birds" }, { publish: true }));
  await call(`/v1/artworks/${w.gone.work.id}`, { method: "DELETE", cookie: A.cookie, headers: { "If-Match": String(w.gone.work.version) } });
  w.unpub = (await makeWork(A, { title: "Unpublished", collection: "Birds" }, { publish: true }));
  await unpublish(A, w.unpub.work);
  w.locked = (await makeWork(A, { title: "Locked pic" }, { publish: true }));
  w.lockedExtra = await addPicture(A, w.locked.work.id);
  await call(`/v1/files/${w.lockedExtra.id}`, { method: "PATCH", cookie: A.cookie, headers: { "If-Match": String(w.lockedExtra.version) }, json: { locked: true } });
  w.narrow = (await makeWork(A, { title: "Narrow" }, { publish: true }));
  // Studio B: same titles and slugs.
  w.bHeron = (await makeWork(B, { title: "Heron", collection: "Birds", tags: ["bird"] }, { publish: true }));
  w.bDraft = (await makeWork(B, { title: "Draft" }));
});

describe("public catalogue", () => {
  it("lists only this studio's public, undeleted works, newest first, with a cache header and version", async () => {
    const res = await call(`${P(slugA)}/artworks`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(typeof res.data.catalogueVersion).toBe("number");
    const titles = res.data.items.map((i: any) => i.title);
    expect(titles).toEqual(["Narrow", "Locked pic", "Reserved", "Unpriced", "Sold one", "Heron"]);
    expect(res.data.nextCursor).toBeNull();
    const b = await call(`${P(slugB)}/artworks`);
    expect(b.data.items.map((i: any) => i.title)).toEqual(["Heron"]);
    expect(b.data.items[0].images[0].fileId).toBe(w.bHeron.file.id);
    expect(JSON.stringify(res.data)).not.toContain(w.bHeron.file.id);
  });

  it("leaks nothing: the exact keys, no ids, inventory code, meta or notes", async () => {
    const res = await call(`${P(slugA)}/artworks`);
    const heron = res.data.items.find((i: any) => i.title === "Heron");
    expect(Object.keys(heron).sort()).toEqual(KEYS);
    expect(Object.keys(heron.images[0]).sort()).toEqual(["altText", "aspectRatio", "fileId", "sizes"]);
    const raw = res.raw;
    for (const bad of ["SECRET-1", w.heron.work.id, "inventoryCode", "draftedFields", "createdBy", "actorType", "\"meta\"", "notes"]) expect(raw).not.toContain(bad);
    expect(heron.images[0].aspectRatio).toBeCloseTo(0.75);
    expect(heron.images[0].sizes).toEqual([480, 960, 1600].map((n) => ({ width: n, url: `${P(slugA)}/images/${w.heron.file.id}/${n}.webp` })));
  });

  it("shows a price only for an available priced work", async () => {
    const items = (await call(`${P(slugA)}/artworks`)).data.items;
    const by = (t: string) => items.find((i: any) => i.title === t);
    expect(by("Heron")).toMatchObject({ priceCents: 120000, currency: "USD" });
    expect(by("Sold one")).toMatchObject({ priceCents: null, currency: null });
    expect(by("Reserved")).toMatchObject({ priceCents: null, currency: null });
    expect(by("Unpriced")).toMatchObject({ priceCents: null, currency: null });
  });

  it("hides a locked picture, and a work with none left shows no images", async () => {
    const lockedWork = (await call(`${P(slugA)}/artworks`)).data.items.find((i: any) => i.title === "Locked pic");
    expect(lockedWork.images.map((i: any) => i.fileId)).toEqual([w.locked.file.id]);
    expect((await call(`${P(slugA)}/images/${w.lockedExtra.id}/480.webp`)).status).toBe(404);
  });

  it("one work: public only, in this studio only", async () => {
    const ok = await call(`${P(slugA)}/artworks/${w.heron.work.slug}`);
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.data).sort()).toEqual([...KEYS, "catalogueVersion"].sort());
    expect(ok.data.title).toBe("Heron");
    expect((await call(`${P(slugB)}/artworks/${w.heron.work.slug}`)).data.images[0].fileId).toBe(w.bHeron.file.id);
    for (const missing of [w.draft.work, w.gone.work, w.unpub.work]) {
      const r = await call(`${P(slugA)}/artworks/${missing.slug ?? "draft"}`);
      expect(r.status).toBe(404);
      expect(r.data.error.code).toBe("not_found");
    }
    expect((await call(`${P(slugA)}/artworks/draft`)).status).toBe(404);
    expect((await call(`${P("no-such-studio")}/artworks/heron`)).status).toBe(404);
  });

  it("unknown studio is the normal not_found error", async () => {
    for (const path of ["/artworks", "/collections", `/images/${w.heron.file.id}/480.webp`]) {
      const r = await call(`${P("nobody")}${path}`);
      expect(r.status).toBe(404);
      expect(r.data.error.code).toBe("not_found");
    }
  });

  it("filters by status, collection, tag and colour", async () => {
    const titles = async (q: string) => (await call(`${P(slugA)}/artworks?${q}`)).data.items.map((i: any) => i.title);
    expect(await titles("status=sold")).toEqual(["Sold one"]);
    expect(await titles("collection=Land")).toEqual(["Unpriced"]);
    expect(await titles("collection=land")).toEqual([]);
    expect((await titles("tag=bird")).sort()).toEqual(["Heron", "Sold one"]);
    expect(await titles("tag=BIRD&status=available")).toEqual(["Heron"]);
    expect(await titles("tag=water")).toEqual(["Heron"]);
    expect(await titles(`colour=${encodeURIComponent("#c03020")}`)).toEqual(["Heron"]);
    expect(await titles("colour=d04030")).toEqual(["Heron"]);
    expect(await titles("colour=2040c0")).toEqual(["Sold one"]);
    // The red work's 3% black swatch is too small to match.
    expect(await titles("colour=101010")).toEqual([]);
    expect((await call(`${P(slugA)}/artworks?colour=red`)).status).toBe(400);
    expect((await call(`${P(slugA)}/artworks?status=bogus`)).status).toBe(400);
  });

  it("pages with an opaque cursor", async () => {
    const C = await makeStudio("Pager");
    const slug = await studioSlug(C.studioId);
    for (let i = 0; i < 50; i++) {
      const t = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
      const id = `01J${String(i).padStart(23, "0")}${"ABC"}`.slice(0, 26);
      await env.DB.prepare(
        `INSERT INTO artworks (id, studio_id, title, status, size_unit, currency, created_at, updated_at, created_by, actor_type, version, meta, public, published_at, slug)
         VALUES (?, ?, ?, 'available', 'in', 'USD', ?, ?, 'x', 'user', 1, '{}', 1, ?, ?)`,
      ).bind(id, C.studioId, `Work ${i}`, t, t, t, `work-${i}`).run();
    }
    const first = await call(`${P(slug)}/artworks`);
    expect(first.data.items).toHaveLength(48);
    expect(first.data.items[0].title).toBe("Work 49");
    expect(first.data.nextCursor).toEqual(expect.any(String));
    const second = await call(`${P(slug)}/artworks?cursor=${first.data.nextCursor}`);
    expect(second.data.items.map((i: any) => i.title)).toEqual(["Work 1", "Work 0"]);
    expect(second.data.nextCursor).toBeNull();
    expect((await call(`${P(slug)}/artworks?cursor=%%%`)).status).toBe(404);
  });

  it("collections count public works only", async () => {
    const res = await call(`${P(slugA)}/collections`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.data.items).toEqual([{ name: "Birds", count: 2 }, { name: "Land", count: 1 }]);
    expect(typeof res.data.catalogueVersion).toBe("number");
  });

  it("serves a picture's WebP bytes with the right headers", async () => {
    const res = await app_fetch(`${P(slugA)}/images/${w.heron.file.id}/960.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(new Uint8Array(await res.arrayBuffer()).slice(8, 12)).toEqual(new Uint8Array([0x57, 0x45, 0x42, 0x50]));
  });

  it("pictures 404 unless every condition holds", async () => {
    const f = (slug: string, id: string, file: string) => call(`${P(slug)}/images/${id}/${file}`);
    const unattached = await (async () => {
      const up = await call("/v1/files/upload-url", { method: "POST", cookie: A.cookie, json: { name: "x.jpg", contentType: "image/jpeg", size: 1 } });
      return up.data.file.id as string;
    })();
    const narrow = await addPicture(A, w.narrow.work.id, { widths: [480] });
    const cases: [string, string, string][] = [
      [slugA, w.draft.file.id, "480.webp"],        // a draft's file
      [slugB, w.heron.file.id, "480.webp"],        // another studio's slug
      [slugA, w.bHeron.file.id, "480.webp"],       // another studio's file
      [slugA, w.lockedExtra.id, "480.webp"],       // locked
      [slugA, w.gone.file.id, "480.webp"],         // deleted work
      [slugA, w.unpub.file.id, "480.webp"],        // unpublished work
      [slugA, unattached, "480.webp"],             // unattached
      [slugA, narrow.id, "960.webp"],              // width not uploaded
      [slugA, w.heron.file.id, "700.webp"],        // width not a size
      [slugA, w.heron.file.id, "960.jpg"],         // not a webp path
      [slugA, "not-an-id", "480.webp"],
      ["nobody", w.heron.file.id, "480.webp"],
    ];
    const bodies = new Set<string>();
    for (const [slug, id, file] of cases) {
      const r = await f(slug, id, file);
      expect([slug, id, file, r.status]).toEqual([slug, id, file, 404]);
      bodies.add(r.data.error.code);
    }
    expect([...bodies]).toEqual(["not_found"]);
    expect((await f(slugA, narrow.id, "480.webp")).status).toBe(200);
  });

  it("a guest can't write; owner routes need a session; a cookie changes nothing", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      for (const path of ["/artworks", `/artworks/${w.heron.work.slug}`, "/collections", `/images/${w.heron.file.id}/480.webp`]) {
        const r = await call(`${P(slugA)}${path}`, { method, json: { title: "x" } });
        expect([404, 405]).toContain(r.status);
      }
    }
    expect((await call("/v1/artworks", { method: "POST", json: { title: "x" } })).status).toBe(401);
    expect((await call(`/v1/artworks/${w.heron.work.id}/publish`, { method: "POST", headers: { "If-Match": "1" } })).status).toBe(401);
    // A signed-in cookie from studio B doesn't change what A's catalogue says.
    const plain = await call(`${P(slugA)}/artworks`);
    const withCookie = await call(`${P(slugA)}/artworks`, { cookie: B.cookie });
    expect(withCookie.raw).toBe(plain.raw);
  });

  it("each request runs at most 4 D1 queries", async () => {
    const paths = [`/artworks`, `/artworks?colour=c03020`, `/artworks/${w.heron.work.slug}`, `/collections`, `/images/${w.heron.file.id}/480.webp`];
    for (const p of paths) {
      const { env: counted, count } = countingEnv();
      const r = await call(`${P(slugA)}${p}`, { env: counted });
      expect(r.status).toBe(200);
      expect(count.queries).toBeLessThanOrEqual(4);
    }
  });
});

async function app_fetch(path: string) {
  const { default: app } = await import("../src/index");
  return app.request(`https://api.test${path}`, {}, env);
}
