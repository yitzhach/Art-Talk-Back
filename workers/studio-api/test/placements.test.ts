// Placements (Phase 5, Booth Studio's part: D-062…D-065): the record, its
// caps, sync, images as attached studio files, pull's byte budget, and the
// tools Booth Studio's assistant gets.
import { env } from "cloudflare:test";
import { PLACEMENT_IMAGES_MAX, PLACEMENT_SCENE_MAX, newId } from "@studio/core";
import { describe, expect, it } from "vitest";
import { PULL_PAGE_BYTES } from "../src/actions/sync";
import { ASSISTANT, BASE, call, countingEnv, makeStudio, rowCount } from "./helpers";

const push = (cookie: string, ops: unknown[]) => call("/v1/sync/push", { method: "POST", cookie, json: { ops } });
const op = (action: string, entityId: string, input: Record<string, unknown>, baseVersion: number | null = null) =>
  ({ opId: newId(), action, entityId, baseVersion, input });

/** A booth the way Booth Studio sends one: its project, minus the images, plus the manifest. */
const booth = (name = "Spring booth") => ({
  kind: "booth", name, format: "booth-studio/1", width: 120, depth: 120, height: 96, sizeUnit: "in",
  scene: { schema: 1, units: "inches", id: "bf26e45f-f10c-4b7d-8a99-addf958993da", name, art: [{ id: "a1", asset: "img1", x: 10 }] },
  images: [{ key: "img1", fileId: null, name: "heron.jpg", contentType: "image/jpeg", width: 4000, height: 3000, bytes: 3, role: "artwork" }],
});

describe("placements", () => {
  it("create, read, edit and delete through /v1/placements, with the row's defaults", async () => {
    const a = await makeStudio();
    const created = await call("/v1/placements", { method: "POST", cookie: a.cookie, json: booth() });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ kind: "booth", width: 120, sizeUnit: "in", version: 1, meta: {} });
    expect(created.data.scene.art[0]).toEqual({ id: "a1", asset: "img1", x: 10 });
    expect(created.data.images[0].key).toBe("img1");

    const bare = (await call("/v1/placements", { method: "POST", cookie: a.cookie, json: { name: "Wall", format: "ar-wall-placer/1", kind: "wall" } })).data;
    expect(bare).toMatchObject({ scene: {}, images: [], width: null, sizeUnit: "in" });

    const got = (await call(`/v1/placements/${created.data.id}`, { cookie: a.cookie })).data;
    expect(got).toEqual(created.data);
    const edited = await call(`/v1/placements/${created.data.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" },
      json: { scene: { ...created.data.scene, name: "Summer" } } });
    expect(edited.data).toMatchObject({ version: 2, scene: { name: "Summer" } });
    const listed = (await call("/v1/placements", { cookie: a.cookie })).data.items;
    expect(listed.map((p: any) => p.id).sort()).toEqual([created.data.id, bare.id].sort());
    expect((await call(`/v1/placements/${created.data.id}`, { method: "DELETE", cookie: a.cookie, headers: { "If-Match": "2" } })).status).toBe(200);
    expect((await call(`/v1/placements/${created.data.id}`, { cookie: a.cookie })).status).toBe(404);
  });

  it("a list page is at most 20, because each row carries its scene", async () => {
    const a = await makeStudio();
    expect((await call("/v1/placements?limit=21", { cookie: a.cookie })).status).toBe(400);
    expect((await call("/v1/placements?limit=20", { cookie: a.cookie })).status).toBe(200);
  });

  it("refuses a scene or a manifest past the caps, so a logged write fits in a D1 row (D-062)", async () => {
    const a = await makeStudio();
    const huge = { ...booth(), scene: { blob: "x".repeat(PLACEMENT_SCENE_MAX) } };
    const res = await call("/v1/placements", { method: "POST", cookie: a.cookie, json: huge });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.data.error.details)).toMatch(/too big to sync/);
    const many = { ...booth(), images: Array.from({ length: PLACEMENT_IMAGES_MAX + 1 }, (_, i) => ({ ...booth().images[0], key: `k${i}` })) };
    expect((await call("/v1/placements", { method: "POST", cookie: a.cookie, json: many })).status).toBe(400);
    expect((await call("/v1/placements", { method: "POST", cookie: a.cookie, json: { ...booth(), format: "Booth Studio" } })).status).toBe(400);

    // At the caps it is stored, and the activity row (before + after) is under 2 MB.
    const id = newId();
    const atCap = {
      ...booth(), id,
      scene: { blob: "x".repeat(PLACEMENT_SCENE_MAX - 20) },
      images: Array.from({ length: PLACEMENT_IMAGES_MAX }, (_, i) => ({ ...booth().images[0], key: `k${i}`, fileId: newId() })),
    };
    expect((await call("/v1/placements", { method: "POST", cookie: a.cookie, json: atCap })).status).toBe(201);
    const v2 = { scene: { blob: "y".repeat(PLACEMENT_SCENE_MAX - 20) } };
    expect((await call(`/v1/placements/${id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: v2 })).status).toBe(200);
    const biggest = await env.DB.prepare("SELECT MAX(length(before) + length(after)) AS n FROM activity_log WHERE entity_id = ?").bind(id).first<{ n: number }>("n");
    expect(biggest).toBeLessThan(1_600_000);
  });

  it("staff can make and change booths but not delete them; a client can't see them", async () => {
    const staff = await makeStudio("S", "staff");
    const p = (await call("/v1/placements", { method: "POST", cookie: staff.cookie, json: booth() })).data;
    expect(p.version).toBe(1);
    expect((await call(`/v1/placements/${p.id}`, { method: "DELETE", cookie: staff.cookie, headers: { "If-Match": "1" } })).status).toBe(403);
    const client = await makeStudio("C", "client");
    expect((await call("/v1/placements", { cookie: client.cookie })).status).toBe(403);
  });
});

