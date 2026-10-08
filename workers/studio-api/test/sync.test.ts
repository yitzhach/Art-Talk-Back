import { env } from "cloudflare:test";
import { newId } from "@studio/core";
import { describe, expect, it } from "vitest";
import { SYNC_PUSH_MAX_OPS } from "@studio/core";
import { call, countingEnv, makeStudio, rowCount } from "./helpers";

const push = (cookie: string, ops: unknown[]) => call("/v1/sync/push", { method: "POST", cookie, json: { ops } });
const op = (action: string, entityId: string, input: Record<string, unknown>, baseVersion: number | null = null) =>
  ({ opId: newId(), action, entityId, baseVersion, input });

async function pullAll(cookie: string, since = "0") {
  const changes: any[] = [];
  let cursor = since;
  for (;;) {
    const res = await call(`/v1/sync/pull?since=${cursor}&limit=2`, { cookie });
    changes.push(...res.data.changes);
    cursor = res.data.cursor;
    if (!res.data.hasMore) return { changes, cursor };
  }
}

describe("sync push", () => {
  it("applies creates made offline with the device's ids, in order", async () => {
    const a = await makeStudio();
    const artId = newId();
    const showId = newId();
    const res = await push(a.cookie, [
      op("artwork.create", artId, { title: "Heron", priceCents: 1000 }),
      op("show.create", showId, { name: "Grove" }),
      op("show.add_artwork", newId(), { showId, artworkId: artId }),
    ]);
    expect(res.status).toBe(200);
    expect(res.data.results.map((r: any) => r.status)).toEqual(["applied", "applied", "applied"]);
    expect(res.data.results[0].record).toMatchObject({ id: artId, version: 1 });
    expect((await call(`/v1/shows/${showId}`, { cookie: a.cookie })).data.artworks).toHaveLength(1);
    // Logged as coming from sync.
    expect(await rowCount("SELECT COUNT(*) AS n FROM activity_log WHERE source = 'sync' AND studio_id = ?", a.studioId)).toBe(3);
  });

  it("a retried op is a duplicate and writes nothing", async () => {
    const a = await makeStudio();
    const create = op("artwork.create", newId(), { title: "Heron" });
    await push(a.cookie, [create]);
    const again = await push(a.cookie, [create]);
    expect(again.data.results[0]).toMatchObject({ status: "duplicate", record: { title: "Heron" } });
    expect(await rowCount("SELECT COUNT(*) AS n FROM artworks WHERE studio_id = ?", a.studioId)).toBe(1);

    const edit = op("artwork.update", create.entityId, { patch: { title: "Great Heron" } }, 1);
    await push(a.cookie, [edit]);
    expect((await push(a.cookie, [edit])).data.results[0].status).toBe("duplicate");
    expect((await call(`/v1/artworks/${create.entityId}`, { cookie: a.cookie })).data.version).toBe(2);
  });

  it("an edit from the current version applies", async () => {
    const a = await makeStudio();
    const art = (await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "Heron" } })).data;
    const res = await push(a.cookie, [op("artwork.update", art.id, { patch: { medium: "Oil" } }, 1)]);
    expect(res.data.results[0]).toMatchObject({ status: "applied", record: { medium: "Oil", version: 2 } });
  });

  describe("merge rules when the device is behind (D-028)", () => {
    async function behind() {
      const a = await makeStudio();
      const art = (await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "Heron", priceCents: 1000 } })).data;
      // Another device changes the title while this one is offline at version 1.
      await call(`/v1/artworks/${art.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { title: "Laptop title" } });
      return { a, art };
    }

    it("different fields merge", async () => {
      const { a, art } = await behind();
      const res = await push(a.cookie, [op("artwork.update", art.id, { patch: { medium: "Oil" } }, 1)]);
      expect(res.data.results[0]).toMatchObject({ status: "merged", record: { title: "Laptop title", medium: "Oil", version: 3 } });
    });

    it("the same field: server keeps its value, device gets a conflict", async () => {
      const { a, art } = await behind();
      const res = await push(a.cookie, [op("artwork.update", art.id, { patch: { title: "Phone title", medium: "Oil" } }, 1)]);
      const r = res.data.results[0];
      expect(r.status).toBe("conflict");
      expect(r.conflicts).toEqual([{ field: "title", serverValue: "Laptop title", deviceValue: "Phone title" }]);
      expect(r.record).toMatchObject({ title: "Laptop title", medium: "Oil" }); // the rest still merged
    });

    it("price and sale status never auto-merge, even if the server didn't touch them", async () => {
      const { a, art } = await behind();
      const res = await push(a.cookie, [op("artwork.update", art.id, { patch: { priceCents: 2000, status: "sold" } }, 1)]);
      const r = res.data.results[0];
      expect(r.status).toBe("conflict");
      expect(r.conflicts.map((c: any) => c.field).sort()).toEqual(["priceCents", "status"]);
      expect((await call(`/v1/artworks/${art.id}`, { cookie: a.cookie })).data).toMatchObject({ priceCents: 1000, status: "available" });
    });

    describe("meta merges per key (D-036)", () => {
      async function showBehind() {
        const a = await makeStudio();
        const show = (await call("/v1/shows", { method: "POST", cookie: a.cookie, json: { name: "Grove", meta: { rating: 7, hidden: false } } })).data;
        // The laptop changes one meta key while the phone is offline at version 1.
        await push(a.cookie, [op("show.update", show.id, { patch: { meta: { rating: 9 } } }, 1)]);
        return { a, show };
      }

      it("a device sends only the keys it changed; the rest of meta is kept", async () => {
        const { a, show } = await showBehind();
        const got = (await call(`/v1/shows/${show.id}`, { cookie: a.cookie })).data;
        expect(got.meta).toEqual({ rating: 9, hidden: false });
      });

      it("different keys merge", async () => {
        const { a, show } = await showBehind();
        const r = (await push(a.cookie, [op("show.update", show.id, { patch: { meta: { hidden: true } } }, 1)])).data.results[0];
        expect(r).toMatchObject({ status: "merged", record: { meta: { rating: 9, hidden: true } } });
      });

      it("the same key: server keeps its value, device gets a conflict on meta.<key>", async () => {
        const { a, show } = await showBehind();
        const r = (await push(a.cookie, [op("show.update", show.id, { patch: { meta: { rating: 3, hidden: true } } }, 1)])).data.results[0];
        expect(r.status).toBe("conflict");
        expect(r.conflicts).toEqual([{ field: "meta.rating", serverValue: 9, deviceValue: 3 }]);
        expect(r.record.meta).toEqual({ rating: 9, hidden: true });
      });

      it("money keys in meta (`*Cents`) never auto-merge", async () => {
        const { a, show } = await showBehind();
        const r = (await push(a.cookie, [op("show.update", show.id, { patch: { meta: { grossSalesCents: 250000 } } }, 1)])).data.results[0];
        expect(r.status).toBe("conflict");
        expect(r.conflicts).toEqual([{ field: "meta.grossSalesCents", serverValue: null, deviceValue: 250000 }]);
        expect(r.record.meta.grossSalesCents).toBeUndefined();
      });
    });

    it("a delete from a device that's behind is a conflict", async () => {
      const { a, art } = await behind();
      const res = await push(a.cookie, [op("artwork.delete", art.id, {}, 1)]);
      expect(res.data.results[0].status).toBe("conflict");
      expect((await call(`/v1/artworks/${art.id}`, { cookie: a.cookie })).status).toBe(200);
    });
  });

  it("one bad op doesn't stop the rest", async () => {
    const a = await makeStudio();
    const res = await push(a.cookie, [
      op("artwork.create", newId(), { title: "" }),
      op("artwork.nuke", newId(), {}),
      op("artwork.update", newId(), { patch: { title: "x" } }, 1),
      op("artwork.create", newId(), { title: "Good" }),
    ]);
    expect(res.data.results.map((r: any) => r.status)).toEqual(["rejected", "rejected", "rejected", "applied"]);
    expect(res.data.results[2].error.code).toBe("not_found");
  });

  it("marking sold offline runs the same confirmed action", async () => {
    const a = await makeStudio();
    const art = (await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "Heron" } })).data;
    const res = await push(a.cookie, [op("artwork.mark_sold", art.id, { artworkId: art.id, priceCents: 5000 })]);
    expect(res.data.results[0].status).toBe("applied");
    expect((await call(`/v1/artworks/${art.id}`, { cookie: a.cookie })).data.status).toBe("sold");
  });
});

describe("sync pull", () => {
  it("returns every changed record once, in pages, and a cursor that only moves forward", async () => {
    const a = await makeStudio();
    const art = (await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "Heron" } })).data;
    await call(`/v1/artworks/${art.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { title: "Heron 2" } });
    await call("/v1/clients", { method: "POST", cookie: a.cookie, json: { name: "Hendersons" } });
    await call("/v1/shows", { method: "POST", cookie: a.cookie, json: { name: "Grove" } });

    const first = await pullAll(a.cookie);
    const ids = first.changes.map((c) => `${c.entityType}:${c.record.title ?? c.record.name}`);
    expect(ids.sort()).toEqual(["artwork:Heron 2", "client:Hendersons", "show:Grove"]);

    // Nothing new → nothing returned, cursor unchanged.
    const again = await pullAll(a.cookie, first.cursor);
    expect(again).toEqual({ changes: [], cursor: first.cursor });

    // A deletion comes through with deletedAt set.
    await call(`/v1/artworks/${art.id}`, { method: "DELETE", cookie: a.cookie, headers: { "If-Match": "2" } });
    const del = await pullAll(a.cookie, first.cursor);
    expect(del.changes).toHaveLength(1);
    expect(del.changes[0].record.deletedAt).toBeTruthy();
    expect(Number(del.cursor)).toBeGreaterThan(Number(first.cursor));
  });

  it("never sends file storage keys", async () => {
    const a = await makeStudio();
    await call("/v1/files/upload-url", { method: "POST", cookie: a.cookie, json: { name: "a.jpg", contentType: "image/jpeg", size: 3 } });
    const { changes } = await pullAll(a.cookie);
    const file = changes.find((c) => c.entityType === "file");
    expect(file.record.r2Key).toBeUndefined();
  });

  it("includes settings changes", async () => {
    const a = await makeStudio();
    await call("/v1/settings", { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { taxRateBps: 700 } });
    const { changes } = await pullAll(a.cookie);
    expect(changes.find((c) => c.entityType === "settings").record.taxRateBps).toBe(700);
    void env;
  });
});

