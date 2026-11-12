// The site's visitors and assistant (Site 3.0 stage 3, card A; D-134…D-141): the public sheet and digest, a turn's limits
// and budget, keeping a chat, made pages, leads (JSON and with pictures), holds, and the daily summary.
import { env } from "cloudflare:test";
import { newId } from "@studio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expireHolds, dailySummaries } from "../src/jobs";
import { costMillicents } from "../src/routes/visitors";
import { makeWork, studioSlug } from "./catalogue-helpers";
import { ASSISTANT, call, makeStudio, rowCount, type Studio } from "./helpers";

const P = (slug: string) => `/v1/public/studios/${slug}`;
const key = (n: string) => `visitor-${n}`.padEnd(32, "k");
const vh = (n: string, more: Record<string, string> = {}) => ({ "x-visitor-key": key(n), ...more });
const ownerEmail = (s: Studio) => `${s.userId.toLowerCase()}@example.test`;

// ---- mail: every Resend call, parsed
interface Mail { to: string[]; subject: string; text: string; reply_to?: string; attachments?: { filename: string; content: string }[] }
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

// ---- the owner's side
const settings = async (s: Studio) => (await call("/v1/settings", { cookie: s.cookie })).data;
async function patchSite(s: Studio, patch: Record<string, unknown>) {
  const cur = await settings(s);
  const r = await call("/v1/settings", {
    method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(cur.version) },
    json: { meta: { ...cur.meta, site: { ...(cur.meta?.site ?? {}), ...patch } } },
  });
  if (r.status !== 200) throw new Error(`settings ${r.status} ${r.raw}`);
}
const setAssistant = (s: Studio, assistant: Record<string, unknown>) => patchSite(s, { assistant });
const patchWork = async (s: Studio, w: any, json: Record<string, unknown>) => {
  const r = await call(`/v1/artworks/${w.id}`, { method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(w.version) }, json });
  if (r.status !== 200) throw new Error(`patch ${r.status} ${r.raw}`);
  return r.data;
};
const work = async (s: Studio, fields: Record<string, unknown> = {}, publish = true) => (await makeWork(s, fields, { publish })).work;
const setup = async (name = "Studio") => {
  const s = await makeStudio(name);
  return { s, slug: await studioSlug(s.studioId) };
};

// ---- the assistant's and the visitor's calls
const post = (slug: string, path: string, who: string, json: unknown, extra: Record<string, string> = {}) =>
  call(`${P(slug)}/visitor${path}`, { method: "POST", headers: vh(who, extra), json });
const turnStart = (slug: string, who: string, json: Record<string, unknown> = {}, assistant = true) =>
  post(slug, "/turn-start", who, json, assistant ? ASSISTANT : {});
const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
const turn = (slug: string, who: string, threadId: string, more: Record<string, unknown> = {}) =>
  post(slug, "/turn", who, {
    threadId, user: "Do you have a blue one?", reply: "Yes, see Heron.", works: [], askArtist: false, fixed: 0,
    model: "claude-haiku-5-5", usage, ...more,
  }, ASSISTANT);
/** A visitor with one recorded chat turn; returns its thread. */
async function chat(slug: string, who: string, more: Record<string, unknown> = {}) {
  const start = await turnStart(slug, who);
  expect(start.status).toBe(200);
  const threadId = start.data.threadId as string;
  const t = await turn(slug, who, threadId, more);
  expect(t.status).toBe(200);
  return threadId;
}
const lead = (slug: string, who: string, body: Record<string, unknown>) =>
  post(slug, "/leads", who, { kind: "inquiry", source: "form", works: [], email: "buyer@example.test", ...body });

