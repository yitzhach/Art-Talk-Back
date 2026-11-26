// node --test scripts/owner-update — the runner against a fake studio API.
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { checkUpdate, makeApi, runStep } from "./run.mjs";

function fakeStudio() {
  const calls = [];
  const show = { id: "S1", version: 3, name: "Red Dot Miami", meta: { publicPage: { published: true, slug: "red-dot-miami-2026", description: "x", photos: ["P0"] } } };
  const works = [{ id: "W1", title: "Hope", version: 1 }];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname + u.search, headers: init.headers, body: init.body });
    const ok = (data) => new Response(JSON.stringify(data), { status: 200 });
    const p = u.pathname;
    if (init.method === "PUT") return new Response(null, { status: 200 });
    if (p === "/v1/shows" && init.method === "GET") return ok({ items: [show], nextCursor: null });
    if (p === "/v1/shows/S1" && init.method === "GET") return ok({ ...show, artworks: [] });
    if (p === "/v1/shows/S1" && init.method === "PATCH") return ok({ ...show, version: 4 });
    if (p === "/v1/artworks" && init.method === "GET") return ok({ items: works, nextCursor: null });
    if (p === "/v1/artworks" && init.method === "POST") return ok({ id: "P1", version: 1 });
    if (p === "/v1/files/upload-url") {
      const b = JSON.parse(init.body);
      return ok({ file: { id: "F1" }, uploadUrl: "https://up/F1", sizeUrls: b.sizes.map((s) => ({ width: s.width, uploadUrl: `https://up/F1?w=${s.width}` })) });
    }
    if (p === "/v1/artworks/P1" && init.method === "PATCH") return ok({ id: "P1", version: 2 });
    if (p.startsWith("/v1/")) return ok({});
    return new Response("nope", { status: 404 });
  };
  return { calls, api: makeApi("https://site.test", "tok", fetchImpl) };
}

test("show.update sends only the named fields with the show's version, signed in by cookie", async () => {
  const { api, calls } = fakeStudio();
  await runStep(api, { op: "show.update", show: "red-dot-miami-2026", fields: { booth: "214" } });
  const patch = calls.find((c) => c.method === "PATCH");
  assert.equal(patch.path, "/v1/shows/S1");
  assert.deepEqual(JSON.parse(patch.body), { booth: "214" });
  assert.equal(patch.headers["if-match"], "3");
  assert.equal(patch.headers.cookie, "studio_session=tok");
});

test("show.add_photo uploads the original and WebP copies, publishes it and puts it first", async () => {
  const { api, calls } = fakeStudio();
  const jpg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#3366aa" } }).jpeg().toBuffer();
  const out = await runStep(api, { op: "show.add_photo", show: "Red Dot Miami", file: "x/sample.jpg", first: true }, async () => jpg);
  assert.match(out, /first/);
  const up = JSON.parse(calls.find((c) => c.path === "/v1/files/upload-url").body);
  assert.deepEqual(up.sizes.map((s) => s.width), [480, 960, 1600]);
  assert.deepEqual(up.pixels, { width: 1200, height: 800 });
  assert.equal(calls.filter((c) => c.method === "PUT").length, 4);
  assert.ok(calls.some((c) => c.path === "/v1/artworks/P1/publish" && c.headers["if-match"] === "2"));
  const set = calls.filter((c) => c.path === "/v1/actions/show.set_page").at(-1);
  assert.deepEqual(JSON.parse(set.body).photos, ["P1", "P0"]);
});

test("a show that doesn't match stops the run", async () => {
  const { api } = fakeStudio();
  await assert.rejects(runStep(api, { op: "show.update", show: "Art Basel", fields: {} }), /No show matches/);
});

test("an update for another target is refused", () => {
  assert.throws(() => checkUpdate({ target: "production", studio: "x", steps: [{}] }, "staging"), /this run is for "staging"/);
  assert.doesNotThrow(() => checkUpdate({ target: "staging", studio: "isaac-anderson-art-sbtwkm", steps: [{}] }, "staging"));
});
