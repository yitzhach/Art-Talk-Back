// Booth actions (D-070, phase-5-booth.md 9b): a Booth Studio booth built and
// changed by name with the app's own scene code, by the assistant (as a
// confirm card) or by any agent (POST /actions/{name}), and read back for a
// model through GET /placements/{id}/summary.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as Booth from "../src/vendor/booth-scene.js";
import { ASSISTANT, call, makeStudio } from "./helpers";

const act = (cookie: string, action: string, input: unknown, summary = "Booth change") =>
  call("/v1/assistant/act", { method: "POST", cookie, headers: ASSISTANT, json: { action, input, summary } });
const run = (cookie: string, action: string, input: unknown) =>
  call(`/v1/actions/${action}`, { method: "POST", cookie, json: input });

/** A booth with work on its walls, the way Booth Studio would have synced it. */
function syncedBooth(name = "Winter Park") {
  const { scene } = Booth.build({ name, show: "artfair", size: "10x10" });
  const s = scene as any;
  s.art = [
    { id: "w1", asset: "img1", title: "Heron", wall: "back", x: 10, y: 30, w: 36, h: 48, thickness: 1.5, offset: 0.75 },
    { id: "w2", asset: null, title: "Egret", wall: "back", x: 70, y: 44, w: 24, h: 36, thickness: 1.5, offset: 0.75 },
  ];
  return {
    name, kind: "booth", format: Booth.FORMAT, width: 120, depth: 120, height: 96, sizeUnit: "in", scene,
    images: [{ key: "img1", fileId: null, name: "heron.jpg", contentType: "image/jpeg", width: 3000, height: 4000, bytes: 3, role: "artwork" }],
  };
}

