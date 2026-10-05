// Gate item 5: for every route, a user of studio A acting on studio B's
// records gets 404 (D-016) and B's data is unchanged. The last test fails if
// a route exists that this file doesn't cover.
import { env } from "cloudflare:test";
import { SYNC_PUSH_MAX_OPS, newId } from "@studio/core";
import { beforeAll, describe, expect, it } from "vitest";
import { ASSISTANT, BASE, call, makeStudio, type Studio } from "./helpers";

let A: Studio;
let B: Studio;
const b: Record<string, any> = {};

/** Everything studio B owns, to prove nothing changed. */
async function snapshotB() {
  const out: Record<string, unknown> = {};
  for (const t of ["artworks", "clients", "shows", "sales", "placements", "files", "studio_settings", "activity_log", "memberships",
    "assistant_policy", "pending_actions", "assistant_messages"]) {
    out[t] = (await env.DB.prepare(`SELECT * FROM ${t} WHERE studio_id = ? ORDER BY 1`).bind(B.studioId).all()).results;
  }
  return out;
}

beforeAll(async () => {
  A = await makeStudio("A");
  B = await makeStudio("B");
  b.artwork = (await call("/v1/artworks", { method: "POST", cookie: B.cookie, json: { title: "B's heron" } })).data;
  b.client = (await call("/v1/clients", { method: "POST", cookie: B.cookie, json: { name: "B's client" } })).data;
  b.show = (await call("/v1/shows", { method: "POST", cookie: B.cookie, json: { name: "B's show" } })).data;
  b.sale = (await call("/v1/sales", { method: "POST", cookie: B.cookie, json: { showId: b.show.id, title: "B's sale" } })).data;
  b.placement = (await call("/v1/placements", { method: "POST", cookie: B.cookie,
    json: { name: "B's booth", format: "booth-studio/1", scene: { art: [] } } })).data;
  const pup = (await call("/v1/files/upload-url", { method: "POST", cookie: B.cookie, json: { name: "p.jpg", contentType: "image/jpeg", size: 3 } })).data;
  await call(pup.uploadUrl.replace(BASE, ""), { method: "PUT", body: "abc", headers: { "Content-Length": "3" } });
  b.placementFile = (await call(`/v1/files/${pup.file.id}/attach`, { method: "POST", cookie: B.cookie, json: { entityType: "placement", entityId: b.placement.id } })).data;
  const up = (await call("/v1/files/upload-url", { method: "POST", cookie: B.cookie, json: { name: "b.jpg", contentType: "image/jpeg", size: 3 } })).data;
  await call(up.uploadUrl.replace(BASE, ""), { method: "PUT", body: "abc", headers: { "Content-Length": "3" } });
  b.file = (await call(`/v1/files/${up.file.id}/attach`, { method: "POST", cookie: B.cookie, json: { entityType: "artwork", entityId: b.artwork.id } })).data;
  b.logId = (await call("/v1/activity", { cookie: B.cookie })).data.items[0].id;
  b.card = (await call("/v1/assistant/act", { method: "POST", cookie: B.cookie, headers: ASSISTANT,
    json: { action: "sale.create", input: { title: "B's card", showId: b.show.id }, summary: "B" } })).data.proposal;
  await call("/v1/assistant/policy/show.create", { method: "PUT", cookie: B.cookie, json: { level: "confirm" } });
  const thread = (await call("/v1/assistant/thread", { cookie: B.cookie })).data.threadId;
  await call("/v1/assistant/thread/messages", { method: "POST", cookie: B.cookie, headers: ASSISTANT,
    json: { threadId: thread, app: null, messages: [{ role: "user", content: "B's words" }] } });
  b.thread = thread;
  b.opKey = newId();
  await call("/v1/artworks", { method: "POST", cookie: B.cookie, headers: { "Idempotency-Key": b.opKey }, json: { title: "B keyed" } });
});

