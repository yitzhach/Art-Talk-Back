import { newId } from "@studio/core";
import { describe, expect, it } from "vitest";
import { call, makeStudio, rowCount } from "./helpers";

describe("artworks and clients", () => {
  for (const [path, create, patch] of [
    ["artworks", { title: "Heron", priceCents: 120000, width: 24, height: 36 }, { status: "sold" }],
    ["clients", { name: "The Hendersons", email: "Ann@Example.com" }, { notes: "Prefers blues" }],
  ] as const) {
    it(`${path}: create, read, edit with If-Match, soft-delete, all logged`, async () => {
      const a = await makeStudio();
      const created = await call(`/v1/${path}`, { method: "POST", cookie: a.cookie, json: create });
      expect(created.status).toBe(201);
      const id = created.data.id;

      const got = await call(`/v1/${path}/${id}`, { cookie: a.cookie });
      expect(got.data).toEqual(created.data);

      expect((await call(`/v1/${path}/${id}`, { method: "PATCH", cookie: a.cookie, json: patch })).status).toBe(400); // no If-Match
      const edited = await call(`/v1/${path}/${id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: patch });
      expect(edited.status).toBe(200);
      expect(edited.data).toMatchObject({ ...patch, version: 2 });

      const stale = await call(`/v1/${path}/${id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: patch });
      expect(stale.status).toBe(409);
      expect(stale.data.error.code).toBe("version_conflict");

      const deleted = await call(`/v1/${path}/${id}`, { method: "DELETE", cookie: a.cookie, headers: { "If-Match": "2" } });
      expect(deleted.status).toBe(200);
      expect(deleted.data.deletedAt).toBeTruthy();
      expect((await call(`/v1/${path}/${id}`, { cookie: a.cookie })).status).toBe(404);
      expect((await call(`/v1/${path}`, { cookie: a.cookie })).data.items).toEqual([]);
      expect(await rowCount(`SELECT COUNT(*) AS n FROM ${path} WHERE id = ?`, id)).toBe(1); // soft delete

      const log = await call(`/v1/activity?entityId=${id}`, { cookie: a.cookie });
      expect(log.data.items.map((e: any) => e.action)).toEqual([
        `${path.slice(0, -1)}.delete`, `${path.slice(0, -1)}.update`, `${path.slice(0, -1)}.create`,
      ]);
      // The logged "after" is exactly what the API returned.
      expect(log.data.items[2].after).toEqual(created.data);
      expect(log.data.items[1].after).toEqual(edited.data);
    });
  }

  it("lowercases client emails (D-021)", async () => {
    const a = await makeStudio();
    const res = await call("/v1/clients", { method: "POST", cookie: a.cookie, json: { name: "A", email: "Ann@Example.COM" } });
    expect(res.data.email).toBe("ann@example.com");
  });

  it("never takes studioId or system fields from the body", async () => {
    const a = await makeStudio();
    const b = await makeStudio();
    for (const extra of [{ studioId: b.studioId }, { version: 9 }, { deletedAt: "2020-01-01" }, { createdBy: "x" }]) {
      const res = await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "x", ...extra } });
      expect(res.status).toBe(400);
    }
    expect(await rowCount("SELECT COUNT(*) AS n FROM artworks WHERE studio_id = ?", b.studioId)).toBe(0);
  });

  it("validates input: integer cents, known statuses", async () => {
    const a = await makeStudio();
    expect((await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "x", priceCents: 12.5 } })).status).toBe(400);
    expect((await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "x", status: "gone" } })).status).toBe(400);
    expect((await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: {} })).status).toBe(400);
  });

  it("accepts a client-made id (offline create, D-014) and refuses a duplicate", async () => {
    const a = await makeStudio();
    const id = newId();
    expect((await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { id, title: "x" } })).data.id).toBe(id);
    expect((await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { id, title: "y" } })).status).toBe(400);
  });

  it("lists newest first with a cursor, and filters by status", async () => {
    const a = await makeStudio();
    for (const title of ["one", "two", "three"]) await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title, status: title === "two" ? "sold" : "available" } });
    const p1 = await call("/v1/artworks?limit=2", { cookie: a.cookie });
    expect(p1.data.items.map((x: any) => x.title)).toEqual(["three", "two"]);
    const p2 = await call(`/v1/artworks?limit=2&cursor=${p1.data.nextCursor}`, { cookie: a.cookie });
    expect(p2.data.items.map((x: any) => x.title)).toEqual(["one"]);
    expect(p2.data.nextCursor).toBeNull();
    expect((await call("/v1/artworks?status=sold", { cookie: a.cookie })).data.items.map((x: any) => x.title)).toEqual(["two"]);
  });

  it("settings: read, update with If-Match, stale → 409", async () => {
    const a = await makeStudio();
    const s = await call("/v1/settings", { cookie: a.cookie });
    expect(s.data).toMatchObject({ currency: "USD", paymentTermsDays: 14, depositBps: 5000, taxRateBps: 0, sizeUnit: "in", version: 1 });
    const up = await call("/v1/settings", { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { taxRateBps: 825 } });
    expect(up.data).toMatchObject({ taxRateBps: 825, version: 2 });
    expect((await call("/v1/settings", { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { taxRateBps: 0 } })).status).toBe(409);
  });
});