// A Worker on the free plan may run 50 D1 queries per request (D-050).
describe("sync stays inside the D1 query budget", () => {
  it("push answers the first SYNC_PUSH_MAX_OPS ops; the rest are left to send again", async () => {
    const a = await makeStudio();
    const ops = Array.from({ length: SYNC_PUSH_MAX_OPS + 3 }, (_, i) => op("show.create", newId(), { name: `Show ${i}` }));
    const first = await push(a.cookie, ops);
    expect(first.data.results).toHaveLength(SYNC_PUSH_MAX_OPS);
    expect(first.data.results.map((r: any) => r.opId)).toEqual(ops.slice(0, SYNC_PUSH_MAX_OPS).map((o) => o.opId));
    const rest = await push(a.cookie, ops.slice(SYNC_PUSH_MAX_OPS));
    expect(rest.data.results.map((r: any) => r.status)).toEqual(["applied", "applied", "applied"]);
    expect(await rowCount("SELECT COUNT(*) AS n FROM shows WHERE studio_id = ?", a.studioId)).toBe(SYNC_PUSH_MAX_OPS + 3);
  });

  it("the worst push (edits that conflict, sales that link a show and an artwork) runs at most 50 queries", async () => {
    const a = await makeStudio();
    const show = (await call("/v1/shows", { method: "POST", cookie: a.cookie, json: { name: "Grove" } })).data;
    const art = (await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "Heron" } })).data;
    const sales = [];
    for (let i = 0; i < SYNC_PUSH_MAX_OPS; i++) {
      sales.push((await call("/v1/sales", { method: "POST", cookie: a.cookie, json: { title: `S${i}`, showId: show.id, artworkId: art.id, priceCents: 100 } })).data);
    }
    // Move every sale on, so the device's edits (from version 1) go down the merge path.
    for (const s of sales) {
      await call(`/v1/sales/${s.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { notes: "server" } });
    }
    const edits = sales.map((s) => op("sale.update", s.id, { patch: { title: "device", showId: show.id, artworkId: art.id } }, 1));
    const counted = countingEnv();
    const res = await call("/v1/sync/push", { method: "POST", cookie: a.cookie, json: { ops: edits }, env: counted.env });
    expect(res.data.results.map((r: any) => r.status)).toEqual(Array(SYNC_PUSH_MAX_OPS).fill("merged"));
    expect(counted.count.queries).toBeLessThanOrEqual(50);

    const creates = Array.from({ length: SYNC_PUSH_MAX_OPS }, (_, i) =>
      op("sale.create", newId(), { title: `N${i}`, showId: show.id, artworkId: art.id }));
    const c2 = countingEnv();
    const made = await call("/v1/sync/push", { method: "POST", cookie: a.cookie, json: { ops: creates }, env: c2.env });
    expect(made.data.results.every((r: any) => r.status === "applied")).toBe(true);
    expect(c2.count.queries).toBeLessThanOrEqual(50);
  });

  it("a full pull page of 200 changes reads them in a handful of queries", async () => {
    const a = await makeStudio();
    for (let i = 0; i < 4; i++) {
      // 50 shows per push round, written directly through the API's own actions.
      await Promise.all(Array.from({ length: 50 }, (_, j) => call("/v1/shows", { method: "POST", cookie: a.cookie, json: { name: `S${i}-${j}` } })));
    }
    const counted = countingEnv();
    const res = await call("/v1/sync/pull?since=0&limit=200", { cookie: a.cookie, env: counted.env });
    expect(res.data.changes.length).toBeGreaterThanOrEqual(200);
    expect(counted.count.queries).toBeLessThanOrEqual(10);
    // The check is the query count, not the time: writing 200 shows first took
    // over the 5 s default on a busy CI runner (default-branch CI, 2026-10-08).
  }, 30_000);
});
