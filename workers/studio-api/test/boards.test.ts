// Studio Wall's boards, cards and comments (Phase 5, D-082…D-086): the
// records, the batch actions, delete/restore with a board's cards, stars,
// sync, a card's picture as an attached file, roles, and the assistant's tools.
import { PIN_BATCH_MAX, PIN_META_MAX, newId } from "@studio/core";
import { describe, expect, it } from "vitest";
import { ASSISTANT, BASE, call, countingEnv, makeStudio, rowCount, type Studio } from "./helpers";

const push = (cookie: string, ops: unknown[]) => call("/v1/sync/push", { method: "POST", cookie, json: { ops } });
const op = (action: string, entityId: string, input: Record<string, unknown>, baseVersion: number | null = null) =>
  ({ opId: newId(), action, entityId, baseVersion, input });
const act = (s: Studio, name: string, json: unknown) => call(`/v1/actions/${name}`, { method: "POST", cookie: s.cookie, json });
const board = async (s: Studio, name = "Coastal") => (await call("/v1/boards", { method: "POST", cookie: s.cookie, json: { name } })).data;
const card = async (s: Studio, boardId: string, more: Record<string, unknown> = {}) =>
  (await call("/v1/pins", { method: "POST", cookie: s.cookie, json: { boardId, kind: "idea", note: "blue tiles", ...more } })).data;
async function upload(s: Studio, name = "p.webp") {
  const up = (await call("/v1/files/upload-url", { method: "POST", cookie: s.cookie, json: { name, contentType: "image/webp", size: 3 } })).data;
  await call(up.uploadUrl.replace(BASE, ""), { method: "PUT", body: "abc", headers: { "Content-Length": "3" } });
  return up.file as { id: string };
}

