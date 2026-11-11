// Site 3.0 stage 1 (D-104…D-110): publishing, the assistant's drafts, picture sizes and order.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { addPicture, makeWork, webpBytes } from "./catalogue-helpers";
import { ASSISTANT, BASE, call, makeStudio } from "./helpers";

const version = async (studioId: string) =>
  (await env.DB.prepare("SELECT catalogue_version AS v FROM studios WHERE id = ?").bind(studioId).first<number>("v"))!;

describe("the catalogue", () => {
  it("publishing needs a cover with its sizes, makes a unique slug, and a stale version is 409", async () => {
    const s = await makeStudio();
    const bare = (await call("/v1/artworks", { method: "POST", cookie: s.cookie, json: { title: "Heron" } })).data;
    const noCover = await call(`/v1/artworks/${bare.id}/publish`, { method: "POST", cookie: s.cookie, headers: { "If-Match": "1" } });
    expect(noCover.status).toBe(400);
    expect(noCover.data.error.message).toMatch(/cover/);

    const { work } = await makeWork(s, { title: "Heron at Dusk" });
    const stale = await call(`/v1/artworks/${work.id}/publish`, { method: "POST", cookie: s.cookie, headers: { "If-Match": String(work.version - 1) } });
    expect(stale.status).toBe(409);
    expect(await call(`/v1/artworks/${work.id}/publish`, { method: "POST", cookie: s.cookie })).toMatchObject({ status: 400 }); // no If-Match

    const before = await version(s.studioId);
    const pub = await call(`/v1/artworks/${work.id}/publish`, { method: "POST", cookie: s.cookie, headers: { "If-Match": String(work.version) } });
    expect(pub.status).toBe(200);
    expect(pub.data).toMatchObject({ public: true, slug: "heron-at-dusk", draftedFields: [] });
    expect(pub.data.publishedAt).toBeTruthy();
    expect(await version(s.studioId)).toBeGreaterThan(before);

    const twin = await makeWork(s, { title: "Heron at Dusk" }, { publish: true });
    expect(twin.work.slug).toBe("heron-at-dusk-2");
    const taken = await call(`/v1/artworks/${twin.work.id}`, { method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(twin.work.version) }, json: { slug: "heron-at-dusk" } });
    expect(taken.status).toBe(400);
    expect(taken.data.error.details.field).toBe("slug");

    const un = await call(`/v1/artworks/${work.id}/unpublish`, { method: "POST", cookie: s.cookie, headers: { "If-Match": String(pub.data.version) } });
    expect(un.data).toMatchObject({ public: false, slug: "heron-at-dusk" });
    expect(un.data.publishedAt).toBe(pub.data.publishedAt);
  });

  it("only the assistant drafts, and a draft never overwrites the artist's words or publishes", async () => {
    const s = await makeStudio();
    const { work, file } = await makeWork(s, { title: "Red figure" });
    const draft = { description: "A figure in red plaster.", tags: ["red", "Figure"], collection: "Figurative", altText: "A red plaster figure on panel", usage: { model: "claude-haiku-5-5", inputTokens: 1500, outputTokens: 300 } };

    expect((await call(`/v1/artworks/${work.id}/draft`, { method: "POST", cookie: s.cookie, json: draft })).status).toBe(403);
    // Never by name either (an internal action; the name isn't even a valid action path).
    expect([400, 404]).toContain((await call("/v1/actions/artwork.applyDraft", { method: "POST", cookie: s.cookie, headers: ASSISTANT, json: { ...draft, id: work.id } })).status);

    const d1 = await call(`/v1/artworks/${work.id}/draft`, { method: "POST", cookie: s.cookie, headers: ASSISTANT, json: draft });
    expect(d1.status).toBe(200);
    expect(d1.data).toMatchObject({ description: draft.description, tags: ["red", "figure"], collection: "Figurative", public: false, actorType: "user" });
    expect(d1.data.draftedFields.sort()).toEqual(["altText", "collection", "description", "tags"]);
    expect(d1.data.meta.draft).toMatchObject({ model: "claude-haiku-5-5", inputTokens: 1500 });
    const detail = (await call(`/v1/artworks/${work.id}`, { cookie: s.cookie })).data;
    expect(detail.images[0]).toMatchObject({ id: file.id, altText: draft.altText });
    const log = (await env.DB.prepare("SELECT actor_type, source FROM activity_log WHERE action = 'artwork.applyDraft' AND studio_id = ?").bind(s.studioId).all()).results;
    expect(log.every((r: any) => r.actor_type === "assistant" && r.source === "assistant")).toBe(true);

    // The artist rewrites the description: it becomes theirs.
    const edited = await call(`/v1/artworks/${work.id}`, { method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(d1.data.version) }, json: { description: "My words." } });
    expect(edited.data.draftedFields).not.toContain("description");
    // …and the cover's alt text.
    const cover = await call(`/v1/files/${file.id}`, { method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(detail.images[0].version) }, json: { altText: "Mine too" } });
    expect(cover.status).toBe(200);

    const d2 = await call(`/v1/artworks/${work.id}/draft`, { method: "POST", cookie: s.cookie, headers: ASSISTANT,
      json: { description: "Redrafted.", tags: ["plaster"], altText: "Redrafted alt" } });
    expect(d2.data.description).toBe("My words.");
    expect(d2.data.tags).toEqual(["plaster"]); // still a draft, so redone
    expect(d2.data.draftedFields.sort()).toEqual(["collection", "tags"]);
    expect((await call(`/v1/artworks/${work.id}`, { cookie: s.cookie })).data.images[0].altText).toBe("Mine too");

    // Approving accepts the drafts, and a public work takes no new draft: it would go live unreviewed.
    const pub = await call(`/v1/artworks/${work.id}/publish`, { method: "POST", cookie: s.cookie, headers: { "If-Match": String(d2.data.version) } });
    expect(pub.data.draftedFields).toEqual([]);
    const d3 = await call(`/v1/artworks/${work.id}/draft`, { method: "POST", cookie: s.cookie, headers: ASSISTANT, json: { tags: ["changed"] } });
    expect(d3.status).toBe(400);
    expect((await call(`/v1/artworks/${work.id}`, { cookie: s.cookie })).data.tags).toEqual(["plaster"]);
  });

  it("a new cover's alt text is the artist's, and only an unlocked photo can be the public cover", async () => {
    const s = await makeStudio();
    const { work } = await makeWork(s);
    await call(`/v1/artworks/${work.id}/draft`, { method: "POST", cookie: s.cookie, headers: ASSISTANT, json: { altText: "Drafted" } });
    const second = await addPicture(s, work.id);
    const mine = await call(`/v1/files/${second.id}`, { method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(second.version) }, json: { altText: "Mine" } });
    await call("/v1/files/reorder", { method: "POST", cookie: s.cookie, json: { entityType: "artwork", entityId: work.id, fileIds: [second.id] } });
    const after = (await call(`/v1/artworks/${work.id}`, { cookie: s.cookie })).data;
    expect(after.draftedFields).not.toContain("altText");
    await call(`/v1/artworks/${work.id}/draft`, { method: "POST", cookie: s.cookie, headers: ASSISTANT, json: { altText: "Redrafted" } });
    expect((await call(`/v1/artworks/${work.id}`, { cookie: s.cookie })).data.images[0].altText).toBe(mine.data.altText);

    const locked = await call(`/v1/files/${second.id}`, { method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(mine.data.version + 1) }, json: { locked: true } });
    expect(locked.status).toBe(200);
    const fresh = (await call(`/v1/artworks/${work.id}`, { cookie: s.cookie })).data;
    const pub = await call(`/v1/artworks/${work.id}/publish`, { method: "POST", cookie: s.cookie, headers: { "If-Match": String(fresh.version) } });
    expect(pub.status).toBe(400);
    expect(pub.data.error.message).toMatch(/photo/);
  });

  it("the assistant can't publish, even through its own act route", async () => {
    const s = await makeStudio();
    const { work } = await makeWork(s);
    const res = await call("/v1/assistant/act", { method: "POST", cookie: s.cookie, headers: ASSISTANT,
      json: { action: "artwork.publish", input: { id: work.id, version: work.version }, summary: "Publish" } });
    expect(res.status).toBe(403);
    expect((await call(`/v1/artworks/${work.id}/publish`, { method: "POST", cookie: s.cookie, headers: { ...ASSISTANT, "If-Match": String(work.version) } })).status).toBe(403);
  });

  it("sizes: one signed link each, only real WebP of the declared length, and attach waits for every size", async () => {
    const s = await makeStudio();
    const work = (await call("/v1/artworks", { method: "POST", cookie: s.cookie, json: { title: "Sizes" } })).data;
    const up = (await call("/v1/files/upload-url", { method: "POST", cookie: s.cookie,
      json: { name: "a.jpg", contentType: "image/jpeg", size: 3, sizes: [{ width: 480, size: 20 }, { width: 960, size: 20 }] } })).data;
    expect(up.sizeUrls.map((l: any) => l.width)).toEqual([480, 960]);
    expect(up.file.meta.sizes).toEqual([{ width: 480, size: 20 }, { width: 960, size: 20 }]);
    const put = (url: string, body: Uint8Array) => call(url.replace(BASE, ""), { method: "PUT", body: body as unknown as BodyInit, headers: { "Content-Length": String(body.length) } });
    await put(up.uploadUrl, new Uint8Array([1, 2, 3]));
    const l480 = up.sizeUrls[0].uploadUrl;
    expect((await put(l480, new Uint8Array(20))).status).toBe(400); // not WebP
    expect((await put(l480, webpBytes(21))).status).toBe(400); // wrong length
    expect((await put(l480.replace("w=480", "w=960"), webpBytes(20))).status).toBe(404); // signature names the width
    expect((await put(l480, webpBytes(20))).status).toBe(204);
    expect((await call(`/v1/files/${up.file.id}/attach`, { method: "POST", cookie: s.cookie, json: { entityType: "artwork", entityId: work.id } })).status).toBe(409);
    expect((await put(up.sizeUrls[1].uploadUrl, webpBytes(20))).status).toBe(204);
    expect((await call(`/v1/files/${up.file.id}/attach`, { method: "POST", cookie: s.cookie, json: { entityType: "artwork", entityId: work.id } })).status).toBe(200);

    const link = (await call(`/v1/files/${up.file.id}/download-url?width=960`, { cookie: s.cookie })).data;
    const got = await call(link.url.replace(BASE, ""));
    expect(got.headers.get("content-type")).toBe("image/webp");
    expect((await call(`/v1/files/${up.file.id}/download-url?width=1600`, { cookie: s.cookie })).status).toBe(404);
    expect((await call("/v1/files/upload-url", { method: "POST", cookie: s.cookie,
      json: { name: "a.pdf", contentType: "application/pdf", size: 3, sizes: [{ width: 480, size: 20 }] } })).status).toBe(400);
  });

  it("pictures keep their order; reorder makes the first one the cover", async () => {
    const s = await makeStudio();
    const { work, file: first } = await makeWork(s);
    const second = await addPicture(s, work.id);
    const third = await addPicture(s, work.id);
    expect([first.position, second.position, third.position]).toEqual([0, 1, 2]);
    const res = await call("/v1/files/reorder", { method: "POST", cookie: s.cookie, json: { entityType: "artwork", entityId: work.id, fileIds: [third.id] } });
    expect(res.status).toBe(200);
    const detail = (await call(`/v1/artworks/${work.id}`, { cookie: s.cookie })).data;
    expect(detail.images.map((f: any) => f.id)).toEqual([third.id, first.id, second.id]);
    expect(detail.primaryFileId).toBe(third.id);
    const other = await makeStudio();
    const theirs = await makeWork(other);
    expect((await call("/v1/files/reorder", { method: "POST", cookie: s.cookie, json: { entityType: "artwork", entityId: work.id, fileIds: [theirs.file.id] } })).status).toBe(404);
    // A cover must be one of this studio's files.
    expect((await call(`/v1/artworks/${work.id}`, { method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(detail.version) }, json: { primaryFileId: theirs.file.id } })).status).toBe(404);
  });

  it("collections are counted per studio, and works filter by collection", async () => {
    const s = await makeStudio();
    for (const c of ["Abstract", "Abstract", "Sculptural"]) await call("/v1/artworks", { method: "POST", cookie: s.cookie, json: { title: c, collection: c } });
    expect((await call("/v1/artworks/collections", { cookie: s.cookie })).data.items).toEqual([{ name: "Abstract", count: 2 }, { name: "Sculptural", count: 1 }]);
    expect((await call("/v1/artworks?collection=Sculptural", { cookie: s.cookie })).data.items).toHaveLength(1);
  });
});
