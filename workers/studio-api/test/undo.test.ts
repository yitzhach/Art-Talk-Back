import { describe, expect, it } from "vitest";
import { call, makeStudio } from "./helpers";

async function setup() {
  const a = await makeStudio();
  const { data: art } = await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "Heron", priceCents: 1000 } });
  return { a, art };
}
const lastLog = async (cookie: string, id: string) => (await call(`/v1/activity?entityId=${id}`, { cookie })).data.items[0];

describe("undo (D-007)", () => {
  it("restores the previous state as a new, logged change", async () => {
    const { a, art } = await setup();
    await call(`/v1/artworks/${art.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { priceCents: 5000, title: "Great Heron" } });
    const edit = await lastLog(a.cookie, art.id);

    const undo = await call(`/v1/activity/${edit.id}/undo`, { method: "POST", cookie: a.cookie });
    expect(undo.status).toBe(200);
    const now = (await call(`/v1/artworks/${art.id}`, { cookie: a.cookie })).data;
    expect(now).toMatchObject({ title: "Heron", priceCents: 1000, version: 3 });

    const log = (await call(`/v1/activity?entityId=${art.id}`, { cookie: a.cookie })).data.items;
    expect(log[0]).toMatchObject({ action: "activity.undo", undoOf: edit.id });
    expect(log[1]).toMatchObject({ id: edit.id });
    expect(log[1].undoneAt).toBeTruthy();
  });

  it("refuses if the record changed since that edit", async () => {
    const { a, art } = await setup();
    await call(`/v1/artworks/${art.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { priceCents: 5000 } });
    const edit = await lastLog(a.cookie, art.id);
    await call(`/v1/artworks/${art.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "2" }, json: { title: "Later" } });
    const res = await call(`/v1/activity/${edit.id}/undo`, { method: "POST", cookie: a.cookie });
    expect(res.status).toBe(409);
    expect((await call(`/v1/artworks/${art.id}`, { cookie: a.cookie })).data).toMatchObject({ title: "Later", priceCents: 5000 });
  });

  it("undoing a create deletes; undoing a delete restores", async () => {
    const { a, art } = await setup();
    const create = await lastLog(a.cookie, art.id);
    await call(`/v1/activity/${create.id}/undo`, { method: "POST", cookie: a.cookie });
    expect((await call(`/v1/artworks/${art.id}`, { cookie: a.cookie })).status).toBe(404);

    const undoEntry = await lastLog(a.cookie, art.id);
    await call(`/v1/activity/${undoEntry.id}/undo`, { method: "POST", cookie: a.cookie });
    expect((await call(`/v1/artworks/${art.id}`, { cookie: a.cookie })).data).toMatchObject({ title: "Heron", deletedAt: null });
  });

  it("can't undo the same change twice", async () => {
    const { a, art } = await setup();
    await call(`/v1/artworks/${art.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { title: "x" } });
    const edit = await lastLog(a.cookie, art.id);
    expect((await call(`/v1/activity/${edit.id}/undo`, { method: "POST", cookie: a.cookie })).status).toBe(200);
    expect((await call(`/v1/activity/${edit.id}/undo`, { method: "POST", cookie: a.cookie })).status).toBe(409);
  });

  it("works for settings too", async () => {
    const a = await makeStudio();
    await call("/v1/settings", { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { currency: "EUR" } });
    const edit = (await call("/v1/activity?entityType=settings", { cookie: a.cookie })).data.items[0];
    await call(`/v1/activity/${edit.id}/undo`, { method: "POST", cookie: a.cookie });
    expect((await call("/v1/settings", { cookie: a.cookie })).data.currency).toBe("USD");
  });
});
