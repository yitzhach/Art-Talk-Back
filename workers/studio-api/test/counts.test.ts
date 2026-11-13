// Visitor numbers (card G, D-177): the public site adds one to a count, only for a public piece,
// capped per day and with nothing about the visitor; the studio reads its own numbers.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { DAILY_CAP, utcDay } from "../src/lib/counts";
import { makeWork, studioSlug } from "./catalogue-helpers";
import { call, makeStudio, type Studio } from "./helpers";

let A: Studio, staff: Studio, slug: string;
const w: Record<string, any> = {};
const count = (json: unknown, headers: Record<string, string> = {}) => call(`/v1/public/studios/${slug}/counts`, { method: "POST", json, headers });
const rows = async () => (await env.DB.prepare("SELECT kind, artwork_id, n FROM site_counts WHERE studio_id = ? ORDER BY kind, artwork_id").bind(A.studioId).all()).results;

beforeAll(async () => {
  A = await makeStudio("A");
  slug = await studioSlug(A.studioId);
  w.heron = await makeWork(A, { title: "Heron" }, { publish: true });
  w.draft = await makeWork(A, { title: "Draft" });
  w.photo = await makeWork(A, { title: "Banner", kind: "site_photo" }, { publish: true });
});

describe("the public count route", () => {
  it("counts a view of a public piece, and says nothing back", async () => {
    const r = await count({ kind: "view", work: w.heron.work.slug }, { cookie: "sv=someone" });
    expect(r.status).toBe(204);
    expect(r.raw).toBe("");
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(await rows()).toEqual([{ kind: "view", artwork_id: w.heron.work.id, n: 1 }]);
  });

  it("keeps nothing about the visitor: the table has no such column", async () => {
    const cols = (await env.DB.prepare("PRAGMA table_info(site_counts)").all()).results.map((c: any) => c.name);
    expect(cols.sort()).toEqual(["artwork_id", "day", "kind", "n", "studio_id"]);
  });

  it("quietly skips a piece that isn't public, a site photo, an unknown piece and a view of no piece", async () => {
    const before = await rows();
    for (const body of [{ kind: "view", work: w.draft.work.slug ?? "draft" }, { kind: "view", work: w.photo.work.slug }, { kind: "ask", work: "no-such-piece" }, { kind: "view" }]) {
      expect((await count(body)).status).toBe(204);
    }
    expect(await rows()).toEqual(before);
  });

  it("counts Ask, the wall and an inquiry, with or without a piece", async () => {
    await count({ kind: "ask" });
    await count({ kind: "wall", work: w.heron.work.slug });
    await count({ kind: "inquiry", work: w.heron.work.slug });
    const got = await rows();
    expect(got).toContainEqual({ kind: "ask", artwork_id: "", n: 1 });
    expect(got).toContainEqual({ kind: "wall", artwork_id: w.heron.work.id, n: 1 });
    expect(got).toContainEqual({ kind: "inquiry", artwork_id: w.heron.work.id, n: 1 });
  });

  it("refuses a kind it doesn't know, and a studio that doesn't exist", async () => {
    expect((await count({ kind: "order" })).status).toBe(400);
    expect((await count({ kind: "question" })).status).toBe(400);
    expect((await call("/v1/public/studios/no-such-studio/counts", { method: "POST", json: { kind: "ask" } })).status).toBe(404);
  });

  it("stops at the day's cap", async () => {
    await env.DB.prepare("INSERT INTO site_counts (studio_id, day, kind, artwork_id, n) VALUES (?, ?, 'ask', 'cap-test', ?)")
      .bind(A.studioId, utcDay(), DAILY_CAP - 1).run();
    const capped = async () => Number((await env.DB.prepare("SELECT n FROM site_counts WHERE studio_id = ? AND artwork_id = 'cap-test'").bind(A.studioId).first<any>()).n);
    const { bump } = await import("../src/lib/counts");
    await bump(env.DB, A.studioId, "ask", "cap-test");
    expect(await capped()).toBe(DAILY_CAP);
    await bump(env.DB, A.studioId, "ask", "cap-test");
    expect(await capped()).toBe(DAILY_CAP);
    await env.DB.prepare("DELETE FROM site_counts WHERE artwork_id = 'cap-test'").run();
  });
});

describe("the studio's numbers", () => {
  it("needs a signed-in studio member", async () => {
    expect((await call("/v1/site/counts")).status).toBe(401);
    staff = await makeStudio("Staff", "client");
    expect((await call("/v1/site/counts", { cookie: staff.cookie })).status).toBe(403);
  });

  it("adds up the counts and the studio's own questions, leads and orders, newest days only", async () => {
    const old = utcDay(new Date(Date.now() - 40 * 86_400_000));
    await env.DB.prepare("INSERT INTO site_counts (studio_id, day, kind, artwork_id, n) VALUES (?, ?, 'view', ?, 50)").bind(A.studioId, old, w.heron.work.id).run();
    const now = new Date().toISOString();
    const vid = `v-${A.studioId}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO visitors (id, studio_id, key_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(vid, A.studioId, `k-${vid}`, now, now),
      env.DB.prepare("INSERT INTO visitor_messages (id, studio_id, visitor_id, thread_id, role, text, created_at, updated_at) VALUES (?, ?, ?, 't', 'user', 'Is it framed?', ?, ?)").bind(`m1-${vid}`, A.studioId, vid, now, now),
      env.DB.prepare("INSERT INTO visitor_messages (id, studio_id, visitor_id, thread_id, role, text, created_at, updated_at) VALUES (?, ?, ?, 't', 'assistant', 'Yes.', ?, ?)").bind(`m2-${vid}`, A.studioId, vid, now, now),
      env.DB.prepare("INSERT INTO leads (id, studio_id, kind, created_at, updated_at) VALUES (?, ?, 'inquiry', ?, ?)").bind(`l-${vid}`, A.studioId, now, now),
    ]);
    const got = (await call("/v1/site/counts?days=30", { cookie: A.cookie })).data;
    expect(got.days).toBe(30);
    expect(got.totals).toEqual({ view: 1, ask: 1, wall: 1, inquiry: 1, question: 1, lead: 1, order: 0 });
    expect(got.topWorks).toEqual([{ id: w.heron.work.id, title: "Heron", slug: w.heron.work.slug, view: 1, ask: 0, wall: 1, inquiry: 1 }]);
    const longer = (await call("/v1/site/counts?days=90", { cookie: A.cookie })).data;
    expect(longer.totals.view).toBe(51);
  });

  it("refuses a range past 90 days", async () => {
    expect((await call("/v1/site/counts?days=400", { cookie: A.cookie })).status).toBe(400);
  });
});
