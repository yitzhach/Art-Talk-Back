// Collectors (Site 3.0 stage 6, D-163…D-168): the gate, end to end. A Venmo order marked paid makes the buyer a
// collector who owns the piece; their private page shows it with its certificate; a new work in first look is hidden
// from the public site but shown, and buyable, from the collector's page; following works with an email code; nothing
// reaches another studio; and outside production every email goes to the studio's own inbox (D-167).
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endFirstLooks } from "../src/jobs";
import { addPicture, makeWork, studioSlug } from "./catalogue-helpers";
import { call, makeStudio, type Studio } from "./helpers";

const P = (slug: string) => `/v1/public/studios/${slug}`;
const key = (n: string) => `visitor-${n}`.padEnd(32, "k");
const vh = (n: string) => ({ "x-visitor-key": key(n) });

interface Mail { to: string[]; subject: string; text: string }
let mails: Mail[] = [];
let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  mails = [];
  spy = vi.spyOn(globalThis, "fetch").mockImplementation((async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://api.resend.com/emails") {
      mails.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "x" });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as any);
});
afterEach(() => spy.mockRestore());

const settings = async (s: Studio) => (await call("/v1/settings", { cookie: s.cookie })).data;
async function patchSite(s: Studio, patch: Record<string, unknown>) {
  const cur = await settings(s);
  const r = await call("/v1/settings", {
    method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(cur.version) },
    json: { meta: { ...cur.meta, site: { ...(cur.meta?.site ?? {}), ...patch } } },
  });
  if (r.status !== 200) throw new Error(`settings ${r.status} ${r.raw}`);
}
async function setup(name = "Isaac Anderson Art") {
  const s = await makeStudio(name);
  const slug = await studioSlug(s.studioId);
  await patchSite(s, {
    checkout: { enabled: true, venmo: "@Test-Artist", shippingCents: 4000, returns: "Returns within 7 days.", taxBps: 0 },
    shipping: { tier2Cents: 4000 },
    collectors: { care: "Keep it out of direct sun." },
  });
  return { s, slug };
}
const work = async (s: Studio, title: string, fields: Record<string, unknown> = {}) =>
  (await makeWork(s, { title, priceCents: 50_000, width: 12, height: 16, sizeUnit: "in", year: 2026, shipping: { tier: 2 }, ...fields }, { publish: true })).work;
const art = async (s: Studio, id: string) => (await call(`/v1/artworks/${id}`, { cookie: s.cookie })).data;
const address = { line1: "1 Main St", city: "Springfield", state: "IL", postalCode: "62701" };
const ownerEmail = async (s: Studio) => (await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(s.userId).first<string>("email"))!;

/** A Venmo order on the site, marked paid by the owner: the buyer becomes a client who owns the piece. */
async function sellByVenmo(s: Studio, slug: string, w: any, who = "buyer", email = "pat@buyer.test") {
  const o = await call(`${P(slug)}/visitor/orders`, { method: "POST", headers: vh(who), json: { work: w.slug, method: "venmo", name: "Pat Buyer", email, address } });
  expect(o.status).toBe(201);
  const v = (await call(`/v1/orders/${o.data.id}`, { cookie: s.cookie })).data.version;
  const paid = await call(`/v1/orders/${o.data.id}/mark-paid`, { method: "POST", cookie: s.cookie, headers: { "If-Match": String(v) }, json: { note: "Venmo" } });
  expect(paid.status).toBe(200);
  return o.data;
}
const collectors = async (s: Studio) => (await call("/v1/collectors", { cookie: s.cookie })).data.items;
const tokenOf = (path: string) => path.split("/").pop()!;

