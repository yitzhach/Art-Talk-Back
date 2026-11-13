// The site (Site 3.0 stage 2, D-118, D-119): site photos are not works, and the studio's public
// profile shows its site's words and contact, never the rest of its settings or another studio's.
import { beforeAll, describe, expect, it } from "vitest";
import { ASSISTANT, call, countingEnv, makeStudio, type Studio } from "./helpers";
import { makeWork, studioSlug } from "./catalogue-helpers";

let A: Studio, B: Studio, slugA: string, slugB: string;
const P = (slug: string) => `/v1/public/studios/${slug}`;
const w: Record<string, any> = {};

const settings = async (s: Studio) => (await call("/v1/settings", { cookie: s.cookie })).data;
const putSite = async (s: Studio, site: unknown, extra: Record<string, unknown> = {}) => {
  const cur = await settings(s);
  return call("/v1/settings", { method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(cur.version) },
    json: { ...extra, meta: { ...cur.meta, site } } });
};
const version = async (slug: string) => (await call(`${P(slug)}/collections`)).data.catalogueVersion as number;

const SITE = {
  name: "Isaac Anderson Art",
  tagline: "Paintings and sculpture",
  description: "Original abstract, figurative and sculptural work.",
  phone: "+15551234567",
  email: "studio@example.com",
  hours: { from: "09:00", to: "18:00" },
  pages: {
    process: { title: "Process", lede: "Five stages", sections: [{ key: "surface", heading: "Surface", body: "First.\n\nSecond.", place: "process.surface" }] },
    about: { title: "About" },
  },
};

beforeAll(async () => {
  A = await makeStudio("A");
  B = await makeStudio("B");
  slugA = await studioSlug(A.studioId);
  slugB = await studioSlug(B.studioId);
  w.work = await makeWork(A, { title: "Heron", collection: "Birds" }, { publish: true });
  w.hero = await makeWork(A, { title: "Hero banner", kind: "site_photo", collection: "Birds" }, { publish: true });
  w.room = await makeWork(A, { title: "Lobby room", kind: "site_photo" }, { publish: true });
  w.draftPhoto = await makeWork(A, { title: "Draft banner", kind: "site_photo" });
  w.gonePhoto = await makeWork(A, { title: "Gone banner", kind: "site_photo" }, { publish: true });
  await call(`/v1/artworks/${w.gonePhoto.work.id}`, { method: "DELETE", cookie: A.cookie, headers: { "If-Match": String(w.gonePhoto.work.version) } });
  w.bPhoto = await makeWork(B, { title: "B's banner", kind: "site_photo" }, { publish: true });
  const put = await putSite(A, {
    ...SITE,
    photos: {
      "home.hero": [w.hero.work.id, w.draftPhoto.work.id, w.gonePhoto.work.id, w.bPhoto.work.id, w.work.work.id],
      "home.rooms": [w.room.work.id],
    },
  }, { signature: "PRIVATE-SIGNATURE", emailTone: "PRIVATE-TONE", depositBps: 4321 });
  if (put.status !== 200) throw new Error(`settings ${put.status} ${put.raw}`);
});

describe("site photos are not works (D-118)", () => {
  it("a work's kind defaults to work and can be changed", async () => {
    expect(w.work.work.kind).toBe("work");
    expect(w.hero.work.kind).toBe("site_photo");
    const made = (await call("/v1/artworks", { method: "POST", cookie: A.cookie, json: { title: "Turn me" } })).data;
    const p = await call(`/v1/artworks/${made.id}`, { method: "PATCH", cookie: A.cookie, headers: { "If-Match": String(made.version) }, json: { kind: "site_photo" } });
    expect(p.status).toBe(200);
    expect(p.data.kind).toBe("site_photo");
    const bad = await call(`/v1/artworks/${made.id}`, { method: "PATCH", cookie: A.cookie, headers: { "If-Match": String(p.data.version) }, json: { kind: "banner" } });
    expect(bad.status).toBe(400);
  });

  it("the public list, one work and collections show works only", async () => {
    const list = (await call(`${P(slugA)}/artworks`)).data.items.map((i: any) => i.title);
    expect(list).toEqual(["Heron"]);
    expect((await call(`${P(slugA)}/artworks/${w.hero.work.slug}`)).status).toBe(404);
    expect((await call(`${P(slugA)}/collections`)).data.items).toEqual([{ name: "Birds", count: 1 }]);
    const photos = (await call(`${P(slugA)}/artworks?kind=site_photo`)).data.items.map((i: any) => i.title);
    expect(photos).toEqual(["Lobby room", "Hero banner"]);
  });

  it("a site photo's picture is served while it is public", async () => {
    const r = await call(`${P(slugA)}/images/${w.hero.file.id}/480.webp`);
    expect(r.status).toBe(200);
    expect((await call(`${P(slugA)}/images/${w.draftPhoto.file.id}/480.webp`)).status).toBe(404);
  });
});