describe("Idempotency-Key (D-017)", () => {
  it("a repeat returns the first result without writing again", async () => {
    const a = await makeStudio();
    const key = newId();
    const first = await call("/v1/artworks", { method: "POST", cookie: a.cookie, headers: { "Idempotency-Key": key }, json: { title: "Heron" } });
    const again = await call("/v1/artworks", { method: "POST", cookie: a.cookie, headers: { "Idempotency-Key": key }, json: { title: "Heron" } });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.data).toEqual(first.data);
    expect(await rowCount("SELECT COUNT(*) AS n FROM artworks WHERE studio_id = ?", a.studioId)).toBe(1);
    expect(await rowCount("SELECT COUNT(*) AS n FROM activity_log WHERE op_id = ?", key)).toBe(1);
  });

  it("refuses a key reused for a different action, and a key that isn't a ULID", async () => {
    const a = await makeStudio();
    const key = newId();
    const { data } = await call("/v1/artworks", { method: "POST", cookie: a.cookie, headers: { "Idempotency-Key": key }, json: { title: "x" } });
    const reuse = await call(`/v1/artworks/${data.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1", "Idempotency-Key": key }, json: { title: "y" } });
    expect(reuse.status).toBe(400);
    expect((await call("/v1/artworks", { method: "POST", cookie: a.cookie, headers: { "Idempotency-Key": "abc" }, json: { title: "x" } })).status).toBe(400);
  });
});

describe("roles (D-023)", () => {
  it("staff can create and edit but not delete or change settings", async () => {
    const s = await makeStudio("S", "staff");
    const { data } = await call("/v1/artworks", { method: "POST", cookie: s.cookie, json: { title: "x" } });
    expect(data.id).toBeTruthy();
    expect((await call(`/v1/artworks/${data.id}`, { method: "DELETE", cookie: s.cookie, headers: { "If-Match": "1" } })).status).toBe(403);
    expect((await call("/v1/settings", { method: "PATCH", cookie: s.cookie, headers: { "If-Match": "1" }, json: { taxRateBps: 1 } })).status).toBe(403);
  });

  it("client-role users can't use studio routes yet (portal is Phase 4)", async () => {
    const c = await makeStudio("C", "client");
    expect((await call("/v1/artworks", { cookie: c.cookie })).status).toBe(403);
    expect((await call("/v1/artworks", { method: "POST", cookie: c.cookie, json: { title: "x" } })).status).toBe(403);
    expect((await call("/v1/activity", { cookie: c.cookie })).status).toBe(403);
  });
});

describe("actions endpoint", () => {
  it("runs a registered action and returns its activity ids", async () => {
    const a = await makeStudio();
    const res = await call("/v1/actions/artwork.create", { method: "POST", cookie: a.cookie, json: { title: "Via action" } });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ ok: true, result: { title: "Via action" } });
    expect(res.data.activityIds).toHaveLength(1);
    expect((await call("/v1/actions/nope.nothing", { method: "POST", cookie: a.cookie, json: {} })).status).toBe(404);
  });
});
