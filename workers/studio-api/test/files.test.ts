import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BASE, call, makeStudio } from "./helpers";

const bytes = new TextEncoder().encode("fake jpeg bytes for the heron");
const rel = (url: string) => url.replace(BASE, "");

async function start(cookie: string, size = bytes.length) {
  const res = await call("/v1/files/upload-url", { method: "POST", cookie, json: { name: "heron photo.jpg", contentType: "image/jpeg", size, kind: "photo" } });
  expect(res.status).toBe(200);
  return res.data as { file: any; uploadUrl: string; expiresAt: string };
}

describe("files: signed upload → attach → signed download (D-018, D-020)", () => {
  it("round-trips the bytes and links the file to an artwork", async () => {
    const a = await makeStudio();
    const { data: art } = await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "Heron" } });
    const up = await start(a.cookie);
    expect(up.file).toMatchObject({ status: "pending", name: "heron photo.jpg", kind: "photo" });
    expect(up.file.r2Key).toBeUndefined(); // storage keys never leave the API

    // Upload with no session: the signed link is the permission.
    const put = await call(rel(up.uploadUrl), { method: "PUT", body: bytes, headers: { "Content-Length": String(bytes.length) } });
    expect(put.status).toBe(204);

    const key = await env.DB.prepare("SELECT r2_key FROM files WHERE id = ?").bind(up.file.id).first<string>("r2_key");
    expect(key).toBe(`studios/${a.studioId}/${up.file.id}-heron_photo.jpg`);

    const attached = await call(`/v1/files/${up.file.id}/attach`, { method: "POST", cookie: a.cookie, json: { entityType: "artwork", entityId: art.id } });
    expect(attached.status).toBe(200);
    expect(attached.data).toMatchObject({ status: "ready", entityType: "artwork", entityId: art.id, version: 2 });

    const link = await call(`/v1/files/${up.file.id}/download-url`, { cookie: a.cookie });
    const got = await call(rel(link.data.url));
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    expect(got.raw).toBe("fake jpeg bytes for the heron");

    const log = (await call(`/v1/activity?entityId=${up.file.id}`, { cookie: a.cookie })).data.items.map((e: any) => e.action);
    expect(log).toEqual(["file.attach", "file.upload"]);
  });

  it("refuses tampered, wrong-method and expired links", async () => {
    const a = await makeStudio();
    const up = await start(a.cookie);
    const tampered = rel(up.uploadUrl).replace(/sig=([0-9a-f])/, (_m, c) => `sig=${c === "0" ? "1" : "0"}`);
    expect((await call(tampered, { method: "PUT", body: bytes, headers: { "Content-Length": String(bytes.length) } })).status).toBe(404);
    expect((await call(rel(up.uploadUrl))).status).toBe(404); // a PUT link can't download
    const expired = rel(up.uploadUrl).replace(/exp=\d+/, "exp=1000");
    expect((await call(expired, { method: "PUT", body: bytes, headers: { "Content-Length": String(bytes.length) } })).status).toBe(404);
  });

  it("refuses the wrong number of bytes, and attaching before the upload lands", async () => {
    const a = await makeStudio();
    const { data: art } = await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "Heron" } });
    const up = await start(a.cookie, bytes.length + 5);
    expect((await call(rel(up.uploadUrl), { method: "PUT", body: bytes, headers: { "Content-Length": String(bytes.length) } })).status).toBe(400);
    const early = await call(`/v1/files/${up.file.id}/attach`, { method: "POST", cookie: a.cookie, json: { entityType: "artwork", entityId: art.id } });
    expect(early.status).toBe(409);
    expect((await call(`/v1/files/${up.file.id}/download-url`, { cookie: a.cookie })).status).toBe(409);
  });

  it("caps uploads at 100 MB", async () => {
    const a = await makeStudio();
    const res = await call("/v1/files/upload-url", { method: "POST", cookie: a.cookie, json: { name: "big.mov", contentType: "video/quicktime", size: 101 * 1024 * 1024 } });
    expect(res.status).toBe(400);
  });
});