describe("placements in sync", () => {
  it("a booth made offline is pushed with the device's id and pulled by another device", async () => {
    const a = await makeStudio();
    const id = newId();
    const res = await push(a.cookie, [op("placement.create", id, booth())]);
    expect(res.data.results[0]).toMatchObject({ status: "applied", record: { id, version: 1 } });
    const pulled = (await call("/v1/sync/pull?since=0", { cookie: a.cookie })).data.changes;
    expect(pulled.find((c: any) => c.entityId === id)).toMatchObject({ entityType: "placement", record: { name: "Spring booth" } });
    expect(await rowCount("SELECT COUNT(*) AS n FROM activity_log WHERE entity_id = ? AND source = 'sync'", id)).toBe(1);
  });

  it("the same scene changed on two devices: the studio keeps its copy and the second device gets both (D-064)", async () => {
    const a = await makeStudio();
    const id = newId();
    await push(a.cookie, [op("placement.create", id, booth())]);
    const one = { ...booth().scene, name: "From device 1" };
    const two = { ...booth().scene, name: "From device 2" };
    expect((await push(a.cookie, [op("placement.update", id, { patch: { scene: one } }, 1)])).data.results[0].status).toBe("applied");
    const late = (await push(a.cookie, [op("placement.update", id, { patch: { scene: two } }, 1)])).data.results[0];
    expect(late.status).toBe("conflict");
    expect(late.conflicts).toEqual([{ field: "scene", serverValue: one, deviceValue: two }]);
    expect(late.record.scene.name).toBe("From device 1");
    // A different field merges: the name moved on device 2 only.
    const renamed = (await push(a.cookie, [op("placement.update", id, { patch: { name: "Renamed" } }, 1)])).data.results[0];
    expect(renamed).toMatchObject({ status: "merged", record: { name: "Renamed", scene: { name: "From device 1" } } });
  });

  it("a deleted booth can be brought back from a device", async () => {
    const a = await makeStudio();
    const id = newId();
    await push(a.cookie, [op("placement.create", id, booth())]);
    expect((await push(a.cookie, [op("placement.delete", id, {}, 1)])).data.results[0].status).toBe("applied");
    expect((await push(a.cookie, [op("placement.restore", id, { id })])).data.results[0]).toMatchObject({ status: "applied", record: { deletedAt: null } });
  });

  it("a page of big placements ends early, and every one still arrives once (D-065)", async () => {
    const a = await makeStudio();
    const size = 590_000;
    const ids: string[] = [];
    // Enough to pass PULL_PAGE_BYTES by two; a small record in between.
    const n = Math.ceil(PULL_PAGE_BYTES / size) + 2;
    for (let i = 0; i < n; i++) {
      const id = newId();
      ids.push(id);
      await call("/v1/placements", { method: "POST", cookie: a.cookie, json: { ...booth(`Big ${i}`), id, scene: { blob: String(i % 10).repeat(size) } } });
      if (i === 2) await call("/v1/shows", { method: "POST", cookie: a.cookie, json: { name: "Small" } });
    }
    const counted = countingEnv();
    const first = await call("/v1/sync/pull?since=0&limit=200", { cookie: a.cookie, env: counted.env as never });
    expect(first.data.hasMore).toBe(true);
    expect(first.raw.length).toBeLessThan(PULL_PAGE_BYTES + size + 100_000);
    expect(counted.count.queries).toBeLessThanOrEqual(15);
    const seen = [...first.data.changes];
    let cursor = first.data.cursor;
    for (let more = true; more;) {
      const page = (await call(`/v1/sync/pull?since=${cursor}&limit=200`, { cookie: a.cookie })).data;
      seen.push(...page.changes);
      cursor = page.cursor;
      more = page.hasMore;
    }
    const placements = seen.filter((c: any) => c.entityType === "placement").map((c: any) => c.entityId);
    expect(placements.sort()).toEqual([...ids].sort());
    expect(seen.filter((c: any) => c.entityType === "show")).toHaveLength(1);
  });

  it("one placement bigger than the budget still comes through, alone", async () => {
    const a = await makeStudio();
    // The budget is per page, so a page always keeps its first change.
    await call("/v1/placements", { method: "POST", cookie: a.cookie, json: { ...booth(), scene: { blob: "z".repeat(500_000) } } });
    const page = (await call("/v1/sync/pull?since=0", { cookie: a.cookie })).data;
    expect(page.changes.filter((c: any) => c.entityType === "placement")).toHaveLength(1);
  });
});