describe("site photos by place", () => {
  it("lists each place's public photos in order; never a draft, a deleted one or another studio's", async () => {
    const res = await call(`${P(slugA)}/site-photos`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const hero = res.data.places["home.hero"];
    expect(hero.map((p: any) => p.title)).toEqual(["Hero banner", "Heron"]);
    expect(hero[0].workSlug).toBeNull();
    expect(hero[1].workSlug).toBe(w.work.work.slug);
    expect(hero[0].fileId).toBe(w.hero.file.id);
    expect(hero[0].sizes.map((s: any) => s.width)).toEqual([480, 960, 1600]);
    expect(hero[0].sizes[0].url).toBe(`/v1/public/studios/${slugA}/images/${w.hero.file.id}/480.webp`);
    expect(Object.keys(hero[0]).sort()).toEqual(["altText", "aspectRatio", "fileId", "sizes", "title", "workSlug"]);
    expect(res.data.places["home.rooms"].map((p: any) => p.title)).toEqual(["Lobby room"]);
    const raw = res.raw;
    for (const id of [w.draftPhoto.work.id, w.gonePhoto.work.id, w.bPhoto.work.id, w.hero.work.id]) expect(raw).not.toContain(id);
  });

  it("one place when asked", async () => {
    const res = await call(`${P(slugA)}/site-photos?place=home.rooms`);
    expect(Object.keys(res.data.places)).toEqual(["home.rooms"]);
    expect((await call(`${P(slugA)}/site-photos?place=Not%20A%20Place`)).status).toBe(400);
  });

  it("a photo taken off the site leaves its place at once", async () => {
    const before = await version(slugA);
    const un = await call(`/v1/artworks/${w.room.work.id}/unpublish`, { method: "POST", cookie: A.cookie, headers: { "If-Match": String(w.room.work.version) } });
    expect(un.status).toBe(200);
    expect(await version(slugA)).toBeGreaterThan(before);
    expect((await call(`${P(slugA)}/site-photos?place=home.rooms`)).data.places["home.rooms"]).toEqual([]);
  });

  it("a studio with no site profile has no places", async () => {
    expect((await call(`${P(slugB)}/site-photos`)).data.places).toEqual({});
  });
});

describe("the public profile (D-119)", () => {
  it("returns the site's words and contact and nothing else of the settings", async () => {
    const res = await call(P(slugA));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const { catalogueVersion, ...rest } = res.data;
    expect(typeof catalogueVersion).toBe("number");
    expect(rest).toEqual({ slug: slugA, ...SITE, timezone: "America/New_York", links: [] });
    for (const secret of ["PRIVATE-SIGNATURE", "PRIVATE-TONE", "4321", "photos", "home.hero", w.hero.work.id]) {
      expect(res.raw).not.toContain(secret);
    }
  });

  it("a studio with no profile shows its name and nulls", async () => {
    const res = (await call(P(slugB))).data;
    expect(res).toMatchObject({ slug: slugB, tagline: null, phone: null, email: null, hours: null, pages: {} });
    expect(typeof res.name).toBe("string");
  });

  it("an unknown studio is not found", async () => {
    expect((await call(P("no-such-studio"))).status).toBe(404);
  });

  it("a profile is checked on the way in, and nothing is saved when it fails", async () => {
    const before = await settings(A);
    for (const bad of [
      { phone: "call me" },
      { email: "not an email" },
      { hours: { from: "9am", to: "6pm" } },
      { pages: { shop: { title: "x" } } },
      { pages: { about: { sections: [{ heading: "x", html: "<b>x</b>" }] } } },
      { photos: { "home.hero": ["not-an-id"] } },
      { photos: { "Bad Place": [] } },
      { secret: "x" },
      "a string",
    ]) {
      const r = await putSite(A, bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.data.error.code).toBe("bad_request");
    }
    const after = await settings(A);
    expect(after.version).toBe(before.version);
    expect(after.meta.site).toEqual(before.meta.site);
  });

  it("takes the trade, privacy and terms pages and shows them publicly once saved (D-175)", async () => {
    const cur = await settings(A);
    const pages = {
      ...cur.meta.site.pages,
      trade: { title: "For designers and architects", lede: "Trade terms", sections: [{ heading: "Pricing", body: "Ask." }] },
      privacy: { title: "Privacy", sections: [{ body: "What we keep." }] },
      terms: { title: "Terms" },
    };
    const v0 = await version(slugA);
    const r = await putSite(A, { ...cur.meta.site, pages });
    expect(r.status, r.raw).toBe(200);
    expect(await version(slugA)).toBeGreaterThan(v0);
    const pub = (await call(P(slugA))).data;
    expect(pub.pages.trade).toEqual(pages.trade);
    expect(pub.pages.privacy).toEqual(pages.privacy);
    expect(pub.pages.terms).toEqual(pages.terms);
    // Put the profile back for the tests after this one.
    expect((await putSite(A, cur.meta.site)).status).toBe(200);
    expect((await call(P(slugA))).data.pages.trade).toBeUndefined();
  });

  it("takes the artist's links, https only, and shows them publicly in order (D-176)", async () => {
    const cur = await settings(A);
    expect((await call(P(slugA))).data.links).toEqual([]);
    const links = [
      { label: "Instagram", url: "https://www.instagram.com/example" },
      { label: "Gallery", url: "https://gallery.example/artists/a" },
    ];
    const v0 = await version(slugA);
    const r = await putSite(A, { ...cur.meta.site, links });
    expect(r.status, r.raw).toBe(200);
    expect(await version(slugA)).toBeGreaterThan(v0);
    expect((await call(P(slugA))).data.links).toEqual(links);
    // Another studio's public profile never carries them.
    expect((await call(P(slugB))).data.links).toEqual([]);
    for (const url of ["http://insecure.example", "javascript:alert(1)", "https://", "instagram.com/x"]) {
      const bad = await putSite(A, { ...cur.meta.site, links: [{ label: "X", url }] });
      expect(bad.status, url).toBe(400);
    }
    expect((await putSite(A, { ...cur.meta.site, links: [{ label: "", url: links[0]!.url }] })).status).toBe(400);
    expect((await putSite(A, cur.meta.site)).status).toBe(200);
    expect((await call(P(slugA))).data.links).toEqual([]);
  });

  it("changing the profile moves the catalogue version; other settings don't", async () => {
    const v0 = await version(slugA);
    const cur = await settings(A);
    await call("/v1/settings", { method: "PATCH", cookie: A.cookie, headers: { "If-Match": String(cur.version) }, json: { signature: "Other" } });
    expect(await version(slugA)).toBe(v0);
    const r = await putSite(A, { ...cur.meta.site, tagline: "New line" });
    expect(r.status).toBe(200);
    expect(await version(slugA)).toBeGreaterThan(v0);
    expect((await call(P(slugA))).data.tagline).toBe("New line");
  });

  it("is stored cleaned up; a meta patch without `site` keeps it", async () => {
    const cur = await settings(A);
    const r = await putSite(A, { ...cur.meta.site, tagline: "  Spaced out  " });
    expect(r.data.meta.site.tagline).toBe("Spaced out");
    const next = await settings(A);
    const { site, ...rest } = next.meta;
    const kept = await call("/v1/settings", { method: "PATCH", cookie: A.cookie, headers: { "If-Match": String(next.version) }, json: { meta: { ...rest, other: 1 } } });
    expect(kept.status).toBe(200);
    expect(kept.data.meta.other).toBe(1);
    expect(kept.data.meta.site).toEqual(site);
  });

  it("a new time zone moves the catalogue version (the profile shows it)", async () => {
    const v0 = await version(slugA);
    const cur = await settings(A);
    await call("/v1/settings", { method: "PATCH", cookie: A.cookie, headers: { "If-Match": String(cur.version) }, json: { timezone: "America/Los_Angeles" } });
    expect(await version(slugA)).toBeGreaterThan(v0);
    expect((await call(P(slugA))).data.timezone).toBe("America/Los_Angeles");
  });

  it("the assistant can't change what the site says", async () => {
    const cur = await settings(A);
    const res = await call("/v1/assistant/act", { method: "POST", cookie: A.cookie, headers: ASSISTANT,
      json: { action: "settings.update", input: { version: cur.version, patch: { meta: { ...cur.meta, site: { ...cur.meta.site, tagline: "From the assistant" } } } }, summary: "x" } });
    if (res.data.proposal) {
      const ok = await call(`/v1/assistant/proposals/${res.data.proposal.id}/confirm`, { method: "POST", cookie: A.cookie });
      expect(ok.status).toBe(403);
    } else {
      expect(res.status).toBe(403);
    }
    expect((await settings(A)).meta.site.tagline).toBe(cur.meta.site.tagline);
  });

  it("a guest can't write the profile", async () => {
    expect((await call("/v1/settings", { method: "PATCH", headers: { "If-Match": "1" }, json: { meta: { site: {} } } })).status).toBe(401);
  });

  it("each request runs at most 4 D1 queries", async () => {
    for (const p of ["", "/site-photos", "/site-photos?place=home.hero"]) {
      const { env: counted, count } = countingEnv();
      const r = await call(`${P(slugA)}${p}`, { env: counted });
      expect(r.status).toBe(200);
      expect(count.queries).toBeLessThanOrEqual(4);
    }
  });
});
