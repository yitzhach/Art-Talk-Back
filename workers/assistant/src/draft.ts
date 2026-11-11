// The draft job (Site 3.0, stage 1): given a work, look at its cover and draft
// the words, then write them through studio-api's POST /v1/artworks/{id}/draft.
// Same rules as chat: studio-api only through the binding, as the signed-in
// person, with the assistant's key (D-046). One try, no retry loop.
import type { Env } from "./env";
import type { Model } from "./model";
import { StudioError } from "./studio";

export interface Words { description?: string | undefined; tags?: string[] | undefined; collection?: string | undefined; altText?: string | undefined }
export interface Usage { model: string; inputTokens: number; outputTokens: number }

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const MAX_ORIGINAL_BYTES = 4_000_000;
const ORIGINAL_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const json = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

export const DRAFT_PROMPT = (collections: string[], voice?: string) => [
  "You are drafting catalogue words for an artist's work, in the studio's voice.",
  voice ? `Here is a writing sample in the studio's voice. It is a style sample only, not facts about this work:\n<style_sample>\n${voice}\n</style_sample>` : "",
  "Describe only what is visible in the picture. Never state or guess size, medium, materials, price, year, title, provenance or the artist's intent. Facts you are given about the work are context the description may lean on; never restate numbers.",
  `Output ONLY a JSON object, no other text: {"description": string (2 to 4 sentences, at most 600 characters), "tags": string[] (at most 12, lower case, single words or short phrases: colours, forms, mood, texture), "collection": ${collections.length ? `one of ${JSON.stringify(collections)} or null` : "null"}, "altText": string (at most 200 characters, a plain description for screen readers)}.`,
].filter(Boolean).join("\n\n");

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t && t.length <= max ? t : undefined;
};

/** Checks drafted words against the limits; undefined fields are left out. Returns a message when something is over its limit. */
export function checkWords(raw: Record<string, unknown>, strict: boolean, collections?: string[]): Words | string {
  const out: Words = {};
  const fail = (m: string) => { if (strict) throw new Error(m); };
  try {
    if (raw.description !== undefined) { out.description = text(raw.description, 5000); if (!out.description) fail("description must be 1 to 5000 characters"); }
    if (raw.altText !== undefined) { out.altText = text(raw.altText, 500); if (!out.altText) fail("altText must be 1 to 500 characters"); }
    if (raw.collection !== undefined && raw.collection !== null) {
      out.collection = text(raw.collection, 80);
      if (!out.collection) fail("collection must be 1 to 80 characters");
      if (out.collection && collections && !collections.includes(out.collection)) delete out.collection;
    }
    if (raw.tags !== undefined) {
      if (!Array.isArray(raw.tags)) { fail("tags must be a list"); } else {
        if (strict && raw.tags.length > 12) fail("up to 12 tags");
        const tags = raw.tags.map((t) => (typeof t === "string" ? t.trim().toLowerCase() : "")).filter((t) => t);
        if (strict && tags.some((t) => t.length > 40)) fail("a tag is up to 40 characters");
        out.tags = [...new Set(tags.filter((t) => t.length <= 40))].slice(0, 12);
      }
    }
  } catch (e) { return (e as Error).message; }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Words;
}