describe("booth actions", () => {
  it("the summary: walls, work and furniture with ids and places, never the images", async () => {
    const a = await makeStudio();
    const p = (await call("/v1/placements", { method: "POST", cookie: a.cookie, json: syncedBooth() })).data;
    const res = await call(`/v1/placements/${p.id}/summary`, { cookie: a.cookie });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ id: p.id, version: 1, format: "booth-studio/1", name: "Winter Park", units: "inches" });
    expect(res.data.walls.map((w: any) => w.wall)).toEqual(["back", "left", "right"]);
    expect(res.data.art).toEqual([
      { id: "w1", title: "Heron", wall: "back", x: 10, y: 30, w: 36, h: 48, hasImage: true },
      { id: "w2", title: "Egret", wall: "back", x: 70, y: 44, w: 24, h: 36, hasImage: false },
    ]);
    expect(JSON.stringify(res.data)).not.toMatch(/heron\.jpg|base64/);
    // Not a Booth Studio scene: said so, not guessed at.
    const wall = (await call("/v1/placements", { method: "POST", cookie: a.cookie, json: { name: "W", format: "ar-wall-placer/1", kind: "wall" } })).data;
    const other = await call(`/v1/placements/${wall.id}/summary`, { cookie: a.cookie });
    expect(other.status).toBe(400);
    expect(other.data.error.message).toMatch(/format ar-wall-placer\/1; booth edits work on booth-studio\/1/);
    // Another studio's booth is not found; a client can't read booths.
    const b = await makeStudio("B");
    expect((await call(`/v1/placements/${p.id}/summary`, { cookie: b.cookie })).status).toBe(404);
    const client = await makeStudio("C", "client");
    expect((await call(`/v1/placements/${p.id}/summary`, { cookie: client.cookie })).status).toBe(403);
  });

  it("an agent edits a booth: the app's code applies the ops, the columns follow the scene", async () => {
    const a = await makeStudio();
    const p = (await call("/v1/placements", { method: "POST", cookie: a.cookie, json: syncedBooth() })).data;
    const res = await run(a.cookie, "placement.edit", {
      id: p.id, version: 1,
      ops: [
        { op: "set_booth", width: 180 },
        { op: "add_furniture", kind: "table6", x: -30, z: 30, ref: "t" },
        { op: "change_furniture", id: "@t", rotation: 90 },
        { op: "arrange_wall", wall: "back" },
        { op: "rename", name: "Winter Park 10×15" },
      ],
    });
    expect(res.status).toBe(200);
    const after = res.data.result;
    expect(after).toMatchObject({ version: 2, name: "Winter Park 10×15", width: 180, depth: 120 });
    expect(after.scene.booth.walls.back.width).toBe(180);
    expect(after.scene.booth.pedestals.find((x: any) => x.kind === "table6")).toMatchObject({ x: -30, z: 30, rotation: 90 });
    for (const w of after.scene.art) expect(w.y + w.h / 2).toBe(60);
    expect(after.images).toEqual(p.images);
    // The stored scene is exactly what the app's code makes of the same ops.
    const again = Booth.applyOps(p.scene, [{ op: "set_booth", width: 180 }], p.images);
    expect((again.scene as any).booth.width).toBe(180);
  });

  it("a bad op is a 400 naming it, a stale version a 409, and nothing is written", async () => {
    const a = await makeStudio();
    const p = (await call("/v1/placements", { method: "POST", cookie: a.cookie, json: syncedBooth() })).data;
    const bad = await run(a.cookie, "placement.edit", { id: p.id, version: 1, ops: [{ op: "rename", name: "ok" }, { op: "change_art", id: "nope", x: 1 }] });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toMatchObject({ message: "Op 2: this booth has no work with id nope.", details: { op: 1 } });
    expect((await run(a.cookie, "placement.edit", { id: p.id, version: 1, ops: [{ op: "fly" }] })).status).toBe(400);
    expect((await run(a.cookie, "placement.edit", { id: p.id, version: 1, ops: [] })).status).toBe(400);
    expect((await run(a.cookie, "placement.edit", { id: p.id, version: 7, ops: [{ op: "rename", name: "x" }] })).status).toBe(409);
    expect((await call(`/v1/placements/${p.id}`, { cookie: a.cookie })).data.version).toBe(1);
  });

  it("the assistant's edit is a confirm card in the app's own words; Confirm writes it, as the assistant", async () => {
    const a = await makeStudio();
    const p = (await call("/v1/placements", { method: "POST", cookie: a.cookie, json: syncedBooth() })).data;
    // No version: the current one is used (like update and delete).
    const res = await act(a.cookie, "placement.edit", { id: p.id, ops: [{ op: "change_art", id: "w1", wall: "left", x: 20 }, { op: "add_furniture", kind: "chair", x: 10, z: 20 }] });
    expect(res.status).toBe(200);
    expect(res.data.status).toBe("needs_confirmation");
    const card = res.data.proposal;
    expect(card.details).toEqual([
      { label: "Action", value: expect.stringMatching(/^Change things inside a Booth Studio booth/) },
      { label: "Booth", value: "Winter Park" },
      { label: "Change 1", value: "“Heron”: to Left wall, 1′ 8″ from the wall's left end, bottom 2′ 6″ off the floor" },
      { label: "Change 2", value: "Add Chair (1′ 6″ × 1′ 6″), 10″ right of centre, 1′ 8″ toward the front" },
    ]);
    expect((await call(`/v1/placements/${p.id}`, { cookie: a.cookie })).data.version).toBe(1);
    const ok = await call(`/v1/assistant/proposals/${card.id}/confirm`, { method: "POST", cookie: a.cookie });
    expect(ok.status).toBe(200);
    const now = (await call(`/v1/placements/${p.id}`, { cookie: a.cookie })).data;
    expect(now.version).toBe(2);
    expect(now.scene.art.find((w: any) => w.id === "w1")).toMatchObject({ wall: "left", x: 20 });
    // The row keeps who made it; the log says the assistant changed it.
    const logged = await env.DB.prepare("SELECT actor_type FROM activity_log WHERE entity_id = ? AND action = 'placement.edit'").bind(p.id).first<{ actor_type: string }>("actor_type");
    expect(logged).toBe("assistant");
    // An op the booth can't take never becomes a card.
    const refused = await act(a.cookie, "placement.edit", { id: p.id, ops: [{ op: "remove_wall", wall: "back" }] });
    expect(refused.status).toBe(400);
    expect(refused.data.error.message).toMatch(/hidden .* but not removed/);
  });

  it("build: a new booth from a show, a size and ops, ready for Booth Studio to open", async () => {
    const a = await makeStudio();
    const res = await act(a.cookie, "placement.build", {
      name: "Spring Fling", show: "artshow", size: "10x15",
      ops: [{ op: "add_furniture", kind: "table6", x: 0, z: 40 }, { op: "add_furniture", kind: "chair", x: 0, z: 15, rotation: 180 }],
    });
    expect(res.data.status).toBe("needs_confirmation");
    expect(res.data.proposal.details.map((d: any) => d.label)).toEqual(["Action", "Booth", "Change 1", "Change 2"]);
    expect(res.data.proposal.details[1].value).toBe("New 10 × 15 ft booth for indoor art show · panel walls and light bar, named “Spring Fling”");
    await call(`/v1/assistant/proposals/${res.data.proposal.id}/confirm`, { method: "POST", cookie: a.cookie });
    const made = (await call("/v1/placements", { cookie: a.cookie })).data.items;
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ name: "Spring Fling", format: "booth-studio/1", kind: "booth", width: 180, depth: 120, images: [], actorType: "assistant" });
    expect(made[0].meta.projectId).toBe(made[0].scene.id);
    expect(made[0].scene.booth.pedestals).toHaveLength(2);
    // And an agent's: straight away.
    const direct = await run(a.cookie, "placement.build", { show: "artfair" });
    expect(direct.status).toBe(200);
    expect(direct.data.result).toMatchObject({ width: 120, depth: 120, format: "booth-studio/1" });
    expect((await run(a.cookie, "placement.build", { show: "circus" })).status).toBe(400);
  });

  it("a show floor from a spec (10b): booths in rows, an exhibitor, my booth; the summary reads it back by number", async () => {
    const a = await makeStudio();
    const p = (await call("/v1/placements", { method: "POST", cookie: a.cookie, json: syncedBooth() })).data;
    const res = await run(a.cookie, "placement.edit", {
      id: p.id, version: 1,
      ops: [
        { op: "start_floor", venue: "indoor", width: 1440, depth: 960 },
        { op: "add_booths", count: 16, perRow: 8, x: 120, y: 120, backToBack: true },
        { op: "add_floor_piece", kind: "door", x: 720, y: 954, w: 192, text: "Main entrance" },
        { op: "set_exhibitor", number: 105, name: "Ada Pottery", status: "sold" },
        { op: "mark_my_booth", number: 112 },
      ],
    });
    expect(res.status).toBe(200);
    const floor = (await call(`/v1/placements/${p.id}/summary`, { cookie: a.cookie })).data.floor;
    expect(floor).toMatchObject({ venue: { kind: "indoor", width: 1440, depth: 960 }, mine: 112, counts: { booths: 16, other: 1 } });
    expect(floor.booths.find((b: any) => b.number === 105)).toMatchObject({ status: "sold", exhibitor: "Ada Pottery" });
    expect(floor.pieces).toEqual([expect.objectContaining({ kind: "door", text: "Main entrance" })]);
    // A booth number the floor doesn't have is a 400 naming the op.
    const bad = await run(a.cookie, "placement.edit", { id: p.id, version: 2, ops: [{ op: "set_exhibitor", number: 999, name: "X" }] });
    expect(bad.status).toBe(400);
    expect(bad.data.error.message).toBe("Op 1: the show floor has no booth 999.");
  });

  it("Booth Studio's assistant gets describe_booth and the booth tools, with the app's op schemas; the tracker's doesn't", async () => {
    const a = await makeStudio();
    const tools = (await call("/v1/assistant/tools?app=booth-studio", { cookie: a.cookie, headers: ASSISTANT })).data.tools;
    const names = tools.map((t: any) => t.name);
    expect(names.slice(0, 2)).toEqual(["search", "describe_booth"]);
    expect(names).toEqual(expect.arrayContaining(["placement_edit", "placement_build", "placement_update"]));
    const describe = tools.find((t: any) => t.name === "describe_booth");
    expect(describe).toMatchObject({ action: null, read: { path: "/placements/{id}/summary" }, level: "auto" });
    const edit = tools.find((t: any) => t.name === "placement_edit");
    expect(edit).toMatchObject({ action: "placement.edit", level: "confirm" });
    expect(edit.inputSchema.required).toEqual(["id", "ops"]);
    expect(edit.inputSchema.properties.ops.items.anyOf.map((s: any) => s.properties.op.const)).toEqual(Booth.OP_NAMES);
    expect(edit.description).toMatch(/confirms this with one tap/);
    const tracker = (await call("/v1/assistant/tools?app=show-tracker", { cookie: a.cookie, headers: ASSISTANT })).data.tools.map((t: any) => t.name);
    expect(tracker).not.toContain("describe_booth");
    expect(tracker).not.toContain("placement_edit");
  });

  it("the vendored scene code is Booth Studio's: its format and its ops (CI compares the file byte for byte)", () => {
    expect(Booth.FORMAT).toBe("booth-studio/1");
    expect(Booth.OP_NAMES).toEqual(expect.arrayContaining(["rename", "set_booth", "add_furniture", "change_art", "arrange_wall"]));
  });
});