const covered = new Set<string>();
const cases: [string, string, () => Promise<{ status: number; data: any }>][] = [];
const attempt = (method: string, path: string, fn: () => Promise<{ status: number; data: any }>) => {
  covered.add(`${method} ${path}`);
  cases.push([method, path, fn]);
};

attempt("get", "/artworks/{id}", () => call(`/v1/artworks/${b.artwork.id}`, { cookie: A.cookie }));
attempt("patch", "/artworks/{id}", () => call(`/v1/artworks/${b.artwork.id}`, { method: "PATCH", cookie: A.cookie, headers: { "If-Match": "1" }, json: { title: "pwned" } }));
attempt("delete", "/artworks/{id}", () => call(`/v1/artworks/${b.artwork.id}`, { method: "DELETE", cookie: A.cookie, headers: { "If-Match": "1" } }));
attempt("get", "/clients/{id}", () => call(`/v1/clients/${b.client.id}`, { cookie: A.cookie }));
attempt("patch", "/clients/{id}", () => call(`/v1/clients/${b.client.id}`, { method: "PATCH", cookie: A.cookie, headers: { "If-Match": "1" }, json: { name: "pwned" } }));
attempt("delete", "/clients/{id}", () => call(`/v1/clients/${b.client.id}`, { method: "DELETE", cookie: A.cookie, headers: { "If-Match": "1" } }));
attempt("get", "/shows/{id}", () => call(`/v1/shows/${b.show.id}`, { cookie: A.cookie }));
attempt("patch", "/shows/{id}", () => call(`/v1/shows/${b.show.id}`, { method: "PATCH", cookie: A.cookie, headers: { "If-Match": "1" }, json: { name: "pwned" } }));
attempt("delete", "/shows/{id}", () => call(`/v1/shows/${b.show.id}`, { method: "DELETE", cookie: A.cookie, headers: { "If-Match": "1" } }));
attempt("get", "/sales/{id}", () => call(`/v1/sales/${b.sale.id}`, { cookie: A.cookie }));
attempt("patch", "/sales/{id}", () => call(`/v1/sales/${b.sale.id}`, { method: "PATCH", cookie: A.cookie, headers: { "If-Match": "1" }, json: { priceCents: 1 } }));
attempt("delete", "/sales/{id}", () => call(`/v1/sales/${b.sale.id}`, { method: "DELETE", cookie: A.cookie, headers: { "If-Match": "1" } }));
attempt("get", "/placements/{id}", () => call(`/v1/placements/${b.placement.id}`, { cookie: A.cookie }));
attempt("patch", "/placements/{id}", () => call(`/v1/placements/${b.placement.id}`, { method: "PATCH", cookie: A.cookie, headers: { "If-Match": "1" }, json: { name: "pwned" } }));
attempt("delete", "/placements/{id}", () => call(`/v1/placements/${b.placement.id}`, { method: "DELETE", cookie: A.cookie, headers: { "If-Match": "1" } }));
cases.push(["post", "/actions/placement.restore", () => call("/v1/actions/placement.restore", { method: "POST", cookie: A.cookie, json: { id: b.placement.id } })]);
cases.push(["get", "/files/{id}/download-url (B's placement image)", () => call(`/v1/files/${b.placementFile.id}/download-url`, { cookie: A.cookie })]);
// Named actions with B's ids (these all go through POST /actions/{name}).
cases.push(["post", "/actions/show.add_artwork", () => call("/v1/actions/show.add_artwork", { method: "POST", cookie: A.cookie, json: { showId: b.show.id, artworkId: b.artwork.id } })]);
cases.push(["post", "/actions/sale.restore", () => call("/v1/actions/sale.restore", { method: "POST", cookie: A.cookie, json: { id: b.sale.id } })]);
cases.push(["post", "/actions/artwork.mark_sold", () => call("/v1/actions/artwork.mark_sold", { method: "POST", cookie: A.cookie, json: { artworkId: b.artwork.id, priceCents: 1 } })]);
attempt("post", "/activity/{id}/undo", () => call(`/v1/activity/${b.logId}/undo`, { method: "POST", cookie: A.cookie }));
attempt("post", "/files/{id}/attach", () => call(`/v1/files/${b.file.id}/attach`, { method: "POST", cookie: A.cookie, json: { entityType: "artwork", entityId: b.artwork.id } }));
attempt("get", "/files/{id}/download-url", () => call(`/v1/files/${b.file.id}/download-url`, { cookie: A.cookie }));
attempt("post", "/actions/{name}", () => call("/v1/actions/artwork.update", { method: "POST", cookie: A.cookie, json: { id: b.artwork.id, version: 1, patch: { title: "pwned" } } }));
attempt("post", "/assistant/proposals/{id}/confirm", () => call(`/v1/assistant/proposals/${b.card.id}/confirm`, { method: "POST", cookie: A.cookie }));
attempt("post", "/assistant/proposals/{id}/cancel", () => call(`/v1/assistant/proposals/${b.card.id}/cancel`, { method: "POST", cookie: A.cookie }));
attempt("post", "/assistant/act", () => call("/v1/assistant/act", { method: "POST", cookie: A.cookie, headers: ASSISTANT,
  json: { action: "show.update", input: { id: b.show.id, patch: { name: "pwned" } }, summary: "x" } }));