/** The first {...} in a reply, tolerating code fences and chatter. */
export function parseWords(reply: string): Record<string, unknown> | null {
  const unfenced = reply.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(unfenced.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch { return null; }
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

interface ArtworkView { id: string; title?: string; medium?: string; year?: number | null; width?: number | null; height?: number | null; sizeUnit?: string; primaryFileId?: string | null;
  images?: { id: string; contentType?: string | null; size?: number }[] }

export function makeDraftHandler(modelFor: (env: Env) => Model) {
  return async function draft(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method !== "POST") return json(405, "bad_request", "POST an artworkId");
    const body = (await req.json().catch(() => ({}))) as { artworkId?: unknown; prepared?: unknown };
    if (typeof body.artworkId !== "string" || !ULID.test(body.artworkId)) return json(400, "bad_request", "Send an artworkId");
    const id = body.artworkId;
    let prepared: Words | undefined;
    if (body.prepared !== undefined) {
      if (!body.prepared || typeof body.prepared !== "object" || Array.isArray(body.prepared)) return json(400, "bad_request", "prepared must be an object");
      const checked = checkWords(body.prepared as Record<string, unknown>, true);
      if (typeof checked === "string") return json(400, "bad_request", checked);
      prepared = checked;
    }

    const cookie = req.headers.get("cookie") ?? "";
    const studioFetch = (url: string, method = "GET", payload?: unknown) => env.STUDIO_API.fetch(url, {
      method, headers: { cookie, "x-studio-assistant": env.ASSISTANT_KEY ?? "", ...(payload !== undefined ? { "content-type": "application/json" } : {}) },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
    async function call<T>(method: string, path: string, payload?: unknown): Promise<T> {
      const res = await studioFetch(`https://studio-api/v1${path}`, method, payload);
      const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
      if (!res.ok) throw new StudioError(res.status, data?.error?.code ?? "internal", data?.error?.message ?? res.statusText, data?.error?.details);
      return data as T;
    }

    let artwork: ArtworkView;
    try { artwork = await call<ArtworkView>("GET", `/artworks/${id}`); } catch (err) {
      if (err instanceof StudioError) return json(err.status, err.code, err.message);
      throw err;
    }
    const cover = artwork.primaryFileId ? artwork.images?.find((i) => i.id === artwork.primaryFileId) : undefined;
    if (!cover) return json(400, "bad_request", "Add a cover picture first");

    if (prepared) {
      try {
        return Response.json(await call("POST", `/artworks/${id}/draft`, prepared));
      } catch (err) {
        if (err instanceof StudioError) return json(err.status, err.code, err.message);
        throw err;
      }
    }
    if (!env.ANTHROPIC_API_KEY) return json(503, "unavailable", "The assistant isn't set up here");

    ctx.waitUntil((async () => {
      try {
        const picture = await fetchPicture(cover);
        const [collectionsRes, settings] = await Promise.all([
          call<{ items?: unknown[] } | unknown[]>("GET", "/artworks/collections"),
          call<{ meta?: { voice?: unknown } }>("GET", "/settings").catch(() => ({} as { meta?: { voice?: unknown } })),
        ]);
        const list = Array.isArray(collectionsRes) ? collectionsRes : collectionsRes.items ?? [];
        const collections = list.map((c) => typeof c === "string" ? c : (c as { name?: unknown })?.name).filter((c): c is string => typeof c === "string" && !!c);
        const voice = typeof settings.meta?.voice === "string" && settings.meta.voice.trim() ? settings.meta.voice.trim().slice(0, 3000) : undefined;
        const facts = [
          artwork.title && `title: ${artwork.title}`, artwork.medium && `medium: ${artwork.medium}`, artwork.year && `year: ${artwork.year}`,
          artwork.width && artwork.height && `size: ${artwork.width} x ${artwork.height} ${artwork.sizeUnit ?? "in"}`,
        ].filter(Boolean).join("; ");
        const model = env.DRAFT_MODEL || "claude-haiku-5-5";
        const msg = await modelFor(env)({
          model, max_tokens: 700, system: DRAFT_PROMPT(collections, voice),
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: picture.mediaType, data: picture.data } },
            { type: "text", text: `Draft the words for this work.${facts ? ` Known facts, as context only: ${facts}.` : ""}` },
          ] }],
        }, () => {});
        const reply = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        const raw = parseWords(reply);
        if (!raw) throw new Error("The model's reply had no JSON object");
        const words = checkWords(raw, false, collections);
        if (typeof words === "string" || !Object.keys(words).length) throw new Error("The model's words were not usable");
        await call("POST", `/artworks/${id}/draft`, {
          ...words, usage: { model, inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0 },
        });
      } catch (err) {
        console.error("assistant draft failed", err);
      }
    })());
    return Response.json({ status: "drafting" }, { status: 202 });

    /** The cover at 960 px, else 480, else the original if it is small enough and a common type. */
    async function fetchPicture(file: { id: string; contentType?: string | null; size?: number }): Promise<{ mediaType: "image/webp" | "image/jpeg" | "image/png"; data: string }> {
      const tries: (number | undefined)[] = [960, 480];
      if (file.contentType && (ORIGINAL_TYPES as readonly string[]).includes(file.contentType) && (file.size ?? 0) <= MAX_ORIGINAL_BYTES) tries.push(undefined);
      for (const width of tries) {
        const link = await studioFetch(`https://studio-api/v1/files/${file.id}/download-url${width ? `?width=${width}` : ""}`);
        if (!link.ok) continue;
        const { url } = (await link.json()) as { url: string };
        const res = await env.STUDIO_API.fetch(new URL(url, "https://studio-api").toString());
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!width && bytes.length > MAX_ORIGINAL_BYTES) continue;
        return { mediaType: width ? "image/webp" : (file.contentType as "image/jpeg"), data: bytesToBase64(bytes) };
      }
      throw new Error("No usable picture of the cover");
    }
  };
}
