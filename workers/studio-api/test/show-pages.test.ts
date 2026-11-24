// Show pages on the studio's site (D-182): a show's page is the artist's to publish, lists only public works and
// public photos, never the fee, notes or sale prices, and never another studio's.
import { beforeAll, describe, expect, it } from "vitest";
import { ASSISTANT, call, makeStudio, type Studio } from "./helpers";
import { makeWork, studioSlug } from "./catalogue-helpers";

let A: Studio, B: Studio, slugA: string, slugB: string;
const P = (slug: string) => `/v1/public/studios/${slug}`;
const act = (cookie: string, name: string, json: unknown) => call(`/v1/actions/${name}`, { method: "POST", cookie, json });
const getShow = async (s: Studio, id: string) => (await call(`/v1/shows/${id}`, { cookie: s.cookie })).data;
const version = async (slug: string) => (await call(`${P(slug)}/collections`)).data.catalogueVersion as number;
const setPage = async (s: Studio, showId: string, change: Record<string, unknown>) => {
  const show = await getShow(s, showId);
  return act(s.cookie, "show.set_page", { showId, version: show.version, ...change });
};
const w: Record<string, any> = {};
let show: any, older: any;

beforeAll(async () => {
  A = await makeStudio("A");
  B = await makeStudio("B");
  slugA = await studioSlug(A.studioId);
  slugB = await studioSlug(B.studioId);
  show = (await call("/v1/shows", { method: "POST", cookie: A.cookie, json: {
    name: "Red Dot Miami", venue: "Mana Wynwood", city: "Miami", startsOn: "2026-12-02", endsOn: "2026-12-06",
    booth: "A14", feeCents: 650000, notes: "PRIVATE-NOTES", status: "accepted", meta: { url: "https://reddotmiami.com/" },
  } })).data;
  older = (await call("/v1/shows", { method: "POST", cookie: A.cookie, json: { name: "Coconut Grove Arts Festival", city: "Miami", startsOn: "2026-02-14" } })).data;
  w.heron = await makeWork(A, { title: "Heron" }, { publish: true });
  w.egret = await makeWork(A, { title: "Egret", priceCents: 90000 }, { publish: true });
  w.draft = await makeWork(A, { title: "Draft piece" });
  w.booth = await makeWork(A, { title: "Red Dot booth", kind: "site_photo" }, { publish: true });
  w.boothDraft = await makeWork(A, { title: "Booth, not public", kind: "site_photo" });
  w.bPhoto = await makeWork(B, { title: "B's photo", kind: "site_photo" }, { publish: true });
  for (const x of [w.heron, w.egret, w.draft]) await act(A.cookie, "show.add_artwork", { showId: show.id, artworkId: x.work.id });
  await act(A.cookie, "artwork.mark_sold", { artworkId: w.egret.work.id, priceCents: 85000, showId: show.id });
});

describe("show.set_page", () => {
  it("nothing is public until the artist publishes; the address defaults to the name and year", async () => {
    expect((await call(`${P(slugA)}/show-pages`)).data.items).toEqual([]);
    const res = await setPage(A, show.id, { photos: [w.booth.work.id, w.boothDraft.work.id] });
    expect(res.status).toBe(200);
    expect(res.data.result.meta.publicPage).toEqual({
      published: false, slug: "red-dot-miami-2026", description: null, photos: [w.booth.work.id, w.boothDraft.work.id],
    });
    expect(res.data.result.meta.url).toBe("https://reddotmiami.com/"); // the tracker's meta stays
    expect((await call(`${P(slugA)}/show-pages`)).data.items).toEqual([]);
    expect((await call(`${P(slugA)}/show-pages/red-dot-miami-2026`)).status).toBe(404);
  });

  it("publishing bumps the catalogue version, so the site's pages move on", async () => {
    const before = await version(slugA);
    const res = await setPage(A, show.id, { published: true, description: "Booth A14, five days in Wynwood." });
    expect(res.status).toBe(200);
    expect(await version(slugA)).toBeGreaterThan(before);
  });

  it("refuses an address another show uses, a photo of another studio, a stale version and a bad slug", async () => {
    expect((await setPage(A, older.id, { slug: "red-dot-miami-2026" })).status).toBe(400);
    expect((await setPage(A, older.id, { photos: [w.bPhoto.work.id] })).status).toBe(400);
    expect((await setPage(A, older.id, { slug: "Not A Slug" })).status).toBe(400);
    expect((await act(A.cookie, "show.set_page", { showId: older.id, version: 99, published: true })).status).toBe(409);
    // B can't touch A's show at all.
    expect((await act(B.cookie, "show.set_page", { showId: show.id, version: 1, published: false })).status).toBe(404);
  });

  it("the assistant can't publish a show page", async () => {
    const cur = await getShow(A, older.id);
    const res = await call("/v1/assistant/act", { method: "POST", cookie: A.cookie, headers: ASSISTANT,
      json: { action: "show.set_page", input: { showId: older.id, version: cur.version, published: true }, summary: "x" } });
    expect([400, 403, 404]).toContain(res.status);
    expect((await getShow(A, older.id)).meta.publicPage).toBeUndefined();
  });

  it("a show update or a sync keeps the page as it is", async () => {
    const cur = await getShow(A, show.id);
    const up = await call(`/v1/shows/${show.id}`, { method: "PATCH", cookie: A.cookie, headers: { "If-Match": String(cur.version) },
      json: { booth: "A15", meta: { url: "https://reddotmiami.com/", publicPage: { published: false, slug: "x", description: null, photos: [] } } } });
    expect(up.status).toBe(200);
    expect(up.data.meta.publicPage).toMatchObject({ published: true, slug: "red-dot-miami-2026" });
    const back = await call(`/v1/shows/${show.id}`, { method: "PATCH", cookie: A.cookie, headers: { "If-Match": String(up.data.version) }, json: { booth: "A14" } });
    expect(back.data.meta.publicPage.published).toBe(true);
  });
});