describe("the gate: a buyer becomes a collector with a page of their own", () => {
  it("Venmo order → Mark paid → owned, certificate, link, invite (to the studio's inbox), first look, revoke", async () => {
    const { s, slug } = await setup();
    const heron = await work(s, "Heron");
    await sellByVenmo(s, slug, heron);
    expect((await art(s, heron.id)).meta.sale.clientId).toBeTruthy();

    // Studio: Pat is a collector who owns one work and has no link yet.
    const [pat] = (await collectors(s)).filter((c: any) => c.email === "pat@buyer.test");
    expect(pat).toMatchObject({ name: "Pat Buyer", workCount: 1, link: null, following: false });
    const d = (await call(`/v1/collectors/${pat.id}`, { cookie: s.cookie })).data;
    expect(d.works).toHaveLength(1);
    expect(d.works[0]).toMatchObject({ id: heron.id, title: "Heron", certificate: `IAA-2026-${heron.id.slice(-6)}` });

    // The link and the invite: outside production it goes to the studio's inbox, marked TEST (D-167).
    const linked = (await call(`/v1/collectors/${pat.id}/link`, { method: "POST", cookie: s.cookie })).data;
    expect(linked.link.path).toMatch(/^\/c\/[A-Za-z0-9_-]{20,}$/);
    mails = [];
    const inv = await call(`/v1/collectors/${pat.id}/invite`, { method: "POST", cookie: s.cookie, json: { origin: "https://site.example.test" } });
    expect(inv.status).toBe(200);
    expect(inv.data).toMatchObject({ sent: true, link: { path: linked.link.path } });
    expect(inv.data.link.invitedAt).toBeTruthy();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toEqual([await ownerEmail(s)]);
    expect(mails[0]!.to).not.toContain("pat@buyer.test");
    expect(mails[0]!.subject).toMatch(/^TEST: /);
    expect(mails[0]!.text).toContain(`https://site.example.test${linked.link.path}`);
    expect(mails[0]!.text).toContain("pat@buyer.test");

    // Their page: first name only, the work with its certificate, care notes, pictures through the token.
    const token = tokenOf(linked.link.path);
    const page = await call(`${P(slug)}/collectors/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.data).toMatchObject({ firstName: "Pat", studioName: "Isaac Anderson Art", care: "Keep it out of direct sun.", commissions: [], firstLook: [] });
    expect(page.data.works).toHaveLength(1);
    expect(page.data.works[0]).toMatchObject({ title: "Heron", certificate: d.works[0].certificate });
    expect(page.data.works[0].soldOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const img = page.data.works[0].images[0].sizes[0].url as string;
    expect(img).toContain(`/collectors/${token}/images/`);
    expect((await call(img.replace(/^https?:\/\/[^/]+/, ""))).status).toBe(200);
    expect(JSON.stringify(page.data)).not.toContain("Buyer"); // no surname, no email
    expect(JSON.stringify(page.data)).not.toContain("buyer.test");

    // A new work in first look: off the public site, on the collector's page.
    const egret = await work(s, "Egret");
    await addPicture(s, egret.id);
    const fl = await call(`/v1/artworks/${egret.id}/first-look`, { method: "POST", cookie: s.cookie, json: {} });
    expect(fl.status).toBe(200);
    expect(Date.parse(fl.data.publicFrom) - Date.now()).toBeGreaterThan(6 * 86_400_000);
    const publicSlugs = (await call(`${P(slug)}/artworks`)).data.items.map((w: any) => w.slug);
    expect(publicSlugs).not.toContain(egret.slug);
    expect((await call(`${P(slug)}/artworks/${egret.slug}`)).status).toBe(404);
    const withFl = (await call(`${P(slug)}/collectors/${token}`)).data;
    expect(withFl.firstLook.map((w: any) => w.slug)).toEqual([egret.slug]);
    const flImg = withFl.firstLook[0].images[0].sizes[0].url as string;
    expect((await call(flImg.replace(/^https?:\/\/[^/]+/, ""))).status).toBe(200);
    // The public picture route won't serve it during first look.
    expect((await call(flImg.replace(`/collectors/${token}/images/`, "/images/").replace(/^https?:\/\/[^/]+/, ""))).status).toBe(404);

    // A stranger's browser can't buy it; the collector's browser, once it opened the page, can.
    const strangerBuy = await call(`${P(slug)}/visitor/orders`, { method: "POST", headers: vh("stranger"), json: { work: egret.slug, method: "venmo", name: "Sam Stranger", email: "sam@stranger.test", address } });
    expect(strangerBuy.status, strangerBuy.raw).toBe(404);
    expect((await call(`${P(slug)}/collectors/${token}/visit`, { method: "POST", headers: vh("pat") })).status).toBe(204);
    const patBuy = await call(`${P(slug)}/visitor/orders`, { method: "POST", headers: vh("pat"), json: { work: egret.slug, method: "venmo", name: "Pat Buyer", email: "pat@buyer.test", address } });
    expect(patBuy.status).toBe(201);
    await call(`/v1/orders/${patBuy.data.id}/cancel`, { method: "POST", cookie: s.cookie, headers: { "If-Match": String((await call(`/v1/orders/${patBuy.data.id}`, { cookie: s.cookie })).data.version) } });

    // Revoked: the page, its pictures and its first look stop working at once.
    expect((await call(`/v1/collectors/${pat.id}/unlink`, { method: "POST", cookie: s.cookie })).data.link).toBeNull();
    expect((await call(`${P(slug)}/collectors/${token}`)).status).toBe(404);
    expect((await call(img.replace(/^https?:\/\/[^/]+/, ""))).status).toBe(404);
    const again = await call(`${P(slug)}/visitor/orders`, { method: "POST", headers: vh("pat"), json: { work: egret.slug, method: "venmo", name: "Pat Buyer", email: "pat@buyer.test", address } });
    expect(again.status, again.raw).toBe(404);

    // First look ends: the work is public.
    const v = (await art(s, egret.id)).version;
    expect((await call(`/v1/artworks/${egret.id}/first-look`, { method: "POST", cookie: s.cookie, headers: { "If-Match": String(v) }, json: { until: null } })).data.publicFrom).toBeNull();
    expect((await call(`${P(slug)}/artworks`)).data.items.map((w: any) => w.slug)).toContain(egret.slug);
  });

  it("a piece sold before the site gets its owner by hand; reserved pieces can't", async () => {
    const { s } = await setup();
    const client = (await call("/v1/clients", { method: "POST", cookie: s.cookie, json: { name: "Robin Old", email: "robin@old.test" } })).data;
    const sold = await work(s, "Old Heron");
    const r = await call(`/v1/artworks/${sold.id}/owner`, { method: "POST", cookie: s.cookie, json: { clientId: client.id, priceCents: 30_000 } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ status: "sold", ownerId: client.id });
    const d = (await call(`/v1/collectors/${client.id}`, { cookie: s.cookie })).data;
    expect(d.works.map((w: any) => w.id)).toEqual([sold.id]);
    // Clearing it leaves the work sold, owner unknown.
    expect((await call(`/v1/artworks/${sold.id}/owner`, { method: "POST", cookie: s.cookie, json: { clientId: null } })).data).toMatchObject({ status: "sold", ownerId: null });
    // A reserved piece is mid-order: not his to hand over here.
    const held = await work(s, "Held");
    await env.DB.prepare("UPDATE artworks SET status = 'reserved' WHERE id = ?").bind(held.id).run();
    expect((await call(`/v1/artworks/${held.id}/owner`, { method: "POST", cookie: s.cookie, json: { clientId: client.id } })).status).toBe(409);
    // Inviting someone with no email can't send.
    const noMail = (await call("/v1/clients", { method: "POST", cookie: s.cookie, json: { name: "No Mail" } })).data;
    expect((await call(`/v1/collectors/${noMail.id}/invite`, { method: "POST", cookie: s.cookie, json: {} })).status).toBe(400);
  });

  it("commissions move through their stages and show on the collector's page", async () => {
    const { s, slug } = await setup();
    const client = (await call("/v1/clients", { method: "POST", cookie: s.cookie, json: { name: "Sam Patron", email: "sam@patron.test" } })).data;
    const c = await call("/v1/commissions", { method: "POST", cookie: s.cookie, json: { clientId: client.id, title: "Blue heron at dusk", size: "24 x 36 in", priceCents: 400_000 } });
    expect(c.status).toBe(201);
    expect(c.data).toMatchObject({ stage: "surface", status: "open", clientId: client.id });
    const moved = await call(`/v1/commissions/${c.data.id}`, { method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(c.data.version) }, json: { stage: "layering", notes: { surface: "Panel primed." } } });
    expect(moved.status).toBe(200);
    expect(moved.data.stage).toBe("layering");
    expect((await call(`/v1/commissions/${c.data.id}`, { method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(c.data.version) }, json: { stage: "color" } })).status).toBe(409);
    expect((await call("/v1/commissions", { method: "POST", cookie: s.cookie, json: { clientId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", title: "x" } })).status).toBe(404);
    const link = (await call(`/v1/collectors/${client.id}/link`, { method: "POST", cookie: s.cookie })).data.link;
    const page = (await call(`${P(slug)}/collectors/${tokenOf(link.path)}`)).data;
    expect(page.works).toEqual([]);
    expect(page.commissions).toEqual([expect.objectContaining({ title: "Blue heron at dusk", stage: "layering", notes: { surface: "Panel primed." } })]);
    expect(JSON.stringify(page.commissions)).not.toContain("400000"); // the price stays in Studio
    expect((await call(`/v1/collectors/${client.id}`, { cookie: s.cookie })).data.commissions).toHaveLength(1);
    const del = await call(`/v1/commissions/${c.data.id}`, { method: "DELETE", cookie: s.cookie, headers: { "If-Match": String(moved.data.version) } });
    expect(del.status).toBe(200);
    expect((await call(`${P(slug)}/collectors/${tokenOf(link.path)}`)).data.commissions).toEqual([]);
  });
});

describe("following the studio", () => {
  it("email code → follower page with first look → Stop; staging codes go to the studio's inbox", async () => {
    const { s, slug } = await setup();
    const show = (await call("/v1/shows", { method: "POST", cookie: s.cookie, json: { name: "Spring Fair", city: "Austin" } })).data;
    expect((await call(`${P(slug)}/shows/${show.id}`)).data).toMatchObject({ name: "Spring Fair", city: "Austin" });
    const egret = await work(s, "Egret");
    await call(`/v1/artworks/${egret.id}/first-look`, { method: "POST", cookie: s.cookie, json: {} });

    // The trap field: nothing sent.
    expect((await call(`${P(slug)}/follow/email-code`, { method: "POST", headers: vh("f"), json: { email: "fan@x.test", website: "spam" } })).status).toBe(204);
    expect(mails).toHaveLength(0);
    expect((await call(`${P(slug)}/follow/email-code`, { method: "POST", headers: vh("f"), json: { email: "Fan@X.test", showId: show.id } })).status).toBe(204);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toEqual([await ownerEmail(s)]);
    expect(mails[0]!.subject).toMatch(/^TEST: /);
    const code = /\b(\d{6})\b/.exec(mails[0]!.text)![1]!;
    expect((await call(`${P(slug)}/follow/verify`, { method: "POST", headers: vh("f"), json: { email: "fan@x.test", code: code === "000000" ? "111111" : "000000" } })).status).toBe(400);
    const ok = await call(`${P(slug)}/follow/verify`, { method: "POST", headers: vh("f"), json: { email: "fan@x.test", code, showId: show.id } });
    expect(ok.status).toBe(200);
    expect(ok.data.path).toMatch(/^\/f\/[A-Za-z0-9_-]{20,}$/);
    // The code is spent.
    expect((await call(`${P(slug)}/follow/verify`, { method: "POST", headers: vh("f"), json: { email: "fan@x.test", code } })).status).toBe(400);

    const ft = tokenOf(ok.data.path);
    const page = (await call(`${P(slug)}/followers/${ft}`)).data;
    expect(page).toMatchObject({ following: true, email: "fa…@x.test" });
    expect(page.firstLook.map((w: any) => w.slug)).toEqual([egret.slug]);
    // This browser may hold or buy first-look work.
    expect((await call(`${P(slug)}/shipping/quote`, { method: "POST", headers: vh("f"), json: { works: [egret.slug] } })).data.ok).toBe(true);

    const fols = (await call("/v1/followers", { cookie: s.cookie })).data.items;
    expect(fols).toEqual([expect.objectContaining({ email: "fan@x.test", showName: "Spring Fair" })]);

    // The artist's tap: one TEST email to his inbox for the works not announced yet; a second tap has nothing new.
    mails = [];
    const ann = await call("/v1/first-look/announce", { method: "POST", cookie: s.cookie, json: { origin: "https://site.example.test" } });
    expect(ann.data).toMatchObject({ works: 1, emailed: 1 });
    expect(mails[0]!.to).toEqual([await ownerEmail(s)]);
    expect(mails[0]!.text).toContain("Egret");
    expect(mails[0]!.text).toContain(`https://site.example.test/f/${ft}`);
    expect((await call("/v1/first-look/announce", { method: "POST", cookie: s.cookie, json: {} })).status).toBe(400);

    expect((await call(`${P(slug)}/followers/${ft}/stop`, { method: "POST" })).status).toBe(204);
    expect((await call(`${P(slug)}/followers/${ft}`)).data).toMatchObject({ following: false, firstLook: [] });
    expect((await call(`${P(slug)}/shipping/quote`, { method: "POST", headers: vh("f"), json: { works: [egret.slug] } })).data.ok).toBe(false);
  });

  it("a buyer who follows with their own email shows as following in Studio", async () => {
    const { s, slug } = await setup();
    const heron = await work(s, "Heron");
    await sellByVenmo(s, slug, heron);
    await call(`${P(slug)}/follow/email-code`, { method: "POST", headers: vh("g"), json: { email: "pat@buyer.test" } });
    const code = /\b(\d{6})\b/.exec(mails.at(-1)!.text)![1]!;
    expect((await call(`${P(slug)}/follow/verify`, { method: "POST", headers: vh("g"), json: { email: "pat@buyer.test", code } })).status).toBe(200);
    expect((await collectors(s)).find((c: any) => c.email === "pat@buyer.test")).toMatchObject({ following: true });
  });
});

describe("first look ends on its own", () => {
  it("the hourly job moves the catalogue on for studios whose first look just ended", async () => {
    const { s } = await setup();
    const w = await work(s, "Egret");
    await call(`/v1/artworks/${w.id}/first-look`, { method: "POST", cookie: s.cookie, json: {} });
    const before = await env.DB.prepare("SELECT catalogue_version AS v FROM studios WHERE id = ?").bind(s.studioId).first<number>("v");
    await env.DB.prepare("UPDATE artworks SET public_from = ? WHERE id = ?").bind(new Date(Date.now() - 10 * 60_000).toISOString(), w.id).run();
    expect(await endFirstLooks(env)).toBeGreaterThanOrEqual(1);
    const after = await env.DB.prepare("SELECT catalogue_version AS v FROM studios WHERE id = ?").bind(s.studioId).first<number>("v");
    expect(Number(after)).toBeGreaterThan(Number(before));
  });
});

describe("tenancy", () => {
  it("another studio can't see, change or open A's collectors, links, commissions or followers", async () => {
    const a = await setup("Studio A");
    const b = await setup("Studio B");
    const client = (await call("/v1/clients", { method: "POST", cookie: a.s.cookie, json: { name: "Pat A", email: "pat@a.test" } })).data;
    const link = (await call(`/v1/collectors/${client.id}/link`, { method: "POST", cookie: a.s.cookie })).data.link;
    const comm = (await call("/v1/commissions", { method: "POST", cookie: a.s.cookie, json: { clientId: client.id, title: "A's" } })).data;
    expect((await call(`/v1/collectors/${client.id}`, { cookie: b.s.cookie })).status).toBe(404);
    expect((await call(`/v1/collectors/${client.id}/link`, { method: "POST", cookie: b.s.cookie })).status).toBe(404);
    expect((await call(`/v1/commissions/${comm.id}`, { method: "PATCH", cookie: b.s.cookie, headers: { "If-Match": String(comm.version) }, json: { stage: "color" } })).status).toBe(404);
    expect((await call("/v1/commissions", { method: "POST", cookie: b.s.cookie, json: { clientId: client.id, title: "B's" } })).status).toBe(404);
    expect((await collectors(b.s)).map((c: any) => c.id)).not.toContain(client.id);
    // A's token on B's site: not found.
    expect((await call(`${P(b.slug)}/collectors/${tokenOf(link.path)}`)).status).toBe(404);
    expect((await call(`${P(a.slug)}/collectors/${tokenOf(link.path)}`)).status).toBe(200);
  });
});