cases.push(["post", "/assistant/act (sale naming B's show)", () => call("/v1/assistant/act", { method: "POST", cookie: A.cookie, headers: ASSISTANT,
  json: { action: "sale.create", input: { title: "x", showId: b.show.id }, summary: "x" } })]);
attempt("post", "/auth/studio", () => call("/v1/auth/studio", { method: "POST", cookie: A.cookie, json: { studioId: B.studioId } }));

describe("studio A can't reach studio B", () => {
  it.each(cases)("%s %s → 404, B unchanged", async (_m, _p, fn) => {
    const before = await snapshotB();
    const res = await fn();
    expect(res.status).toBe(404);
    expect(res.data.error.code).toBe("not_found");
    expect(await snapshotB()).toEqual(before);
  });

  it("sync push with B's ids is rejected per op, and B is unchanged", async () => {
    covered.add("post /sync/push");
    const before = await snapshotB();
    const ops = [
      { opId: newId(), action: "artwork.update", entityId: b.artwork.id, baseVersion: 1, input: { patch: { title: "pwned" } } },
      { opId: newId(), action: "artwork.delete", entityId: b.artwork.id, baseVersion: 1, input: {} },
      { opId: newId(), action: "artwork.mark_sold", entityId: b.artwork.id, baseVersion: null, input: { artworkId: b.artwork.id, priceCents: 1 } },
      { opId: newId(), action: "show.add_artwork", entityId: newId(), baseVersion: null, input: { showId: b.show.id, artworkId: b.artwork.id } },
      { opId: newId(), action: "sale.update", entityId: b.sale.id, baseVersion: 1, input: { patch: { priceCents: 1 } } },
      { opId: newId(), action: "sale.create", entityId: newId(), baseVersion: null, input: { showId: b.show.id } },
      { opId: newId(), action: "show.restore", entityId: b.show.id, baseVersion: null, input: { id: b.show.id } },
      { opId: newId(), action: "placement.update", entityId: b.placement.id, baseVersion: 1, input: { patch: { name: "pwned" } } },
      { opId: newId(), action: "placement.delete", entityId: b.placement.id, baseVersion: 1, input: {} },
    ];
    // One push answers SYNC_PUSH_MAX_OPS ops (D-050), so send them the way a device would.
    const results: any[] = [];
    for (let i = 0; i < ops.length; i += SYNC_PUSH_MAX_OPS) {
      results.push(...(await call("/v1/sync/push", { method: "POST", cookie: A.cookie, json: { ops: ops.slice(i, i + SYNC_PUSH_MAX_OPS) } })).data.results);
    }
    expect(results.map((r: any) => [r.status, r.error?.code])).toEqual(ops.map(() => ["rejected", "not_found"]));
    expect(await snapshotB()).toEqual(before);
  });

  it("sync pull never returns B's records", async () => {
    covered.add("get /sync/pull");
    const res = await call("/v1/sync/pull?since=0&limit=500", { cookie: A.cookie });
    const bIds = new Set([b.artwork.id, b.client.id, b.show.id, b.sale.id, b.file.id, b.placement.id, b.placementFile.id, B.studioId]);
    expect(res.data.changes.filter((c: any) => bIds.has(c.entityId))).toEqual([]);
  });

  it("A's own file can't be attached to B's artwork", async () => {
    const up = (await call("/v1/files/upload-url", { method: "POST", cookie: A.cookie, json: { name: "a.jpg", contentType: "image/jpeg", size: 3 } })).data;
    await call(up.uploadUrl.replace(BASE, ""), { method: "PUT", body: "abc", headers: { "Content-Length": "3" } });
    const before = await snapshotB();
    const res = await call(`/v1/files/${up.file.id}/attach`, { method: "POST", cookie: A.cookie, json: { entityType: "artwork", entityId: b.artwork.id } });
    expect(res.status).toBe(404);
    expect(await snapshotB()).toEqual(before);
  });

  it("A's own file can't be attached to B's placement", async () => {
    const up = (await call("/v1/files/upload-url", { method: "POST", cookie: A.cookie, json: { name: "a.jpg", contentType: "image/jpeg", size: 3 } })).data;
    await call(up.uploadUrl.replace(BASE, ""), { method: "PUT", body: "abc", headers: { "Content-Length": "3" } });
    const before = await snapshotB();
    const res = await call(`/v1/files/${up.file.id}/attach`, { method: "POST", cookie: A.cookie, json: { entityType: "placement", entityId: b.placement.id } });
    expect(res.status).toBe(404);
    expect(await snapshotB()).toEqual(before);
  });

  // List and create routes take no id: prove they only ever see or write A's studio.
  for (const [method, path, check] of [
    ["get", "/artworks", async () => expect((await call("/v1/artworks", { cookie: A.cookie })).data.items).toEqual([])],
    ["get", "/clients", async () => expect((await call("/v1/clients", { cookie: A.cookie })).data.items).toEqual([])],
    ["get", "/activity", async () => {
      expect((await call("/v1/activity", { cookie: A.cookie })).data.items.every((e: any) => e.entityId !== b.artwork.id)).toBe(true);
      expect((await call(`/v1/activity?entityId=${b.artwork.id}`, { cookie: A.cookie })).data.items).toEqual([]);
    }],
    ["get", "/settings", async () => expect((await call("/v1/settings", { cookie: A.cookie })).data.studioId).toBe(A.studioId)],
    ["patch", "/settings", async () => {
      const v = (await call("/v1/settings", { cookie: A.cookie })).data.version;
      await call("/v1/settings", { method: "PATCH", cookie: A.cookie, headers: { "If-Match": String(v) }, json: { emailTone: "warm" } });
    }],
    ["post", "/artworks", async () => {
      // B's Idempotency-Key, reused by A, must not replay B's record.
      const res = await call("/v1/artworks", { method: "POST", cookie: A.cookie, headers: { "Idempotency-Key": b.opKey }, json: { title: "A keyed" } });
      expect(res.data).toMatchObject({ title: "A keyed", studioId: A.studioId });
    }],
    ["get", "/shows", async () => expect((await call("/v1/shows", { cookie: A.cookie })).data.items).toEqual([])],
    ["post", "/shows", async () => expect((await call("/v1/shows", { method: "POST", cookie: A.cookie, json: { name: "A's" } })).data.studioId).toBe(A.studioId)],
    ["get", "/sales", async () => expect((await call("/v1/sales", { cookie: A.cookie })).data.items).toEqual([])],
    ["post", "/sales", async () => expect((await call("/v1/sales", { method: "POST", cookie: A.cookie, json: { title: "A's" } })).data.studioId).toBe(A.studioId)],
    ["get", "/placements", async () => expect((await call("/v1/placements", { cookie: A.cookie })).data.items).toEqual([])],
    ["post", "/placements", async () => expect((await call("/v1/placements", { method: "POST", cookie: A.cookie,
      json: { name: "A's booth", format: "booth-studio/1" } })).data.studioId).toBe(A.studioId)],
    ["post", "/clients", async () => expect((await call("/v1/clients", { method: "POST", cookie: A.cookie, json: { name: "A's" } })).data.studioId).toBe(A.studioId)],
    ["get", "/assistant/proposals", async () => expect((await call("/v1/assistant/proposals", { cookie: A.cookie })).data.items).toEqual([])],
    ["get", "/search", async () => expect((await call("/v1/search?q=B's", { cookie: A.cookie })).data.items).toEqual([])],
    ["get", "/assistant/tools", async () => {
      // B set show.create to confirm; A's tools still say auto.
      const tools = (await call("/v1/assistant/tools?app=show-tracker", { cookie: A.cookie })).data.tools;
      expect(tools.find((t: any) => t.name === "show_create").level).toBe("auto");
    }],
    ["get", "/assistant/policy", async () => {
      const items = (await call("/v1/assistant/policy", { cookie: A.cookie })).data.items;
      expect(items.find((p: any) => p.action === "show.create").studioLevel).toBeNull();
    }],
    ["put", "/assistant/policy/{action}", async () => {
      expect((await call("/v1/assistant/policy/show.create", { method: "PUT", cookie: A.cookie, json: { level: "never" } })).status).toBe(200);
    }],
    ["get", "/assistant/thread", async () => {
      const t = (await call("/v1/assistant/thread", { cookie: A.cookie })).data;
      expect(t.threadId).not.toBe(b.thread);
      expect(t.messages).toEqual([]);
      // B's conversation by id: not found for A.
      expect((await call(`/v1/assistant/thread?id=${b.thread}`, { cookie: A.cookie })).status).toBe(404);
    }],
    ["get", "/assistant/threads", async () => {
      expect((await call("/v1/assistant/threads", { cookie: A.cookie })).data.items.map((t: any) => t.title)).not.toContain("B's words");
    }],
    ["post", "/assistant/thread/messages", async () => {
      // Even naming B's thread id, the message lands in A's studio, as A's.
      expect((await call("/v1/assistant/thread/messages", { method: "POST", cookie: A.cookie, headers: ASSISTANT,
        json: { threadId: b.thread, app: null, messages: [{ role: "user", content: "A's words" }] } })).status).toBe(200);
      expect((await call("/v1/assistant/thread", { cookie: B.cookie })).data.messages.map((m: any) => m.content)).toEqual(["B's words"]);
    }],
    ["post", "/files/upload-url", async () => {
      const res = await call("/v1/files/upload-url", { method: "POST", cookie: A.cookie, json: { name: "x.jpg", contentType: "image/jpeg", size: 1 } });
      expect(res.data.file.studioId).toBe(A.studioId);
    }],
  ] as const) {
    covered.add(`${method} ${path}`);
    it(`${method.toUpperCase()} ${path} stays inside A's studio`, async () => {
      const before = await snapshotB();
      await check();
      expect(await snapshotB()).toEqual(before);
    });
  }

  it("covers every route in the API", async () => {
    // Not studio-scoped: sign-in (no studio yet), /me (the caller's own memberships),
    // the signed content links (the signature names one file), and the spec itself.
    const exempt = new Set([
      "post /auth/code", "post /auth/verify", "post /auth/logout", "get /me",
      "put /files/{id}/content", "get /files/{id}/content",
    ]);
    const doc = (await call("/v1/openapi.json")).data;
    const all = Object.entries(doc.paths as Record<string, object>).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m} ${p}`));
    const missing = all.filter((r) => !covered.has(r) && !exempt.has(r));
    expect(missing).toEqual([]);
  });
});
