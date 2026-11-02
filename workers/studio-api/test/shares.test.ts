// Studio Wall's client links (stage 5, D-090…D-095). The owner's routes, and the
// public ones the client page calls through Studio Wall's Worker. The guest
// tests are Studio Wall's src/contribute.test.ts and src/share-password.test.ts,
// ported: same requests, same answers, now against studio-api and its D1.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { sha256 } from "../src/lib/crypto";
import { BASE, call, makeStudio, rowCount, type Studio } from "./helpers";

const GUEST = "g".repeat(20);
const board = async (s: Studio, more: Record<string, unknown> = {}) =>
  (await call("/v1/boards", { method: "POST", cookie: s.cookie, json: { name: "Living room", ...more } })).data;
const card = async (s: Studio, boardId: string, more: Record<string, unknown> = {}) =>
  (await call("/v1/pins", { method: "POST", cookie: s.cookie, json: { boardId, kind: "idea", note: "Linen", title: "Linen", ...more } })).data;
const link = async (s: Studio, boardId: string, more: Record<string, unknown> = {}) => {
  const r = await call("/v1/shares", { method: "POST", cookie: s.cookie, json: { boardId, permission: "contribute", ...more } });
  expect(r.status).toBe(201);
  return r.data as { id: string; token: string; version: number; locked: boolean; pinCount: number | null };
};
/** A client's request, as Studio Wall's Worker forwards it. */
const pub = (token: string, path = "", init: Parameters<typeof call>[1] = {}, guest = GUEST) =>
  call(`/v1/public/shares/${token}${path}`, { ...init, headers: { "x-guest-id": guest, ...init.headers } });
const post = (token: string, path: string, json: unknown, guest = GUEST) => pub(token, path, { method: "POST", json }, guest);

const enc = (s: string) => [...new TextEncoder().encode(s)];
const seg = (m: number, p: number[]) => [0xff, m, (p.length + 2) >> 8, (p.length + 2) & 255, ...p];
/** A tiny JPEG carrying a secret in its Exif and a comment, as a phone photo carries GPS. */
const JPEG = new Uint8Array([
  0xff, 0xd8, ...seg(0xe1, enc("Exif\0\0GPS-SECRET")), ...seg(0xfe, enc("COMMENT-SECRET")),
  ...seg(0xdb, [0, 1, 2]), ...seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]), ...seg(0xda, [1, 1, 0, 0, 63, 0]),
  0x12, 0x34, 0xff, 0xd9,
]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const text = (b: ArrayBuffer) => String.fromCharCode(...new Uint8Array(b));

/** The owner's picture card: uploaded and attached as the app does (D-085). */
async function pictureCard(s: Studio, boardId: string, bytes = JPEG, more: Record<string, unknown> = {}) {
  const up = (await call("/v1/files/upload-url", { method: "POST", cookie: s.cookie,
    json: { name: "p.jpg", contentType: "image/jpeg", size: bytes.byteLength } })).data;
  await call(up.uploadUrl.replace(BASE, ""), { method: "PUT", body: bytes, headers: { "Content-Length": String(bytes.byteLength) } });
  const pin = await card(s, boardId, { kind: "image", fileId: up.file.id, note: "Private note", tags: ["secret-tag"], ...more });
  await call(`/v1/files/${up.file.id}/attach`, { method: "POST", cookie: s.cookie, json: { entityType: "pin", entityId: pin.id } });
  return pin;
}

