// The draft job: a stubbed studio-api and a scripted model; no key, no network.
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { makeHandler } from "../src/index";
import { message, scripted, text } from "./harness";

const ID = "01J00000000000000000000001";
const COVER = "01J00000000000000000000002";
const PNG_BYTES = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 250, 251]);
const B64 = btoa(String.fromCharCode(...PNG_BYTES));

interface Call { method: string; url: string; headers: Headers; body: any }
function studio(opts: { signedIn?: boolean; cover?: boolean; voice?: string; no960?: boolean } = {}) {
  const calls: Call[] = [];
  const o = { signedIn: true, cover: true, ...opts };
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as string, init);
    const url = new URL(req.url);
    const body: any = req.method === "POST" ? await req.json() : undefined;
    calls.push({ method: req.method, url: url.pathname + url.search, headers: req.headers, body });
    const j = (d: unknown, status = 200) => Response.json(d, { status });
    if (url.pathname.startsWith("/signed/")) return new Response(PNG_BYTES, { headers: { "content-type": "image/webp" } });
    if (!o.signedIn) return j({ error: { code: "unauthorized", message: "Sign in" } }, 401);
    if (url.pathname === `/v1/artworks/${ID}`) {
      return j({ id: ID, title: "Heron at dusk", medium: "oil", year: 2024, primaryFileId: o.cover ? COVER : null,
        images: o.cover ? [{ id: COVER, contentType: "image/jpeg", size: 1000 }] : [] });
    }
    if (url.pathname === `/v1/files/${COVER}/download-url`) {
      if (o.no960 && url.searchParams.get("width") === "960") return j({ error: { code: "not_found", message: "no" } }, 404);
      return j({ url: `https://studio-api/signed/${COVER}?w=${url.searchParams.get("width")}`, expiresAt: "x" });
    }
    if (url.pathname === "/v1/artworks/collections") return j({ items: [{ name: "Herons" }, { name: "Marsh" }] });
    if (url.pathname === "/v1/settings") return j({ meta: o.voice ? { voice: o.voice } : {} });
    if (url.pathname === `/v1/artworks/${ID}/draft`) return j({ id: ID, ...(body as object) });
    return j({ error: { code: "not_found", message: "?" } }, 404);
  };
  return { calls, fetcher: { fetch: fetcher } as unknown as Fetcher, drafts: () => calls.filter((c) => c.url.endsWith("/draft")) };
}

const env = (s: { fetcher: Fetcher }, extra: Partial<Record<keyof Env, string | undefined>> = {}): Env => ({
  STUDIO_API: s.fetcher, ASSISTANT_KEY: "k", ASSISTANT_MODEL: "claude-sonnet-5-5", ASSISTANT_EFFORT: "low", AI_GATEWAY_URL: "",
  ANTHROPIC_API_KEY: "sk", DRAFT_MODEL: "claude-haiku-5-5", ...extra,
} as Env);

async function post(handler: ReturnType<typeof makeHandler>, e: Env, body: unknown) {
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException: () => {} } as unknown as ExecutionContext;
  const res = await handler.fetch(new Request("https://app.test/assistant/draft", {
    method: "POST", headers: { cookie: "sid=1", "content-type": "application/json" }, body: JSON.stringify(body),
  }), e, ctx);
  const out = { status: res.status, body: (await res.json()) as any };
  await Promise.all(waits);
  return out;
}

const reply = (t: string) => scripted([() => message([text(t)])]);
const GOOD = { description: "Soft light on a still heron.", tags: ["Blue", "heron"], collection: "Herons", altText: "A heron at dusk." };