// ---- picture bytes
const enc = (s: string) => [...new TextEncoder().encode(s)];
const seg = (m: number, p: number[]) => [0xff, m, (p.length + 2) >> 8, (p.length + 2) & 255, ...p];
const jpeg = (tag: string) => new Uint8Array([
  0xff, 0xd8, ...seg(0xe1, enc(`Exif\0\0GPS-SECRET-${tag}`)), ...seg(0xdb, [0, 1, 2]), ...seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
  ...seg(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0x34, 0xff, 0xd9,
]);
const latin1 = (b64: string) => atob(b64);
const multipart = (leadJson: unknown, files: File[]) => {
  const f = new FormData();
  f.set("lead", JSON.stringify(leadJson));
  for (const x of files) f.append("picture", x);
  return f;
};
const pic = (tag: string) => new File([jpeg(tag)], `${tag}.jpg`, { type: "image/jpeg" });

// =====================================================================================================================

describe("the chat sheet and the digest", () => {
  it("GET /assistant: defaults, then the owner's settings; budget and spend never show", async () => {
    const { s, slug } = await setup();
    const d = await call(`${P(slug)}/assistant`);
    expect(d.status).toBe(200);
    expect(d.data.artistName).toBe("the artist");
    expect(d.data.available).toBe(true);
    expect(typeof d.data.greeting).toBe("string");
    expect(d.data.greeting.length).toBeGreaterThan(0);
    expect(d.data.suggestions).toHaveLength(3);

    await setAssistant(s, { artistName: "Isaac", budgetCents: 1, answers: { commissionTimeline: "8–12 weeks" } });
    const a = await call(`${P(slug)}/assistant`);
    expect(a.data.artistName).toBe("Isaac");
    expect(a.data.answers.commissionTimeline).toBe("8–12 weeks");
    expect(a.data.available).toBe(true);
    expect(a.raw.toLowerCase()).not.toContain("budget");
    expect(a.raw.toLowerCase()).not.toContain("spen");
    expect(a.raw).not.toContain("cost");
  });

  it("GET /digest: only public works; no private fields; price only when available and priced", async () => {
    const { s, slug } = await setup();
    const B = await makeStudio("Other");
    const priced = await work(s, { title: "Priced", priceCents: 120000, inventoryCode: "INV-SECRET" });
    const sold = await patchWork(s, await work(s, { title: "Sold one", priceCents: 90000 }), { status: "sold" });
    await work(s, { title: "No price" });
    await work(s, { title: "Draft" }, false);
    const gone = await work(s, { title: "Gone" });
    await call(`/v1/artworks/${gone.id}`, { method: "DELETE", cookie: s.cookie, headers: { "If-Match": String(gone.version) } });
    await work(s, { title: "Banner", kind: "site_photo" });
    await work(B, { title: "Theirs" });

    const d = await call(`${P(slug)}/digest`);
    expect(d.status).toBe(200);
    const byTitle = Object.fromEntries(d.data.works.map((w: any) => [w.title, w]));
    expect(Object.keys(byTitle).sort()).toEqual(["No price", "Priced", "Sold one"]);
    expect(byTitle["Priced"]).toMatchObject({ priceCents: 120000, status: "available" });
    expect(byTitle["Sold one"].status).toBe("sold");
    expect(byTitle["Sold one"].priceCents).toBeNull();
    expect(byTitle["No price"].priceCents).toBeNull();
    for (const w of d.data.works) {
      expect(w).not.toHaveProperty("id");
      expect(w).not.toHaveProperty("inventoryCode");
      expect(w).not.toHaveProperty("notes");
    }
    expect(d.raw).not.toContain("INV-SECRET");
    expect(sold.status).toBe("sold");
    expect(priced.id).toBeTruthy();
  });
});

describe("a turn's limits", () => {
  it("turn-start needs the assistant's key; allowed starts a thread; a recorded turn comes back; fresh starts over", async () => {
    const { slug } = await setup();
    expect((await turnStart(slug, "x", {}, false)).status).toBe(403);

    const first = await turnStart(slug, "x");
    expect(first.status).toBe(200);
    expect(first.data).toMatchObject({ allowed: true, history: [] });
    expect(first.data.threadId).toMatch(/^[0-9A-Z]{26}$/);

    expect((await turn(slug, "x", first.data.threadId, { user: "Hi", reply: "Hello", works: ["heron"] })).status).toBe(200);
    const again = await turnStart(slug, "x");
    expect(again.data.threadId).toBe(first.data.threadId);
    expect(again.data.history).toEqual([
      { role: "user", text: "Hi", works: [] },
      { role: "assistant", text: "Hello", works: ["heron"] },
    ]);

    const fresh = await turnStart(slug, "x", { fresh: true });
    expect(fresh.data.allowed).toBe(true);
    expect(fresh.data.threadId).not.toBe(first.data.threadId);
    expect(fresh.data.history).toEqual([]);
  });

  it("27 messages a day per visitor → daily; 8 a minute at one address → burst", async () => {
    const { slug } = await setup();
    const threadId = (await turnStart(slug, "d")).data.threadId;
    for (let i = 0; i < 27; i++) expect((await turn(slug, "d", threadId)).status).toBe(200);
    expect((await turnStart(slug, "d")).data).toEqual({ allowed: false, reason: "daily" });

    const t1 = (await turnStart(slug, "b1", { ip: "203.0.113.9" })).data.threadId;
    for (let i = 0; i < 8; i++) expect((await turn(slug, "b1", t1, { ip: "203.0.113.9" })).status).toBe(200);
    expect((await turnStart(slug, "b2", { ip: "203.0.113.9" })).data).toEqual({ allowed: false, reason: "burst" });
    // another address, and the same visitor-less call, are fine
    expect((await turnStart(slug, "b3", { ip: "203.0.113.10" })).data.allowed).toBe(true);
  });
});

describe("the budget", () => {
  it("prices a turn in thousandths of a cent", () => {
    expect(costMillicents("claude-haiku-5-5", { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }))
      .toBe(10_000 + 50_000 + 1_000 + 12_500);
    expect(costMillicents("claude-haiku-5-5", { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(1);
    expect(costMillicents("claude-haiku-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0);
    // an unknown model costs as Sonnet 5.5
    const u = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costMillicents("mystery", u)).toBe(costMillicents("claude-sonnet-5-5", u));
  });

  it("reaching the budget caps the chat, emails once, and shows in the owner's usage", async () => {
    const { s, slug } = await setup();
    await setAssistant(s, { budgetCents: 1 });
    const threadId = (await turnStart(slug, "m")).data.threadId;
    const costly = { model: "claude-sonnet-5-5", usage: { inputTokens: 0, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    const capMails = () => mails.filter((m) => /budget/.test(m.subject));

    const t = await turn(slug, "m", threadId, costly);
    expect(t.data).toEqual({ ok: true, capped: true });
    expect(capMails()).toHaveLength(1);
    expect(capMails()[0]!.to).toEqual([ownerEmail(s)]);

    expect((await turn(slug, "m", threadId, costly)).data.capped).toBe(true);
    expect(capMails()).toHaveLength(1);

    expect((await turnStart(slug, "m")).data).toEqual({ allowed: false, reason: "budget" });
    expect((await call(`${P(slug)}/assistant`)).data.available).toBe(false);

    const u = await call("/v1/site/assistant-usage", { cookie: s.cookie });
    expect(u.status).toBe(200);
    expect(u.data.turns).toBe(2);
    expect(u.data.spentCents).toBeGreaterThanOrEqual(1);
    expect(u.data.budgetCents).toBe(1);
    expect(u.data.capped).toBe(true);
  });
});

describe("whose chat it is", () => {
  it("another visitor can't write into a thread, and sees none of it", async () => {
    const { slug } = await setup();
    const threadId = await chat(slug, "x");
    await turnStart(slug, "y"); // makes Y a visitor
    expect((await turn(slug, "y", threadId)).status).toBe(403);
    const y = await call(`${P(slug)}/visitor`, { headers: vh("y") });
    expect(y.data).toEqual({ email: null, threadId: null, messages: [] });
    const x = await call(`${P(slug)}/visitor`, { headers: vh("x") });
    expect(x.data.threadId).toBe(threadId);
    expect(x.data.messages).toHaveLength(2);
  });

  it("Keep this chat: a proven email carries the chat to another browser; a wrong code is 400; the 7th is 429", async () => {
    const { slug } = await setup();
    const threadId = await chat(slug, "x", { user: "Is Heron still here?" });
    const prove = async (who: string, email: string) => {
      const sent = await post(slug, "/email-code", who, { email });
      expect(sent.status).toBe(204);
      const m = mails.filter((x) => x.to[0] === email).at(-1)!;
      const code = /\b(\d{6})\b/.exec(m.text)![1]!;
      return post(slug, "/email-verify", who, { email, code });
    };
    // browser X proves the address; browser Y proves the same one and picks up X's chat
    const px = await prove("x", "a@example.test");
    expect(px.status).toBe(200);
    expect(px.data.email).toBe("a@example.test");
    const py = await prove("y", "a@example.test");
    expect(py.status).toBe(200);
    expect(py.data.email).toBe("a@example.test");
    expect(py.data.threadId).toBe(threadId);
    expect(py.data.messages.map((m: any) => m.text)).toContain("Is Heron still here?");
    const state = await call(`${P(slug)}/visitor`, { headers: vh("y") });
    expect(state.data).toMatchObject({ email: "a@example.test", threadId });

    // wrong codes
    expect((await post(slug, "/email-code", "z", { email: "b@example.test" })).status).toBe(204);
    const real = /\b(\d{6})\b/.exec(mails.at(-1)!.text)![1]!;
    const wrong = real === "000000" ? "111111" : "000000";
    for (let i = 0; i < 6; i++) expect((await post(slug, "/email-verify", "z", { email: "b@example.test", code: wrong })).status).toBe(400);
    expect((await post(slug, "/email-verify", "z", { email: "b@example.test", code: wrong })).status).toBe(429);
    // even the right code is refused once tries are spent
    expect((await post(slug, "/email-verify", "z", { email: "b@example.test", code: real })).status).toBe(429);
  });
});

describe("made pages", () => {
  it("makes an unlisted page of works that are still public", async () => {
    const { s, slug } = await setup();
    const B = await makeStudio("Other");
    const slugB = await studioSlug(B.studioId);
    const w1 = await work(s, { title: "Heron" });
    const w2 = await work(s, { title: "Egret" });

    const made = await post(slug, "/pages", "p", { title: "For the living room", question: "Something blue?", works: [w1.slug, w2.slug, "no-such-work"] });
    expect(made.status).toBe(201);
    expect(made.data.path).toBe(`/p/${made.data.token}`);

    const page = await call(`${P(slug)}/pages/${made.data.token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
    expect(page.data).toMatchObject({ token: made.data.token, title: "For the living room", question: "Something blue?" });
    expect(page.data.works.map((w: any) => w.title)).toEqual(["Heron", "Egret"]);
    for (const w of page.data.works) {
      expect(w.slug).toBeTruthy();
      expect(w.images.length).toBeGreaterThan(0);
    }

    // another studio's slug with this token finds nothing
    expect((await call(`${P(slugB)}/pages/${made.data.token}`)).status).toBe(404);

    const un = await call(`/v1/artworks/${w1.id}/unpublish`, { method: "POST", cookie: s.cookie, headers: { "If-Match": String(w1.version) } });
    expect(un.status).toBe(200);
    expect((await call(`${P(slug)}/pages/${made.data.token}`)).data.works.map((w: any) => w.title)).toEqual(["Egret"]);

    // nothing public to show → no page
    expect((await post(slug, "/pages", "p", { title: "Nothing", works: ["nope-1", "nope-2"] })).status).toBe(404);
    expect((await call(`${P(slug)}/pages/${"a".repeat(32)}`)).status).toBe(404);
  });
});

describe("leads, JSON", () => {
  it("an inquiry reaches the owner, makes or matches a client, and sends one email", async () => {
    const { s, slug } = await setup();
    const w1 = await work(s, { title: "Heron" });
    const w2 = await work(s, { title: "Egret" });
    const threadId = await chat(slug, "l", { user: "Do you ship?", reply: "Yes." });

    const r = await lead(slug, "l", { works: [w1.slug, w2.slug], name: "Bea Buyer", email: "Buyer@Example.test", note: "Love the pair.", threadId, source: "inquiry_list" });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ kind: "inquiry", status: "new" });

    const list = await call("/v1/leads", { cookie: s.cookie });
    expect(list.status).toBe(200);
    expect(list.data.items).toHaveLength(1);
    expect(list.data.items[0]).toMatchObject({ id: r.data.id, source: "inquiry_list", status: "new", email: "buyer@example.test", name: "Bea Buyer" });
    expect(list.data.items[0].works.map((w: any) => w.title)).toEqual(["Heron", "Egret"]);

    const one = await call(`/v1/leads/${r.data.id}`, { cookie: s.cookie });
    expect(one.status).toBe(200);
    expect(one.data.chat.map((m: any) => m.text)).toEqual(["Do you ship?", "Yes."]);

    const clients = (await call("/v1/clients", { cookie: s.cookie })).data.items.filter((c: any) => c.email === "buyer@example.test");
    expect(clients).toHaveLength(1);
    expect(one.data.clientId).toBe(clients[0].id);

    // one email, to the owner's sign-in address (no site email), reply-to the visitor
    const leadMails = mails.filter((m) => /inquiry/i.test(m.subject));
    expect(leadMails).toHaveLength(1);
    const m = leadMails[0]!;
    expect(m.to).toEqual([ownerEmail(s)]);
    expect(m.reply_to?.toLowerCase()).toBe("buyer@example.test");
    expect(m.text).toContain("Heron");
    expect(m.text).toContain("Egret");
    expect(m.text).toContain("Love the pair.");
    expect(m.text).toContain(`/works/${w1.slug}`);
    expect(m.text).toContain(`/works/${w2.slug}`);
    expect(m.text).toContain("Do you ship?");

    // the same email again: same client, and now the site's own email is the recipient
    await patchSite(s, { email: "studio@example.com" });
    const r2 = await lead(slug, "l", { works: [w1.slug], email: "buyer@example.test" });
    expect(r2.status).toBe(201);
    expect((await call(`/v1/leads/${r2.data.id}`, { cookie: s.cookie })).data.clientId).toBe(clients[0].id);
    expect((await call("/v1/clients", { cookie: s.cookie })).data.items.filter((c: any) => c.email === "buyer@example.test")).toHaveLength(1);
    const second = mails.filter((x) => /inquiry/i.test(x.subject));
    expect(second).toHaveLength(2);
    expect(second[1]!.to).toEqual(["studio@example.com"]);
  });
});

describe("leads, with pictures", () => {
  it("strips hidden data, attaches both pictures and stores their ids; refuses non-images and a sixth picture", async () => {
    const { s, slug } = await setup();
    const w1 = await work(s, { title: "Heron" });
    const body = { kind: "inquiry", source: "form", works: [w1.slug], email: "buyer@example.test", note: "Like these" };
    const send = (files: File[]) => call(`${P(slug)}/visitor/leads`, { method: "POST", headers: vh("pm"), body: multipart(body, files) });

    const ok = await send([pic("one"), pic("two")]);
    expect(ok.status).toBe(201);
    const m = mails.find((x) => /inquiry/i.test(x.subject))!;
    expect(m.attachments).toHaveLength(2);
    for (const a of m.attachments!) {
      const bytes = latin1(a.content);
      expect(bytes).not.toContain("Exif");
      expect(bytes).not.toContain("GPS-SECRET");
      expect(bytes.startsWith("\xff\xd8")).toBe(true);
    }
    const detail = await call(`/v1/leads/${ok.data.id}`, { cookie: s.cookie });
    expect(detail.data.fileIds).toHaveLength(2);

    const before = mails.length;
    expect((await send([new File(["just text"], "note.txt", { type: "text/plain" })])).status).toBe(400);
    expect((await send(Array.from({ length: 6 }, (_, i) => pic(`p${i}`)))).status).toBe(400);
    expect(mails.length).toBe(before);
    expect(await rowCount("SELECT count(*) AS n FROM leads WHERE studio_id = ?", s.studioId)).toBe(1);
  });
});

describe("lead rules", () => {
  it("needs a way to reply; a hold is one available piece; the trap stores nothing; 6 a day", async () => {
    const { s, slug } = await setup();
    const a = await work(s, { title: "Heron" });
    const b = await work(s, { title: "Egret" });
    const sold = await patchWork(s, await work(s, { title: "Sold" }), { status: "sold" });
    const leadsN = () => rowCount("SELECT count(*) AS n FROM leads WHERE studio_id = ?", s.studioId);

    expect((await post(slug, "/leads", "r", { kind: "inquiry", source: "form", works: [a.slug] })).status).toBe(400);
    expect((await lead(slug, "r", { kind: "hold", works: [a.slug, b.slug] })).status).toBe(400);
    expect((await lead(slug, "r", { kind: "hold", works: [sold.slug] })).status).toBe(400);
    expect(await leadsN()).toBe(0);
    expect(mails).toHaveLength(0);

    const trap = await lead(slug, "r", { works: [a.slug], website: "http://spam.example" });
    expect(trap.status).toBe(201);
    expect(await leadsN()).toBe(0);
    expect(mails).toHaveLength(0);

    for (let i = 0; i < 6; i++) expect((await lead(slug, "r", { works: [a.slug] })).status).toBe(201);
    expect((await lead(slug, "r", { works: [a.slug] })).status).toBe(429);
    expect(await leadsN()).toBe(6);
  });
});

describe("holds", () => {
  const status = async (s: Studio, id: string) => (await call(`/v1/artworks/${id}`, { cookie: s.cookie })).data.status;
  const getLead = async (s: Studio, id: string) => (await call(`/v1/leads/${id}`, { cookie: s.cookie })).data;
  const act = (s: Studio, id: string, what: string, version: unknown) =>
    call(`/v1/leads/${id}/${what}`, { method: "POST", cookie: s.cookie, headers: { "If-Match": String(version) } });

  it("approve reserves 48 hours, decline releases, the hourly job ends a hold; only holds can be approved", async () => {
    const { s, slug } = await setup();
    const w = await work(s, { title: "Heron" });
    expect(await status(s, w.id)).toBe("available");

    const h1 = await lead(slug, "h", { kind: "hold", works: [w.slug], source: "chat" });
    expect(h1.status).toBe(201);
    const l1 = await getLead(s, h1.data.id);
    const ok = await act(s, h1.data.id, "approve-hold", l1.version);
    expect(ok.status).toBe(200);
    expect(ok.data.status).toBe("held");
    expect(Math.abs(Date.parse(ok.data.expiresAt) - (Date.now() + 48 * 3_600_000))).toBeLessThan(60_000);
    expect(await status(s, w.id)).toBe("reserved");

    expect((await act(s, h1.data.id, "approve-hold", ok.data.version)).status).toBe(400);
    const dec = await act(s, h1.data.id, "decline", ok.data.version);
    expect(dec.status).toBe(200);
    expect(dec.data.status).toBe("declined");
    expect(await status(s, w.id)).toBe("available");

    // a new hold, approved, then 49 hours pass
    const h2 = await lead(slug, "h", { kind: "hold", works: [w.slug], source: "chat" });
    const a2 = await act(s, h2.data.id, "approve-hold", (await getLead(s, h2.data.id)).version);
    expect(a2.data.status).toBe("held");
    expect(await status(s, w.id)).toBe("reserved");
    // the action reads the clock itself, so move the clock as well as the job's `now`
    const later = new Date(Date.now() + 49 * 3_600_000);
    vi.useFakeTimers({ toFake: ["Date"], now: later });
    let n: number;
    try { n = await expireHolds(env as any, later.toISOString()); } finally { vi.useRealTimers(); }
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await status(s, w.id)).toBe("available");
    expect((await getLead(s, h2.data.id)).status).toBe("closed");

    // an inquiry is not a hold; a stale If-Match is 409
    const inq = await lead(slug, "h", { works: [w.slug] });
    const li = await getLead(s, inq.data.id);
    expect((await act(s, inq.data.id, "approve-hold", li.version)).status).toBe(400);
    expect((await act(s, inq.data.id, "close", li.version + 5)).status).toBe(409);
  });

  it("a client-role member can't read the leads", async () => {
    const c = await makeStudio("Portal", "client");
    expect((await call("/v1/leads", { cookie: c.cookie })).status).toBe(403);
    expect((await call("/v1/leads")).status).toBe(401);
  });
});

describe("the daily summary", () => {
  it("lists the question it handed to the artist and the lead; a quiet studio gets nothing", async () => {
    const { s, slug } = await setup("Summary Studio");
    const quiet = await makeStudio("Quiet Studio");
    const w = await work(s, { title: "Heron" });
    await chat(slug, "q", { user: "Can you paint my dog's portrait by Friday?", reply: "Please ask the artist.", askArtist: true, origin: "https://site.example" });
    expect((await lead(slug, "q", { works: [w.slug], name: "Bea Buyer" })).status).toBe(201);
    mails = [];

    const sent = await dailySummaries(env as any, new Date().toISOString());
    expect(sent).toBeGreaterThanOrEqual(1);
    const mine = mails.filter((m) => m.to.includes(ownerEmail(s)));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toContain("your site today");
    expect(mine[0]!.text).toContain("Can you paint my dog's portrait by Friday?");
    expect(mine[0]!.text).toContain("Bea Buyer");
    expect(mails.filter((m) => m.to.includes(ownerEmail(quiet)))).toHaveLength(0);
    void newId;
  });
});