describe("the owner's links", () => {
  it("makes a link whose token isn't stored, lists it with its token, and turns it off", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const l = await link(a, b.id, { permission: "comment" });
    expect(l).toMatchObject({ boardId: b.id, permission: "comment", locked: false, pinCount: null, version: 1 });
    expect(l.token).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse((l as any).expiresAt) - Date.now()).toBeGreaterThan(29 * 86_400_000);
    const row = await env.DB.prepare("SELECT * FROM shares WHERE id = ?").bind(l.id).first<Record<string, string>>();
    expect(JSON.stringify(row)).not.toContain(l.token);
    expect(row!.token_hash).toBe(await sha256(l.token));
    const list = (await call(`/v1/shares?boardId=${b.id}`, { cookie: a.cookie })).data.items;
    expect(list.map((x: any) => x.token)).toEqual([l.token]);
    expect((await pub(l.token)).status).toBe(200);
    expect((await call(`/v1/shares/${l.id}`, { method: "DELETE", cookie: a.cookie, headers: { "If-Match": "1" } })).status).toBe(200);
    const off = await pub(l.token);
    expect(off.status).toBe(404);
    expect(off.data).toEqual({ error: "This link is no longer active." });
    expect((await call(`/v1/shares?boardId=${b.id}`, { cookie: a.cookie })).data.items).toEqual([]);
  });

  it("an expired link, a deleted board and a made-up token all say the link isn't active", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const never = await link(a, b.id, { expiresDays: 0 });
    expect((never as any).expiresAt).toBeNull();
    const soon = await link(a, b.id, { expiresDays: 1 });
    await env.DB.prepare("UPDATE shares SET expires_at = ? WHERE id = ?").bind("2020-01-01T00:00:00.000Z", soon.id).run();
    expect((await pub(soon.token)).status).toBe(404);
    expect((await pub("f".repeat(64))).status).toBe(404);
    expect((await pub("not-a-token")).status).toBe(404);
    expect((await pub(never.token)).status).toBe(200);
    await call(`/v1/boards/${b.id}`, { method: "DELETE", cookie: a.cookie, headers: { "If-Match": "1" } });
    expect((await pub(never.token)).status).toBe(404);
  });

  it("chosen cards must be live cards of the board; staff may make links, clients of the portal may not", async () => {
    const a = await makeStudio();
    const b = await board(a), other = await board(a);
    const p1 = await card(a, b.id), p2 = await card(a, other.id);
    expect((await link(a, b.id, { pinIds: [p1.id, p2.id] })).pinCount).toBe(1);
    expect((await call("/v1/shares", { method: "POST", cookie: a.cookie, json: { boardId: b.id, permission: "view", pinIds: [p2.id] } })).status).toBe(400);
    expect((await call("/v1/shares", { method: "POST", cookie: a.cookie, json: { boardId: b.id, permission: "view", password: "short" } })).status).toBe(400);
    expect((await call("/v1/shares", { method: "POST", cookie: a.cookie, json: { boardId: b.id, permission: "edit" } })).status).toBe(400);
    const portal = await makeStudio("Portal", "client");
    expect((await call("/v1/shares", { method: "POST", cookie: portal.cookie, json: { boardId: b.id, permission: "view" } })).status).toBe(403);
  });

  it("isn't an assistant tool, and turning a link off always asks (D-095)", async () => {
    const a = await makeStudio();
    const tools = (await call("/v1/assistant/tools?app=studio-wall", { cookie: a.cookie })).data.tools as { name: string; level: string }[];
    expect(tools.find((t) => t.name === "share_create")).toBeUndefined();
    expect(tools.find((t) => t.name === "share_revoke")?.level).toBe("always_confirm");
    expect(tools.some((t) => /^share_(comment|star|add|remove)$/.test(t.name))).toBe(false);
  });
});