describe("public show pages", () => {
  it("lists published shows with place, dates, booth and a cover, and nothing private", async () => {
    await setPage(A, older.id, { published: true });
    const list = await call(`${P(slugA)}/show-pages`);
    expect(list.status).toBe(200);
    expect(list.data.items.map((x: any) => x.slug)).toEqual(["red-dot-miami-2026", "coconut-grove-arts-festival-2026"]);
    expect(list.data.items[0]).toMatchObject({
      name: "Red Dot Miami", venue: "Mana Wynwood", city: "Miami", startsOn: "2026-12-02", endsOn: "2026-12-06", booth: "A14",
      workCount: 2, photoCount: 1,
    });
    expect(list.data.items[0].cover.fileId).toBe(w.booth.file.id);
    expect(list.data.items[1]).toMatchObject({ workCount: 0, photoCount: 0, cover: null });
    const raw = JSON.stringify(list.data);
    for (const secret of ["PRIVATE-NOTES", "650000", "85000", "feeCents", "status"]) expect(raw).not.toContain(secret);
  });

  it("one show: its words, only public photos in order, and the public works it brought, sold ones too", async () => {
    const res = await call(`${P(slugA)}/show-pages/red-dot-miami-2026`);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ name: "Red Dot Miami", description: "Booth A14, five days in Wynwood.", website: "https://reddotmiami.com/" });
    expect(res.data.photos.map((p: any) => p.title)).toEqual(["Red Dot booth"]);
    expect(res.data.photos[0].sizes[0].url).toMatch(new RegExp(`^/v1/public/studios/${slugA}/images/`));
    expect(res.data.works.map((x: any) => x.title)).toEqual(["Heron", "Egret"]);
    expect(res.data.works.find((x: any) => x.title === "Egret")).toMatchObject({ status: "sold", priceCents: null });
    expect(JSON.stringify(res.data)).not.toContain("85000");
  });

  it("adding a work to the show bumps the catalogue version", async () => {
    const before = await version(slugA);
    const extra = await makeWork(A, { title: "Ibis" }, { publish: true });
    await act(A.cookie, "show.add_artwork", { showId: show.id, artworkId: extra.work.id });
    expect(await version(slugA)).toBeGreaterThan(before);
    expect((await call(`${P(slugA)}/show-pages/red-dot-miami-2026`)).data.works.map((x: any) => x.title)).toContain("Ibis");
  });

  it("an unpublished, deleted, cancelled or other studio's show is not found", async () => {
    expect((await call(`${P(slugB)}/show-pages/red-dot-miami-2026`)).status).toBe(404);
    expect((await call(`${P(slugB)}/show-pages`)).data.items).toEqual([]);
    expect((await call(`${P(slugA)}/show-pages/NOT_A_SLUG`)).status).toBe(404);
    await setPage(A, older.id, { published: false });
    expect((await call(`${P(slugA)}/show-pages/coconut-grove-arts-festival-2026`)).status).toBe(404);
    await setPage(A, older.id, { published: true });
    const cur = await getShow(A, older.id);
    await call(`/v1/shows/${older.id}`, { method: "PATCH", cookie: A.cookie, headers: { "If-Match": String(cur.version) }, json: { status: "cancelled" } });
    expect((await call(`${P(slugA)}/show-pages/coconut-grove-arts-festival-2026`)).status).toBe(404);
    const now = await getShow(A, older.id);
    await call(`/v1/shows/${older.id}`, { method: "DELETE", cookie: A.cookie, headers: { "If-Match": String(now.version) } });
    expect((await call(`${P(slugA)}/show-pages`)).data.items.map((x: any) => x.slug)).toEqual(["red-dot-miami-2026"]);
  });
});
