// studio-assistant (Phase 3): POST /assistant/chat streams one turn as
// server-sent events. Reaches studio-api only through its service binding,
// as the signed-in person (D-046); never touches the database.
import type { Env } from "./env";
import { type Model, anthropicModel, modelSettings } from "./model";
import { StudioError, studioFor } from "./studio";
import { type TurnEvent, type TurnInput, runTurn } from "./turn";

interface ChatBody { threadId?: unknown; fresh?: unknown; message?: unknown; app?: unknown; today?: unknown; page?: unknown; record?: unknown; images?: unknown; appMap?: unknown; appData?: unknown; commands?: unknown }

/** Pictures the app attaches to one message (D-071): the app shrinks them first. */
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const MAX_IMAGES = 3;
/** Base64 characters per picture: about 1.5 MB, well under the model's 5 MB. */
const MAX_IMAGE_CHARS = 2_000_000;

function parseImages(raw: unknown): TurnInput["images"] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_IMAGES) return `Attach up to ${MAX_IMAGES} pictures`;
  const out: NonNullable<TurnInput["images"]> = [];
  for (const i of raw as { mediaType?: unknown; data?: unknown }[]) {
    const type = IMAGE_TYPES.find((t) => t === i?.mediaType);
    if (!type) return "A picture must be a JPEG, PNG, WebP or GIF";
    if (typeof i.data !== "string" || !i.data || i.data.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/]+=*$/.test(i.data)) {
      return "A picture is too large or not base64; send it smaller";
    }
    out.push({ mediaType: type, data: i.data });
  }
  return out;
}

const json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

function parse(body: ChatBody): TurnInput | string {
  const images = parseImages(body.images);
  if (typeof images === "string") return images;
  let message = typeof body.message === "string" ? body.message.trim() : "";
  // A picture on its own is a message too.
  if (!message && images?.length) message = images.length > 1 ? "(pictures attached)" : "(picture attached)";
  if (!message || message.length > 4000) return "Send a message of 1 to 4000 characters";
  const app = typeof body.app === "string" && /^[a-z0-9-]{1,40}$/.test(body.app) ? body.app : "studio";
  const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  const page = typeof body.page === "string" ? body.page.slice(0, 80) : undefined;
  const r = body.record as { type?: unknown; id?: unknown; label?: unknown; note?: unknown } | undefined;
  const record = r && typeof r.type === "string" && typeof r.id === "string" && typeof r.label === "string"
    ? { type: r.type.slice(0, 30), id: r.id.slice(0, 40), label: r.label.slice(0, 200), ...(typeof r.note === "string" && r.note ? { note: r.note.slice(0, 300) } : {}) } : undefined;
  // The app's own list of its tabs, bars and buttons (D-072): data, kept short.
  const appMap = typeof body.appMap === "string" && body.appMap.trim() ? body.appMap.slice(0, 15000) : undefined;
  const appData = typeof body.appData === "string" && body.appData.trim() ? body.appData.slice(0, 20000) : undefined;
  const threadId = typeof body.threadId === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(body.threadId) ? body.threadId : undefined;
  // What the app runs on the device when asked (D-075); only names it knows.
  const commands = Array.isArray(body.commands) ? body.commands.filter((c): c is string => c === "open") : undefined;
  return { app, message, today, page, record, fresh: body.fresh === true, threadId, images, appMap, appData, ...(commands?.length ? { commands } : {}) };
}

/** Builds the Worker; tests pass their own model. */
export function makeHandler(modelFor: (env: Env) => Model = anthropicModel) {
  return {
    async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname !== "/assistant/chat") return json(404, "not_found", "No such route");
      if (req.method !== "POST") return json(405, "bad_request", "POST a message");
      const input = parse((await req.json().catch(() => ({}))) as ChatBody);
      if (typeof input === "string") return json(400, "bad_request", input);
      const studio = studioFor(env, req.headers.get("cookie") ?? "");
      // Check sign-in before opening the stream, so the app gets a plain 401.
      try { await studio.thread(); } catch (err) {
        if (err instanceof StudioError) return json(err.status, err.code, err.message);
        throw err;
      }

      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const enc = new TextEncoder();
      const send = (e: TurnEvent) => { void writer.write(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)); };
      ctx.waitUntil((async () => {
        try {
          await runTurn({ studio, model: modelFor(env), settings: modelSettings(env) }, input, send);
        } catch (err) {
          console.error("assistant turn failed", err);
        } finally {
          await writer.close().catch(() => {});
        }
      })());
      return new Response(readable, {
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
      });
    },
  };
}

export default makeHandler() satisfies ExportedHandler<Env>;