describe("boards and cards", () => {
  it("create, read, edit and delete, with the rows' defaults", async () => {
    const a = await makeStudio();
    const b = await board(a);
    expect(b).toMatchObject({ name: "Coastal", description: null, coverPinId: null, position: 0, commentsEnabled: true, version: 1, meta: {} });
    const pin = await card(a, b.id, { sourceUrl: "https://example.com/x", tags: ["sea"], palette: ["#1a2b3c"], meta: { annotations: [{ id: "n1", tool: "pen", points: [], comment: "" }] } });
    expect(pin).toMatchObject({
      boardId: b.id, kind: "idea", fileId: null, isOwn: false, tags: ["sea"], palette: ["#1a2b3c"], title: null,
      linkedType: null, deletedBy: null, sourceUrl: "https://example.com/x", version: 1,
    });
    expect(pin.meta.annotations[0].id).toBe("n1");
    expect((await call(`/v1/pins/${pin.id}`, { cookie: a.cookie })).data).toEqual(pin);
    const edited = await call(`/v1/pins/${pin.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { title: "Blue" } });
    expect(edited.data).toMatchObject({ version: 2, title: "Blue" });
    expect((await call(`/v1/pins/${pin.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { title: "x" } })).status).toBe(409);
    const cover = await call(`/v1/boards/${b.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { coverPinId: pin.id } });
    expect(cover.data.coverPinId).toBe(pin.id);
    expect((await call(`/v1/pins/${pin.id}`, { method: "DELETE", cookie: a.cookie, headers: { "If-Match": "2" } })).status).toBe(200);
    expect((await call(`/v1/pins/${pin.id}`, { cookie: a.cookie })).status).toBe(404);
  });

  it("refuses bad cards: no board, a broken link, a bad colour, oversized meta", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const bad = async (json: unknown) => (await call("/v1/pins", { method: "POST", cookie: a.cookie, json })).status;
    expect(await bad({ boardId: newId(), kind: "idea" })).toBe(404);
    expect(await bad({ boardId: b.id, kind: "link", sourceUrl: "javascript:alert(1)" })).toBe(400);
    expect(await bad({ boardId: b.id, kind: "idea", palette: ["blue"] })).toBe(400);
    expect(await bad({ boardId: b.id, kind: "idea", meta: { x: "y".repeat(PIN_META_MAX) } })).toBe(400);
    expect(await bad({ boardId: b.id, kind: "idea", fileId: newId() })).toBe(404);
    expect(await bad({ boardId: b.id, kind: "idea", studioId: newId() })).toBe(400);
    expect((await call("/v1/feedback", { method: "POST", cookie: a.cookie, json: { boardId: b.id } })).status).toBe(400);
  });

  it("lists cards and comments per board", async () => {
    const a = await makeStudio();
    const [one, two] = [await board(a, "One"), await board(a, "Two")];
    const p1 = await card(a, one.id);
    await card(a, two.id, { kind: "link", sourceUrl: "https://example.com" });
    await call("/v1/feedback", { method: "POST", cookie: a.cookie, json: { boardId: one.id, pinId: p1.id, text: "Love it" } });
    expect((await call(`/v1/pins?boardId=${one.id}`, { cookie: a.cookie })).data.items.map((p: any) => p.id)).toEqual([p1.id]);
    expect((await call("/v1/pins?kind=link", { cookie: a.cookie })).data.items).toHaveLength(1);
    expect((await call(`/v1/feedback?boardId=${one.id}`, { cookie: a.cookie })).data.items.map((f: any) => f.text)).toEqual(["Love it"]);
    expect((await call(`/v1/feedback?boardId=${two.id}`, { cookie: a.cookie })).data.items).toEqual([]);
    // The older status filter still works through the same code (D-086).
    expect((await call("/v1/artworks?status=sold", { cookie: a.cookie })).status).toBe(200);
  });

  it("pin.save saves every card or none", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const file = await upload(a);
    const ids = [newId(), newId()];
    const saved = await act(a, "pin.save", { pins: [
      { id: ids[0], boardId: b.id, kind: "image", fileId: file.id, title: "Heron" },
      { id: ids[1], boardId: b.id, kind: "link", sourceUrl: "https://example.com/a" },
    ] });
    expect(saved.status).toBe(200);
    expect(saved.data.result.pins.map((p: any) => p.id)).toEqual(ids);
    // One bad card (another board that isn't there) → nothing saved.
    const before = await rowCount("SELECT COUNT(*) AS n FROM pins WHERE studio_id = ?", a.studioId);
    const failed = await act(a, "pin.save", { pins: [{ boardId: b.id, kind: "idea", note: "ok" }, { boardId: newId(), kind: "idea", note: "x" }] });
    expect(failed.status).toBe(404);
    expect(await rowCount("SELECT COUNT(*) AS n FROM pins WHERE studio_id = ?", a.studioId)).toBe(before);
    const tooMany = Array.from({ length: PIN_BATCH_MAX + 1 }, () => ({ boardId: b.id, kind: "idea", note: "x" }));
    expect((await act(a, "pin.save", { pins: tooMany })).status).toBe(400);
  });

  it("pin.save of 50 cards stays inside a free-plan request's D1 budget (D-050)", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const { env: counted, count } = countingEnv();
    const pins = Array.from({ length: PIN_BATCH_MAX }, (_, i) => ({ boardId: b.id, kind: "idea", note: `n${i}` }));
    const res = await call("/v1/actions/pin.save", { method: "POST", cookie: a.cookie, json: { pins }, env: counted });
    expect(res.status).toBe(200);
    expect(count.queries).toBeLessThan(15);
  });

  it("pin.move and pin.copy: credits and the picture's file are kept, versions move on", async () => {
    const a = await makeStudio();
    const [from, to] = [await board(a, "From"), await board(a, "To")];
    const file = await upload(a);
    const p = await card(a, from.id, { kind: "image", fileId: file.id, sourceCredit: "Ana Ruiz", contributorName: "Ben", tags: ["sea"] });
    const q = await card(a, from.id);
    const newIds = [newId()];
    const copied = (await act(a, "pin.copy", { ids: [p.id], boardId: to.id, newIds })).data.result.pins;
    expect(copied[0]).toMatchObject({ id: newIds[0], boardId: to.id, fileId: file.id, sourceCredit: "Ana Ruiz", contributorName: "Ben", tags: ["sea"], version: 1 });
    expect((await call(`/v1/pins/${p.id}`, { cookie: a.cookie })).data.boardId).toBe(from.id);
    expect((await act(a, "pin.copy", { ids: [p.id, q.id], boardId: to.id, newIds })).status).toBe(400);

    const moved = (await act(a, "pin.move", { ids: [p.id, q.id], boardId: to.id })).data.result.pins;
    expect(moved.map((x: any) => [x.boardId, x.version])).toEqual([[to.id, 2], [to.id, 2]]);
    // Already there: nothing to write.
    expect((await act(a, "pin.move", { ids: [p.id], boardId: to.id })).data.result.pins).toEqual([]);
    expect((await act(a, "pin.move", { ids: [p.id, p.id], boardId: from.id })).status).toBe(400);
  });

  it("pin.link links a card to an artwork in this studio, and unlinks it", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const p = await card(a, b.id);
    const art = (await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "Heron" } })).data;
    const linked = await act(a, "pin.link", { id: p.id, version: 1, linkedType: "artwork", linkedId: art.id });
    expect(linked.data.result).toMatchObject({ linkedType: "artwork", linkedId: art.id, version: 2 });
    expect((await act(a, "pin.link", { id: p.id, version: 2, linkedType: "artwork", linkedId: null })).status).toBe(400);
    expect((await act(a, "pin.link", { id: p.id, version: 2, linkedType: null, linkedId: null })).data.result.linkedId).toBeNull();
  });

  it("deleting a board deletes its cards; restoring it (or one undo) brings back only those", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const [p1, p2, gone] = [await card(a, b.id), await card(a, b.id), await card(a, b.id)];
    await call(`/v1/pins/${gone.id}`, { method: "DELETE", cookie: a.cookie, headers: { "If-Match": "1" } });
    const del = await call(`/v1/boards/${b.id}`, { method: "DELETE", cookie: a.cookie, headers: { "If-Match": "1" } });
    expect(del.status).toBe(200);
    expect((await call(`/v1/pins?boardId=${b.id}`, { cookie: a.cookie })).data.items).toEqual([]);
    // A card can't come back on its own while its board is deleted.
    const lone = await act(a, "pin.restore", { id: p1.id });
    expect(lone.status).toBe(400);
    expect(lone.data.error.message).toBe("Restore its board first");

    expect((await act(a, "board.restore", { id: b.id })).status).toBe(200);
    expect((await call(`/v1/pins?boardId=${b.id}`, { cookie: a.cookie })).data.items.map((p: any) => p.id).sort()).toEqual([p1.id, p2.id].sort());

    // Delete again, then undo the delete: board and both cards in one step.
    await call(`/v1/boards/${b.id}`, { method: "DELETE", cookie: a.cookie, headers: { "If-Match": "3" } });
    const log = (await call(`/v1/activity?entityId=${b.id}`, { cookie: a.cookie })).data.items[0];
    expect(log.action).toBe("board.delete");
    expect((await call(`/v1/activity/${log.id}/undo`, { method: "POST", cookie: a.cookie })).status).toBe(200);
    expect((await call(`/v1/pins?boardId=${b.id}`, { cookie: a.cookie })).data.items).toHaveLength(2);
  });

  it("restoring a card a client removed clears deletedBy", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const p = await card(a, b.id, { contributorName: "Ana" });
    await call(`/v1/pins/${p.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { deletedBy: "guest:abc" } });
    await call(`/v1/pins/${p.id}`, { method: "DELETE", cookie: a.cookie, headers: { "If-Match": "2" } });
    const back = (await act(a, "pin.restore", { id: p.id })).data.result;
    expect(back).toMatchObject({ deletedAt: null, deletedBy: null });
  });

  it("feedback.star sets the person's own star: a value, so a repeat changes nothing new", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const p = await card(a, b.id);
    const first = (await act(a, "feedback.star", { pinId: p.id, starred: true })).data.result;
    expect(first).toMatchObject({ boardId: b.id, pinId: p.id, starred: true, text: "" });
    const off = (await act(a, "feedback.star", { pinId: p.id, starred: false })).data.result;
    expect(off).toMatchObject({ id: first.id, starred: false, version: 2 });
    await act(a, "feedback.star", { pinId: p.id, starred: true });
    // A comment on the same card is a separate record.
    await call("/v1/feedback", { method: "POST", cookie: a.cookie, json: { boardId: b.id, pinId: p.id, text: "Yes" } });
    expect(await rowCount("SELECT COUNT(*) AS n FROM board_feedback WHERE pin_id = ?", p.id)).toBe(2);
  });

  it("staff can make and change boards but not delete them; a client can't see them", async () => {
    const staff = await makeStudio("S", "staff");
    const b = await board(staff);
    expect(b.version).toBe(1);
    expect((await call(`/v1/boards/${b.id}`, { method: "DELETE", cookie: staff.cookie, headers: { "If-Match": "1" } })).status).toBe(403);
    const client = await makeStudio("C", "client");
    expect((await call("/v1/boards", { cookie: client.cookie })).status).toBe(403);
    expect((await call("/v1/pins", { cookie: client.cookie })).status).toBe(403);
  });
});

