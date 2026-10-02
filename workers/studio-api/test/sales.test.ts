// Sales (D-035): the Show Tracker's sale rows. Null stays null: an unpriced
// sale is not $0 and an undated one is not today.
import { newId } from "@studio/core";
import { describe, expect, it } from "vitest";
import { call, makeStudio } from "./helpers";

const push = (cookie: string, ops: unknown[]) => call("/v1/sync/push", { method: "POST", cookie, json: { ops } });
const op = (action: string, entityId: string, input: Record<string, unknown>, baseVersion: number | null = null) =>
  ({ opId: newId(), action, entityId, baseVersion, input });

describe("sales", () => {
  it("records a sale at a show, and unknowns stay null", async () => {
    const a = await makeStudio();
    const show = (await call("/v1/shows", { method: "POST", cookie: a.cookie, json: { name: "Coconut Grove" } })).data;
    const res = await call("/v1/sales", { method: "POST", cookie: a.cookie, json: {
      showId: show.id, title: "Heron, small", priceCents: 45000, soldOn: "2026-02-14", paymentMethod: "card",
      size: "8 x 10 in", source: "square", externalId: "sq-1",
    } });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ showId: show.id, priceCents: 45000, quantity: 1, currency: "USD", version: 1 });

    const bare = (await call("/v1/sales", { method: "POST", cookie: a.cookie, json: {} })).data;
    expect(bare).toMatchObject({ showId: null, artworkId: null, title: null, priceCents: null, soldOn: null,
      paymentMethod: null, quantity: 1, source: "manual" });
  });

  it("refuses a made-up shape: negative price, zero quantity, a free-text date or method", async () => {
    const a = await makeStudio();
    for (const json of [{ priceCents: -1 }, { quantity: 0 }, { soldOn: "Feb 14" }, { paymentMethod: "venmo" }, { priceCents: 12.5 }]) {
      expect((await call("/v1/sales", { method: "POST", cookie: a.cookie, json })).status).toBe(400);
    }
  });

  it("edits need the version, and delete is soft", async () => {
    const a = await makeStudio();
    const sale = (await call("/v1/sales", { method: "POST", cookie: a.cookie, json: { title: "Heron" } })).data;
    expect((await call(`/v1/sales/${sale.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "2" }, json: { priceCents: 100 } })).status).toBe(409);
    const up = await call(`/v1/sales/${sale.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { priceCents: 100 } });
    expect(up.data).toMatchObject({ priceCents: 100, version: 2 });
    expect((await call(`/v1/sales/${sale.id}`, { method: "DELETE", cookie: a.cookie, headers: { "If-Match": "2" } })).status).toBe(200);
    expect((await call(`/v1/sales/${sale.id}`, { cookie: a.cookie })).status).toBe(404);
    expect((await call("/v1/sales", { cookie: a.cookie })).data.items).toEqual([]);
  });

  it("a show or artwork from another studio is not found", async () => {
    const a = await makeStudio("A");
    const b = await makeStudio("B");
    const bShow = (await call("/v1/shows", { method: "POST", cookie: b.cookie, json: { name: "B's" } })).data;
    const bArt = (await call("/v1/artworks", { method: "POST", cookie: b.cookie, json: { title: "B's" } })).data;
    expect((await call("/v1/sales", { method: "POST", cookie: a.cookie, json: { showId: bShow.id } })).status).toBe(404);
    expect((await call("/v1/sales", { method: "POST", cookie: a.cookie, json: { artworkId: bArt.id } })).status).toBe(404);
    const mine = (await call("/v1/sales", { method: "POST", cookie: a.cookie, json: {} })).data;
    expect((await call(`/v1/sales/${mine.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { showId: bShow.id } })).status).toBe(404);
  });

  it("staff can log sales but not delete them", async () => {
    const s = await makeStudio("S", "staff");
    const sale = (await call("/v1/sales", { method: "POST", cookie: s.cookie, json: { title: "x" } })).data;
    expect(sale.version).toBe(1);
    expect((await call(`/v1/sales/${sale.id}`, { method: "DELETE", cookie: s.cookie, headers: { "If-Match": "1" } })).status).toBe(403);
  });

  it("sync: two devices each logging a sale offline end up with both", async () => {
    const a = await makeStudio();
    const showId = newId();
    await push(a.cookie, [op("show.create", showId, { name: "Grove" })]);
    const phone = op("sale.create", newId(), { showId, title: "Heron", priceCents: 45000 });
    const laptop = op("sale.create", newId(), { showId, title: "Egret", priceCents: null });
    expect((await push(a.cookie, [phone])).data.results[0].status).toBe("applied");
    expect((await push(a.cookie, [laptop])).data.results[0].status).toBe("applied");
    const pulled = (await call("/v1/sync/pull?since=0", { cookie: a.cookie })).data.changes.filter((c: any) => c.entityType === "sale");
    expect(pulled.map((c: any) => c.record.title).sort()).toEqual(["Egret", "Heron"]);
    expect(pulled.find((c: any) => c.record.title === "Egret").record.priceCents).toBeNull();
  });

  it("sync: a price edited on two devices never auto-merges", async () => {
    const a = await makeStudio();
    const id = newId();
    await push(a.cookie, [op("sale.create", id, { title: "Heron", priceCents: 45000 })]);
    await push(a.cookie, [op("sale.update", id, { patch: { notes: "laptop" } }, 1)]);
    const r = (await push(a.cookie, [op("sale.update", id, { patch: { priceCents: 40000, title: "Great Heron" } }, 1)])).data.results[0];
    expect(r.status).toBe("conflict");
    expect(r.conflicts.map((c: any) => c.field)).toEqual(["priceCents"]);
    expect(r.record).toMatchObject({ priceCents: 45000, title: "Great Heron", notes: "laptop" });
  });
});