describe("a booth's images are studio files attached to it (D-063)", () => {
  it("upload, attach to the placement, record the file id, and download on another device", async () => {
    const a = await makeStudio();
    const p = (await call("/v1/placements", { method: "POST", cookie: a.cookie, json: booth() })).data;
    const up = (await call("/v1/files/upload-url", { method: "POST", cookie: a.cookie,
      json: { name: "heron.jpg", contentType: "image/jpeg", size: 3, kind: "photo" } })).data;
    expect((await call(up.uploadUrl.replace(BASE, ""), { method: "PUT", body: "abc", headers: { "Content-Length": "3" } })).status).toBe(204);
    const file = (await call(`/v1/files/${up.file.id}/attach`, { method: "POST", cookie: a.cookie,
      json: { entityType: "placement", entityId: p.id } })).data;
    expect(file).toMatchObject({ status: "ready", entityType: "placement", entityId: p.id });

    const images = [{ ...p.images[0], fileId: file.id }];
    const updated = (await call(`/v1/placements/${p.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { images } })).data;
    expect(updated.images[0].fileId).toBe(file.id);

    const link = (await call(`/v1/files/${updated.images[0].fileId}/download-url`, { cookie: a.cookie })).data;
    const got = await call(link.url.replace(BASE, ""));
    expect(got.status).toBe(200);
    expect(got.raw).toBe("abc");
    expect(got.headers.get("content-type")).toBe("image/jpeg");
  });

  it("a placement that isn't on the server yet can't take a file", async () => {
    const a = await makeStudio();
    const up = (await call("/v1/files/upload-url", { method: "POST", cookie: a.cookie, json: { name: "x.jpg", contentType: "image/jpeg", size: 3 } })).data;
    await call(up.uploadUrl.replace(BASE, ""), { method: "PUT", body: "abc", headers: { "Content-Length": "3" } });
    const res = await call(`/v1/files/${up.file.id}/attach`, { method: "POST", cookie: a.cookie, json: { entityType: "placement", entityId: newId() } });
    expect(res.status).toBe(404);
  });
});

describe("Booth Studio's assistant tools (D-052)", () => {
  it("app=booth-studio gets search and the placement tools only; the Show Tracker doesn't get them", async () => {
    const a = await makeStudio();
    const booth = (await call("/v1/assistant/tools?app=booth-studio", { cookie: a.cookie, headers: ASSISTANT })).data.tools.map((t: any) => t.name);
    expect(booth).toEqual(["search", "placement_create", "placement_delete", "placement_restore", "placement_update"]);
    const tracker = (await call("/v1/assistant/tools?app=show-tracker", { cookie: a.cookie, headers: ASSISTANT })).data.tools.map((t: any) => t.name);
    expect(tracker.some((n: string) => n.startsWith("placement"))).toBe(false);
  });
});

describe("search finds booths by name (D-069)", () => {
  it("by any words of the name, with its size; another studio's never; the scene is never read", async () => {
    const a = await makeStudio();
    const big = { ...booth("Winter Park corner booth"), scene: { blob: "x".repeat(500_000) } };
    const p = (await call("/v1/placements", { method: "POST", cookie: a.cookie, json: big })).data;
    await call("/v1/placements", { method: "POST", cookie: a.cookie, json: booth("Spring booth") });
    const res = await call("/v1/search?q=winter%20corner&types=placement", { cookie: a.cookie });
    expect(res.status).toBe(200);
    expect(res.data.items).toEqual([{ type: "placement", id: p.id, version: 1, label: "Winter Park corner booth", detail: "booth · 120 × 120 in" }]);
    expect(res.raw.length).toBeLessThan(1000);
    // No type filter: booths come back beside everything else.
    expect((await call("/v1/search?q=spring", { cookie: a.cookie })).data.items.map((i: any) => i.type)).toContain("placement");
    const b = await makeStudio("B");
    expect((await call("/v1/search?q=winter", { cookie: b.cookie })).data.items).toEqual([]);
  });

  it("the search tool offers placement as a kind", async () => {
    const a = await makeStudio();
    const tools = (await call("/v1/assistant/tools?app=booth-studio", { cookie: a.cookie, headers: ASSISTANT })).data.tools;
    expect(tools.find((t: any) => t.name === "search").inputSchema.properties.types.items.enum).toContain("placement");
  });
});