describe("Studio Wall sync", () => {
  it("a device's boards, cards and comments go up through push and come back through pull", async () => {
    const a = await makeStudio();
    const [boardId, pinId, noteId] = [newId(), newId(), newId()];
    const createPin = op("pin.create", pinId, { boardId, kind: "idea", note: "terracotta" });
    const res = await push(a.cookie, [
      op("board.create", boardId, { name: "Kitchen" }),
      createPin,
      op("feedback.create", noteId, { boardId, pinId, text: "For the island" }),
      op("pin.save", newId(), { pins: [{ id: newId(), boardId, kind: "link", sourceUrl: "https://example.com/t" }] }),
    ]);
    expect(res.data.results.map((r: any) => r.status)).toEqual(["applied", "applied", "applied", "applied"]);
    // The same op again is a duplicate, not a second card.
    const again = await push(a.cookie, [createPin]);
    expect(again.data.results[0].status).toBe("duplicate");
    expect(await rowCount("SELECT COUNT(*) AS n FROM pins WHERE id = ?", pinId)).toBe(1);

    const pulled = (await call("/v1/sync/pull?since=0", { cookie: a.cookie })).data.changes;
    const types = pulled.map((c: any) => c.entityType);
    expect(types.filter((t: string) => t === "board")).toHaveLength(1);
    expect(types.filter((t: string) => t === "pin")).toHaveLength(2);
    expect(pulled.find((c: any) => c.entityId === noteId).record.text).toBe("For the island");
  });

  it("two devices editing different fields of one card merge; the same field is a conflict", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const p = await card(a, b.id);
    expect((await push(a.cookie, [op("pin.update", p.id, { patch: { title: "Phone" } }, 1)])).data.results[0].status).toBe("applied");
    const desk = (await push(a.cookie, [op("pin.update", p.id, { patch: { note: "desk note" } }, 1)])).data.results[0];
    expect(desk.status).toBe("merged");
    expect(desk.record).toMatchObject({ title: "Phone", note: "desk note" });
    const clash = (await push(a.cookie, [op("pin.update", p.id, { patch: { title: "Desk" } }, 1)])).data.results[0];
    expect(clash.status).toBe("conflict");
    expect(clash.conflicts).toEqual([{ field: "title", serverValue: "Phone", deviceValue: "Desk" }]);
    // A delete from an old version is never merged (spec → Conflicts).
    expect((await push(a.cookie, [op("pin.delete", p.id, {}, 1)])).data.results[0].status).toBe("conflict");
  });

  it("a board deleted on a device takes its cards with it, and other devices pull both", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const p = await card(a, b.id);
    const cursor = (await call("/v1/sync/pull?since=0", { cookie: a.cookie })).data.cursor;
    expect((await push(a.cookie, [op("board.delete", b.id, {}, 1)])).data.results[0].status).toBe("applied");
    const changes = (await call(`/v1/sync/pull?since=${cursor}`, { cookie: a.cookie })).data.changes;
    expect(changes.map((c: any) => [c.entityId, !!c.record.deletedAt]).sort()).toEqual([[b.id, true], [p.id, true]].sort());
  });
});