describe("what a client sees", () => {
  it("the board, its cards without private notes or tags, comments, and this browser's stars", async () => {
    const a = await makeStudio();
    const b = await board(a, { description: "Warm and calm" });
    const pic = await pictureCard(a, b.id, JPEG, { title: "Rug", sourceCredit: "Ana", palette: ["#aabbcc"] });
    const idea = await card(a, b.id, { title: "Linen", note: "More linen" });
    await call("/v1/boards/" + b.id, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { coverPinId: pic.id } });
    await call("/v1/feedback", { method: "POST", cookie: a.cookie, json: { boardId: b.id, text: "From the artist" } });
    const l = await link(a, b.id, { permission: "comment" });
    await post(l.token, "/feedback", { pin_id: pic.id, starred: true, name: "Ana" });
    await post(l.token, "/feedback", { pin_id: idea.id, text: "Love this", name: "Ana" });
    const got = (await pub(l.token)).data;
    expect(got).toMatchObject({ board: { name: "Living room", description: "Warm and calm" }, permission: "comment", cover: pic.fileId, starred: [pic.id] });
    expect(got.pins.find((p: any) => p.id === pic.id)).toEqual({
      id: pic.id, file_ref: pic.fileId, meta: { kind: "image", title: "Rug" }, source_credit: "Ana", is_own: false,
      source_url: "", note: "", palette: ["#aabbcc"], contributor: "", created_at: pic.createdAt, mine: false,
    });
    expect(got.pins.find((p: any) => p.id === idea.id).note).toBe("More linen");
    expect(JSON.stringify(got)).not.toMatch(/secret-tag|Private note/);
    expect(got.comments.map((c: any) => [c.author, c.text, c.pin_id])).toEqual([["Artist", "From the artist", null], ["Ana", "Love this", idea.id]]);
    // Another browser hasn't starred anything.
    expect((await pub(l.token, "", {}, "h".repeat(20))).data.starred).toEqual([]);
    // Stars are one per browser per card: a repeat changes it, never adds a second.
    await post(l.token, "/feedback", { pin_id: pic.id, starred: false, name: "Ana" });
    expect((await pub(l.token)).data.starred).toEqual([]);
    expect(await rowCount("SELECT count(*) AS n FROM board_feedback WHERE pin_id = ? AND starred IS NOT NULL", pic.id)).toBe(1);
  });

  it("a board with comments off makes every link view only", async () => {
    const a = await makeStudio();
    const b = await board(a, { commentsEnabled: false });
    const p = await card(a, b.id);
    const l = await link(a, b.id);
    expect((await pub(l.token)).data.permission).toBe("view");
    const r = await post(l.token, "/feedback", { pin_id: p.id, text: "hi", name: "Ana" });
    expect(r).toMatchObject({ status: 403, data: { error: "This link is view only." } });
    expect((await post(l.token, "/pins", { note: "x" })).status).toBe(403);
  });

  it("a link to chosen cards shows only those, and the board-wide comments", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const shown = await card(a, b.id, { title: "Shown" }), hidden = await card(a, b.id, { title: "Hidden" });
    await call("/v1/feedback", { method: "POST", cookie: a.cookie, json: { boardId: b.id, pinId: hidden.id, text: "On the hidden one" } });
    await call("/v1/feedback", { method: "POST", cookie: a.cookie, json: { boardId: b.id, text: "On the board" } });
    const l = await link(a, b.id, { pinIds: [shown.id] });
    const got = (await pub(l.token)).data;
    expect(got.pins.map((p: any) => p.id)).toEqual([shown.id]);
    expect(got.comments.map((c: any) => c.text)).toEqual(["On the board"]);
    expect((await post(l.token, "/feedback", { pin_id: hidden.id, text: "x", name: "A" })).status).toBe(404);
  });

  it("pictures: only the link's own, and without their hidden data (D-094)", async () => {
    const a = await makeStudio();
    const b = await board(a), other = await board(a);
    const pic = await pictureCard(a, b.id), elsewhere = await pictureCard(a, other.id);
    const l = await link(a, b.id);
    const res = await app(`/v1/public/shares/${l.token}/files/${pic.fileId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const served = text(await res.arrayBuffer());
    expect(served).not.toMatch(/SECRET/);
    expect(served.slice(-2)).toBe("\xff\xd9");
    expect((await pub(l.token, `/files/${elsewhere.fileId}`)).status).toBe(404);
    expect((await pub(l.token, "/files/not-an-id")).status).toBe(404);
  });
});

/** The raw response, for bytes. */
const app = (path: string, init: RequestInit = {}) => worker.request(`${BASE}${path}`, init, env);

// ------------------------------------------------------------------ Studio Wall's src/contribute.test.ts, ported

describe("client contributions (ported)", () => {
  it("lets a contribute link add images and notes, and nothing else", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const p1 = await card(a, b.id);
    const add = (await link(a, b.id)).token;
    const view = (await link(a, b.id, { permission: "comment" })).token;
    const chosen = (await link(a, b.id, { pinIds: [p1.id] })).token;
    // A comment-only link can't add cards; a contribute link can still comment.
    expect((await post(view, "/pins?name=Ana", { note: "hi" })).status).toBe(403);
    expect((await post(add, "/feedback", { text: "Lovely", name: "Ana" })).status).toBe(200);
    const note = await post(add, "/pins?name=Ana", { title: "Idea", note: "More oak", url: "https://example.com/oak" });
    expect(note.status).toBe(200);
    expect(note.data.pin).toMatchObject({ contributor: "Ana", meta: { kind: "link", title: "Idea" }, source_url: "https://example.com/oak", mine: true });
    const stored = (await call(`/v1/pins/${note.data.pin.id}`, { cookie: a.cookie })).data;
    expect(stored).toMatchObject({ boardId: b.id, createdBy: `guest:${GUEST}`, contributorName: "Ana", actorType: "user" });
    // Images: sniffed, stored in the owner's studio, visible through the link; non-images and bad links refused.
    const img = await pub(add, "/pins?name=Ben&title=Rug&palette=%23aabbcc,nope", { method: "POST", headers: { "content-type": "image/png" }, body: PNG });
    expect(img.status).toBe(200);
    expect(img.data.pin.palette).toEqual(["#aabbcc"]);
    const file = (await call(`/v1/files/${img.data.pin.file_ref}/download-url`, { cookie: a.cookie })).status;
    expect(file).toBe(200);
    expect((await pub(add, `/files/${img.data.pin.file_ref}`)).status).toBe(200);
    expect((await pub(add, "/pins", { method: "POST", headers: { "content-type": "image/png" }, body: "not an image" })).status).toBe(415);
    expect((await post(add, "/pins", { url: "javascript:alert(1)" })).status).toBe(400);
    const got = (await pub(add)).data;
    expect(got.pins.map((p: any) => p.contributor).sort()).toEqual(["", "Ana", "Ben"]);
    // A link to chosen cards shows the cards its clients add, not other clients' additions.
    const mine = (await post(chosen, "/pins?name=Cy", { note: "Brass" })).data.pin;
    expect((await pub(chosen)).data.pins.map((p: any) => p.id).sort()).toEqual([p1.id, mine.id].sort());
    // Daily limit per client (25), and another client still may.
    for (let i = 0; i < 22; i++) await post(add, "/pins", { note: "x" });
    expect((await post(add, "/pins", { note: "x" })).status).toBe(429);
    expect((await post(add, "/pins", { note: "x" }, "h".repeat(20))).status).toBe(200);
  });

  it("lets a client remove only the cards they added, as a soft delete", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const own = await card(a, b.id);
    const add = (await link(a, b.id)).token, view = (await link(a, b.id, { permission: "comment" })).token;
    const ana = "a1".repeat(10), ben = "b1".repeat(10);
    const pin = (await post(add, "/pins?name=Ana", { note: "Wrong one" }, ana)).data.pin;
    expect(pin.mine).toBe(true);
    // Only the browser that added it sees it as theirs; the owner's own card is no one's to remove.
    const seen = async (g: string) => (await pub(add, "", {}, g)).data.pins.filter((p: any) => p.mine).map((p: any) => p.id);
    expect(await seen(ana)).toEqual([pin.id]);
    expect(await seen(ben)).toEqual([]);
    const remove = (id: string, g: string, token = add) => pub(token, `/pins/${id}`, { method: "DELETE" }, g);
    expect((await remove(pin.id, ben)).status).toBe(403);
    expect((await remove(own.id, ana)).status).toBe(403);
    expect((await remove(pin.id, ana, view)).status).toBe(403);
    expect((await remove(pin.id, ana)).status).toBe(200);
    expect((await remove(pin.id, ana)).status).toBe(404);
    expect((await pub(add, "", {}, ana)).data.pins.some((p: any) => p.id === pin.id)).toBe(false);
    // A newer, deleted version that the owner's devices pull into Recently deleted.
    const row = await env.DB.prepare("SELECT * FROM pins WHERE id = ?").bind(pin.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ version: 2, contributor_name: "Ana", deleted_by: `guest:${ana}` });
    expect(row!.deleted_at).toBeTruthy();
    // The owner can bring it back.
    expect((await call("/v1/actions/pin.restore", { method: "POST", cookie: a.cookie, json: { id: pin.id } })).status).toBe(200);
  });

  it("adds several images in one request, all or nothing", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const p1 = await card(a, b.id);
    const add = (await link(a, b.id)).token, chosen = (await link(a, b.id, { pinIds: [p1.id] })).token;
    const cy = "c1".repeat(10);
    const count = async () => Number(await rowCount("SELECT count(*) AS n FROM pins WHERE board_id = ?", b.id));
    const objects = async () => (await env.FILES.list({ prefix: `studios/${a.studioId}/` })).objects.length;
    const form = (n: number, bad = -1) => {
      const f = new FormData();
      f.set("title", "Tiles");
      for (let i = 0; i < n; i++) {
        f.append("image", new Blob([i === bad ? Uint8Array.from([1, 2, 3]) : PNG], { type: "image/png" }), "x.png");
        f.append("palette", i ? "#112233" : "#aabbcc,nope");
      }
      return f;
    };
    const send = (token: string, body: FormData, g = cy) => pub(token, "/pins?name=Cy", { method: "POST", body }, g);
    const r = await send(add, form(3));
    expect(r.status).toBe(200);
    const { pins } = r.data;
    expect(pins).toHaveLength(3);
    expect(pins.map((p: any) => p.palette)).toEqual([["#aabbcc"], ["#112233"], ["#112233"]]);
    expect(pins.every((p: any) => p.mine && p.contributor === "Cy" && p.meta.title === "Tiles" && p.file_ref)).toBe(true);
    // One unreadable file, too many files, or more than today's allowance: nothing is stored.
    const before = await count(), stored = await objects();
    expect((await send(add, form(3, 1))).status).toBe(415);
    expect((await send(add, form(11))).status).toBe(400);
    for (let i = 0; i < 20; i++) await post(add, "/pins", { note: "x" }, cy);
    const over = await send(add, form(3));
    expect(over.status).toBe(429);
    expect(over.data.error).toContain("2 more today");
    expect(await count()).toBe(before + 20);
    expect(await objects()).toBe(stored);
    // A chosen-cards link shows every image its client added.
    const two = (await send(chosen, form(2), "d2".repeat(10))).data.pins.map((p: any) => p.id);
    expect((await pub(chosen)).data.pins.map((p: any) => p.id).sort()).toEqual([p1.id, ...two].sort());
  });

  it("keeps the first link when a list or several lines arrive (iPhone Shortcut URLs)", async () => {
    const a = await makeStudio();
    const add = (await link(a, (await board(a)).id)).token;
    for (const url of [["https://a.example/x", "https://b.example"], "https://a.example/x\nhttps://b.example", " https://a.example/x "]) {
      expect((await post(add, "/pins", { url }, "e3".repeat(10))).data.pin.source_url).toBe("https://a.example/x");
    }
  });

  it("strips a client's photo before storing it", async () => {
    const a = await makeStudio();
    const add = (await link(a, (await board(a)).id)).token;
    const r = await pub(add, "/pins?name=Ana", { method: "POST", headers: { "content-type": "image/jpeg" }, body: JPEG });
    expect(r.status).toBe(200);
    const row = await env.DB.prepare("SELECT r2_key, size FROM files WHERE id = ?").bind(r.data.pin.file_ref).first<{ r2_key: string; size: number }>();
    const obj = await env.FILES.get(row!.r2_key);
    const stored = text(await obj!.arrayBuffer());
    expect(stored).not.toMatch(/SECRET/);
    expect(row!.size).toBe(stored.length);
  });

  it("needs a browser id, and limits comments and stars to 60 an hour per browser", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const l = (await link(a, b.id)).token;
    expect((await pub(l, "/feedback", { method: "POST", json: { text: "x" }, headers: { "x-guest-id": "" } })).status).toBe(400);
    for (let i = 0; i < 60; i++) await post(l, "/feedback", { text: `c${i}`, name: "Ana" }, "z9".repeat(10));
    const over = await post(l, "/feedback", { text: "one more", name: "Ana" }, "z9".repeat(10));
    expect(over).toMatchObject({ status: 429, data: { error: "Too many messages — please wait a little." } });
  });
});

// ------------------------------------------------------------------ Studio Wall's src/share-password.test.ts, ported

describe("password links (ported)", () => {
  it("stores only a salted hash; the page asks once, then the browser's cookie opens the board and its pictures", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const pic = await pictureCard(a, b.id);
    const l = await link(a, b.id, { password: "coastal-blue" });
    expect(l.locked).toBe(true);
    const row = await env.DB.prepare("SELECT password_hash FROM shares WHERE id = ?").bind(l.id).first<{ password_hash: string }>();
    expect(row!.password_hash).toMatch(/^pbkdf2\$/);
    expect(row!.password_hash).not.toContain("coastal");
    expect(await rowCount("SELECT count(*) AS n FROM activity_log WHERE after LIKE '%coastal-blue%'")).toBe(0);
    expect((await pub(l.token)).data).toEqual({ error: "This board needs a password.", password: true });
    expect((await pub(l.token, `/files/${pic.fileId}`)).status).toBe(401);
    expect((await post(l.token, "/unlock", { password: "Coastal-blue" })).data).toEqual({ error: "That password isn’t right." });
    const ok = await pub(l.token, "/unlock", { method: "POST", json: { password: "coastal-blue" }, headers: { "x-share-path": `/api/s/${l.token}` } });
    expect(ok.status).toBe(200);
    const set = ok.headers.get("set-cookie")!;
    expect(set).toMatch(new RegExp(`^sw_link=[A-Za-z0-9_-]+; Path=/api/s/${l.token}; Max-Age=\\d+; HttpOnly; Secure; SameSite=Lax$`));
    const cookie = set.split(";")[0]!;
    expect((await pub(l.token, "", { cookie })).status).toBe(200);
    expect((await pub(l.token, `/files/${pic.fileId}`, { cookie })).status).toBe(200);
    // The cookie is this link's only.
    const other = await link(a, b.id, { password: "another-one" });
    expect((await pub(other.token, "", { cookie })).status).toBe(401);
  });

  it("locks an address out after 10 wrong tries for 15 minutes; another address can still try", async () => {
    const a = await makeStudio();
    const l = await link(a, (await board(a)).id, { password: "coastal-blue" });
    const tryWith = (password: string, ip: string) =>
      pub(l.token, "/unlock", { method: "POST", json: { password }, headers: { "cf-connecting-ip": ip } });
    for (let i = 0; i < 10; i++) expect((await tryWith("wrong", "1.1.1.1")).status).toBe(400);
    expect((await tryWith("coastal-blue", "1.1.1.1")).status).toBe(429);
    expect((await tryWith("coastal-blue", "2.2.2.2")).status).toBe(200);
    // Addresses are kept only as hashes.
    expect(await rowCount("SELECT count(*) AS n FROM share_attempts WHERE ip_hash LIKE '%1.1.1.1%'")).toBe(0);
  });
});

describe("guests' writes reach the owner", () => {
  it("as records the owner's devices pull, marked guest:", async () => {
    const a = await makeStudio();
    const b = await board(a);
    const p = await card(a, b.id);
    const l = (await link(a, b.id)).token;
    await post(l, "/feedback", { pin_id: p.id, text: "Lovely", name: "Ana" });
    await post(l, "/pins?name=Ana", { note: "Brass" });
    const pulled = (await call("/v1/sync/pull?since=0", { cookie: a.cookie })).data.changes as any[];
    const fromGuest = pulled.filter((c) => c.record.createdBy === `guest:${GUEST}`).map((c) => c.entityType).sort();
    expect(fromGuest).toEqual(["feedback", "pin"]);
    expect(pulled.some((c) => c.entityType === "share")).toBe(false);
  });

  it("one studio's link never reaches another studio's cards or pictures", async () => {
    const a = await makeStudio("A"), b = await makeStudio("B");
    const bBoard = await board(b);
    const bPic = await pictureCard(b, bBoard.id);
    const l = (await link(a, (await board(a)).id)).token;
    expect((await pub(l, `/files/${bPic.fileId}`)).status).toBe(404);
    expect((await pub(l, `/pins/${bPic.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await post(l, "/feedback", { pin_id: bPic.id, text: "x", name: "A" })).status).toBe(404);
    expect((await post(l, "/feedback", { pin_id: bPic.id, starred: true, name: "A" })).status).toBe(404);
    expect(await rowCount("SELECT count(*) AS n FROM board_feedback WHERE studio_id = ?", b.studioId)).toBe(0);
  });
});