describe("POST /assistant/draft", () => {
  it("passes a 401 through", async () => {
    const s = studio({ signedIn: false });
    const out = await post(makeHandler(() => reply("{}").model), env(s), { artworkId: ID });
    expect(out).toEqual({ status: 401, body: { error: { code: "unauthorized", message: "Sign in" } } });
  });

  it("needs a cover", async () => {
    const s = studio({ cover: false });
    const out = await post(makeHandler(() => reply("{}").model), env(s), { artworkId: ID });
    expect(out.status).toBe(400);
    expect(out.body.error.message).toBe("Add a cover picture first");
  });

  it("writes prepared words with no model call and no usage", async () => {
    const s = studio();
    const m = scripted([]);
    const out = await post(makeHandler(() => m.model), env(s, { ANTHROPIC_API_KEY: undefined }), {
      artworkId: ID, prepared: { description: "Hello", tags: ["A", "b"], collection: "Herons", altText: "alt" },
    });
    expect(out.status).toBe(200);
    expect(m.requests).toHaveLength(0);
    expect(s.drafts()).toHaveLength(1);
    expect(s.drafts()[0]!.body).toEqual({ description: "Hello", tags: ["a", "b"], collection: "Herons", altText: "alt" });
    expect(s.drafts()[0]!.headers.get("x-studio-assistant")).toBe("k");
    expect(s.drafts()[0]!.headers.get("cookie")).toBe("sid=1");
  });

  it("rejects prepared words over the limits", async () => {
    const s = studio();
    const m = scripted([]);
    const h = makeHandler(() => m.model);
    expect((await post(h, env(s), { artworkId: ID, prepared: { description: "x".repeat(5001) } })).status).toBe(400);
    expect((await post(h, env(s), { artworkId: ID, prepared: { tags: Array(13).fill("a") } })).status).toBe(400);
    expect((await post(h, env(s), { artworkId: ID, prepared: { tags: ["x".repeat(41)] } })).status).toBe(400);
    expect(s.drafts()).toHaveLength(0);
  });

  it("503 when there is no key and nothing prepared", async () => {
    const s = studio();
    const out = await post(makeHandler(() => reply("{}").model), env(s, { ANTHROPIC_API_KEY: undefined }), { artworkId: ID });
    expect(out).toEqual({ status: 503, body: { error: { code: "unavailable", message: "The assistant isn't set up here" } } });
  });

  it("looks at the picture, sends the collections, and writes the parsed words with usage", async () => {
    const s = studio({ voice: "Quiet, wet-edged mornings." });
    const m = scripted([() => ({ ...(message([text(JSON.stringify(GOOD))]) as object), usage: { input_tokens: 1500, output_tokens: 120 } } as any)]);
    const out = await post(makeHandler(() => m.model), env(s), { artworkId: ID });
    expect(out).toEqual({ status: 202, body: { status: "drafting" } });
    const req = m.requests[0]!;
    expect(req).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 700 });
    const content = req.messages[0]!.content as any[];
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/webp", data: B64 } });
    expect(content[1].text).toContain("Heron at dusk");
    const system = req.system as string;
    expect(system).toContain('["Herons","Marsh"]');
    expect(system).toContain("Quiet, wet-edged mornings.");
    expect(system).toMatch(/style sample/);
    expect(system).toMatch(/Never state or guess size, medium, materials, price, year, title, provenance or the artist's intent/);
    expect(s.calls.some((c) => c.url === `/v1/files/${COVER}/download-url?width=960`)).toBe(true);
    expect(s.drafts()[0]!.body).toEqual({
      description: GOOD.description, tags: ["blue", "heron"], collection: "Herons", altText: GOOD.altText,
      usage: { model: "claude-haiku-5-5", inputTokens: 1500, outputTokens: 120 },
    });
  });

  it("falls back to 480 when there is no 960", async () => {
    const s = studio({ no960: true });
    const m = reply(JSON.stringify(GOOD));
    await post(makeHandler(() => m.model), env(s), { artworkId: ID });
    expect(s.calls.some((c) => c.url.endsWith("width=480"))).toBe(true);
    expect(s.drafts()).toHaveLength(1);
  });

  it("parses a fenced or chatty reply", async () => {
    for (const t of ["```json\n" + JSON.stringify(GOOD) + "\n```", "Sure! Here you go: " + JSON.stringify(GOOD) + " Hope that helps."]) {
      const s = studio();
      await post(makeHandler(() => reply(t).model), env(s), { artworkId: ID });
      expect(s.drafts()[0]!.body.description).toBe(GOOD.description);
    }
  });

  it("drops an invented collection; lower-cases and caps tags at 12", async () => {
    const s = studio();
    const tags = Array.from({ length: 15 }, (_, i) => `Tag${i}`);
    await post(makeHandler(() => reply(JSON.stringify({ ...GOOD, collection: "Invented", tags })).model), env(s), { artworkId: ID });
    const b = s.drafts()[0]!.body;
    expect(b.collection).toBeUndefined();
    expect(b.tags).toHaveLength(12);
    expect(b.tags[0]).toBe("tag0");
  });

  it("writes nothing when the model fails or replies without JSON", async () => {
    const err = (await import("vitest")).vi.spyOn(console, "error").mockImplementation(() => {});
    const s = studio();
    const bad = async () => { throw new Error("overloaded"); };
    expect((await post(makeHandler(() => bad as never), env(s), { artworkId: ID })).status).toBe(202);
    await post(makeHandler(() => reply("I cannot.").model), env(s), { artworkId: ID });
    expect(s.drafts()).toHaveLength(0);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