describe("a card's picture", () => {
  it("is a studio file attached to the card; attaching leaves the card's version alone", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const file = await upload(a);
    const p = await card(a, b.id, { kind: "image", fileId: file.id });
    const attached = await call(`/v1/files/${file.id}/attach`, { method: "POST", cookie: a.cookie, json: { entityType: "pin", entityId: p.id } });
    expect(attached.data).toMatchObject({ status: "ready", entityType: "pin", entityId: p.id });
    expect((await call(`/v1/pins/${p.id}`, { cookie: a.cookie })).data.version).toBe(1);
    const link = (await call(`/v1/files/${file.id}/download-url`, { cookie: a.cookie })).data.url;
    expect((await call(link.replace(BASE, ""))).raw).toBe("abc");
  });
});

describe("Studio Wall's assistant tools", () => {
  it("get the board actions at the plan's levels; other apps don't", async () => {
    const a = await makeStudio();
    const tools = (await call("/v1/assistant/tools?app=studio-wall", { cookie: a.cookie })).data.tools;
    const level = (n: string) => tools.find((t: any) => t.name === n)?.level;
    expect([level("pin_save"), level("pin_create"), level("feedback_create"), level("feedback_star"), level("board_create")])
      .toEqual(["auto", "auto", "auto", "auto", "auto"]);
    expect([level("pin_update"), level("pin_move"), level("pin_copy"), level("pin_link"), level("board_update")])
      .toEqual(["confirm", "confirm", "confirm", "confirm", "confirm"]);
    expect([level("pin_delete"), level("board_delete"), level("feedback_delete")]).toEqual(["always_confirm", "always_confirm", "always_confirm"]);
    const booth = (await call("/v1/assistant/tools?app=booth-studio", { cookie: a.cookie })).data.tools;
    expect(booth.some((t: any) => t.name.startsWith("pin_") || t.name.startsWith("board_"))).toBe(false);
  });

  it("the assistant's move asks first; its save runs at once", async () => {
    const a = await makeStudio();
    const [one, two] = [await board(a, "One"), await board(a, "Two")];
    const p = await card(a, one.id);
    const save = await call("/v1/actions/pin.save", { method: "POST", cookie: a.cookie, headers: ASSISTANT,
      json: { pins: [{ boardId: one.id, kind: "link", sourceUrl: "https://example.com/c" }] } });
    expect(save.status).toBe(200);
    const move = await call("/v1/actions/pin.move", { method: "POST", cookie: a.cookie, headers: ASSISTANT, json: { ids: [p.id], boardId: two.id } });
    expect(move.data.error.code).toBe("needs_confirmation");
  });
});
