import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, makeStudio, rowCount } from "./helpers";

describe("action runner", () => {
  it("writes the record and its log entry together", async () => {
    const a = await makeStudio();
    const res = await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "Heron", priceCents: 120000 } });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ title: "Heron", priceCents: 120000, version: 1, studioId: a.studioId });
    expect(await rowCount("SELECT COUNT(*) AS n FROM activity_log WHERE entity_id = ?", res.data.id)).toBe(1);
  });

  it("a stale version aborts the whole batch: no change, no log entry", async () => {
    const a = await makeStudio();
    const { data: art } = await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "Heron" } });
    // Someone else edits first (version 1 → 2), behind the API's back.
    await env.DB.prepare("UPDATE artworks SET version = 2, title = 'Changed elsewhere' WHERE id = ?").bind(art.id).run();
    const { runAction, getAction } = await import("../src/actions/runner");
    const { updateWrite, artworkEntity } = await import("../src/actions/records");
    // Plan against the old row (version 1) to simulate a race between read and write.
    const actor = { userId: a.userId, email: "", name: null, sessionId: null, studioId: a.studioId, role: "owner" as const, clientId: null };
    const def = {
      ...getAction("artwork.update")!,
      name: "test.race",
      plan: async (ctx: any) => ({ writes: [updateWrite(ctx, artworkEntity, { ...art, version: 1 }, { title: "Mine" })] }),
    };
    await expect(runAction(def as any, { id: art.id, version: 1, patch: { title: "Mine" } }, { env, actor, origin: "https://x" }))
      .rejects.toMatchObject({ code: "version_conflict" });
    const row = await env.DB.prepare("SELECT title, version FROM artworks WHERE id = ?").bind(art.id).first();
    expect(row).toEqual({ title: "Changed elsewhere", version: 2 });
    expect(await rowCount("SELECT COUNT(*) AS n FROM activity_log WHERE entity_id = ?", art.id)).toBe(1);
  });
});
