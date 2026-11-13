// The visitor assistant (Site 3.0 stage 3, D-125…D-136): POST /assistant/visitor answers one question from a visitor
// on a studio's public site. The site's Worker sets the studio (x-studio-slug) and the visitor (x-visitor-key); this
// Worker reaches studio-api's public visitor routes only, with its key, never an owner session or tool (D-135).
// One turn: studio-api says whether a turn is allowed (limits, budget) → the model answers from the studio's words,
// the catalogue digest and get_work → the reply is checked (prices, titles, cards) → recorded with its cost → JSON.
import type Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";
import type { Model, ModelRequest } from "./model";
import {
  type DigestWork, LIMITED_TEXT, SITE_LABELS, type StudioWords, VISITOR_SYSTEM, priceLine, sizeLine, studioBlock, visitorContext,
} from "./visitor-prompt";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolUse = Anthropic.Beta.Messages.BetaToolUseBlock;

export const VISITOR_MODEL = "claude-haiku-5-5";
const MAX_STEPS = 3;
const MAX_MESSAGE = 1000;
const MAX_CARDS = 6;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface VisitorReply {
  threadId: string | null;
  text: string;
  works: DigestWork[];
  replies: string[];
  askArtist: boolean;
  limited: null | "off" | "budget" | "daily" | "burst";
}

export const GET_WORK_TOOL: Anthropic.Beta.Messages.BetaTool = {
  name: "get_work",
  description: "One work's full public record: description, medium, size, year, edition, status and price as listed. Use it when the visitor asks about a piece's details beyond its catalogue line. Only slugs from the catalogue.",
  input_schema: {
    type: "object",
    properties: { slug: { type: "string", description: "The work's slug, exactly as in the catalogue" } },
    required: ["slug"],
    additionalProperties: false,
  },
};

// ------------------------------------------------------------------ studio-api, as the visitor assistant sees it

export class VisitorApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export interface VisitorApi {
  words(): Promise<StudioWords>;
  digest(): Promise<{ works: DigestWork[]; catalogueVersion: number }>;
  work(slug: string): Promise<Record<string, unknown> | null>;
  start(fresh: boolean): Promise<{ allowed: true; threadId: string; history: { role: "user" | "assistant"; text: string; works: string[] }[] } | { allowed: false; reason: VisitorReply["limited"] & string }>;
  record(turn: Record<string, unknown>): Promise<{ capped: boolean }>;
  /** Tell the studio an answer didn't come through (its daily error email, D-178). */
  failed?(): Promise<void>;
}

export function visitorApi(env: Env, slug: string, visitorKey: string, ip: string | null): VisitorApi {
  const base = `https://studio-api/v1/public/studios/${encodeURIComponent(slug)}`;
  async function call<T>(method: string, path: string, json?: unknown): Promise<T> {
    const headers: Record<string, string> = { "x-visitor-key": visitorKey, "x-studio-assistant": env.ASSISTANT_KEY ?? "" };
    if (json !== undefined) headers["content-type"] = "application/json";
    const res = await env.STUDIO_API.fetch(base + path, { method, headers, ...(json !== undefined ? { body: JSON.stringify(json) } : {}) });
    const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    if (!res.ok) throw new VisitorApiError(res.status, data?.error?.code ?? "internal", data?.error?.message ?? res.statusText);
    return data as T;
  }
  return {
    words: () => call("GET", "/assistant"),
    digest: () => call("GET", "/digest"),
    work: async (s) => {
      try { return await call("GET", `/artworks/${encodeURIComponent(s)}`); } catch (e) {
        if (e instanceof VisitorApiError && e.status === 404) return null;
        throw e;
      }
    },
    start: (fresh) => call("POST", "/visitor/turn-start", { fresh, ...(ip ? { ip } : {}) }),
    record: (turn) => call("POST", "/visitor/turn", { ...turn, ...(ip ? { ip } : {}) }),
    failed: async () => {
      const res = await env.STUDIO_API.fetch(base + "/visitor/turn-failed", { method: "POST", headers: { "x-studio-assistant": env.ASSISTANT_KEY ?? "" } });
      await res.body?.cancel();
    },
  };
}

/** The digest, kept per isolate while the catalogue version stands. */
const digests = new Map<string, { version: number; works: DigestWork[] }>();

// ------------------------------------------------------------------ the check (D-132, D-135)

const MARKER = /\[\[\s*(works|replies|ask_artist)\s*:?([^\]]*)\]\]/gi;

/** Splits the model's control lines from its words. */
export function readMarkers(raw: string) {
  let works: string[] = [], replies: string[] = [], askArtist = false;
  const text = raw.replace(MARKER, (_m, kind: string, rest: string) => {
    const items = rest.split("|").map((x) => x.trim()).filter(Boolean);
    if (kind.toLowerCase() === "works") works = [...works, ...items];
    else if (kind.toLowerCase() === "replies") replies = items.map((r) => r.slice(0, 60)).slice(0, 3);
    else askArtist = true;
    return "";
  }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, works, replies, askArtist };
}

const AMOUNT = /(?:US)?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(\s?[kK]\b)?/g;
const toCents = (whole: string, frac: string | undefined, k: string | undefined) =>
  Math.round((Number(whole.replace(/,/g, "")) * (k ? 1000 : 1)) * 100 + (frac ? Number(frac) : 0));
const amountsIn = (s: string) => [...s.matchAll(AMOUNT)].map((m) => toCents(m[1]!, m[2], m[3]));
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

export interface Checked { text: string; works: DigestWork[]; fixed: number; inventedTitles: string[] }

/**
 * Before the visitor sees a reply: every dollar amount must be a price the catalogue lists (and, in a sentence about
 * one piece, that piece's own price), or an amount in the studio's own answers or the visitor's message; anything else
 * becomes "price on request". Cards are only real public works, by slug. A quoted title that isn't a work is flagged.
 */
export function checkReply(raw: { text: string; works: string[] }, catalogue: DigestWork[], allowedText: string): Checked {
  const bySlug = new Map(catalogue.map((w) => [w.slug, w]));
  const listed = new Set(catalogue.filter((w) => w.status === "available" && w.priceCents !== null).map((w) => w.priceCents!));
  const free = new Set(amountsIn(allowedText));
  const titled = catalogue.map((w) => ({ w, t: norm(w.title) })).filter((x) => x.t.length >= 3).sort((a, b) => b.t.length - a.t.length);
  let fixed = 0;

  const sentences = raw.text.split(/(?<=[.!?])\s+/);
  const text = sentences.map((sentence) => {
    const n = ` ${norm(sentence)} `;
    const about = titled.filter((x) => n.includes(` ${x.t} `)).map((x) => x.w);
    const one = about.length === 1 ? about[0]! : null;
    return sentence.replace(AMOUNT, (m, whole: string, frac: string | undefined, k: string | undefined) => {
      const cents = toCents(whole, frac, k);
      if (free.has(cents)) return m;
      const ok = one ? one.status === "available" && one.priceCents === cents : listed.has(cents);
      if (ok) return m;
      fixed++;
      return "price on request";
    });
  }).join(" ");

  const works: DigestWork[] = [];
  for (const s of raw.works) {
    const slug = s.trim().toLowerCase();
    const w = SLUG.test(slug) ? bySlug.get(slug) : undefined;
    if (w && !works.includes(w)) works.push(w);
    else if (!w) fixed++;
    if (works.length >= MAX_CARDS) break;
  }

  const known = new Set(catalogue.map((w) => norm(w.title)));
  const allowed = norm(allowedText);
  const inventedTitles = [...text.matchAll(/[“"‘*_]([A-Z][^“”"’*_\n]{2,80})[”"’*_]/g)]
    .map((m) => m[1]!.trim())
    .filter((t) => !known.has(norm(t)) && !allowed.includes(norm(t)) && /^[A-Z]/.test(t) && t.split(/\s+/).length <= 8);
  fixed += inventedTitles.length;
  return { text: text.trim(), works, fixed, inventedTitles };
}

// ------------------------------------------------------------------ one turn

export interface VisitorTurnInput { message: string; fresh: boolean; piece: string | null; today: string; origin: string | null }

/** What one work's get_work answer tells the model: public fields only, price only as the visitor may hear it. */
function workForModel(w: Record<string, unknown>): Record<string, unknown> {
  const d = w as unknown as DigestWork & { description?: string | null; editionSize?: number | null };
  return {
    slug: d.slug, title: d.title, medium: d.medium, year: d.year, size: sizeLine(d), edition: d.editionSize ?? null,
    collection: d.collection, tags: d.tags, price: priceLine(d), description: d.description ?? null,
  };
}

export async function visitorTurn(deps: { api: VisitorApi; model: Model; settings: Partial<ModelRequest> }, input: VisitorTurnInput): Promise<VisitorReply> {
  const { api } = deps;
  const [words, start] = await Promise.all([api.words(), api.start(input.fresh)]);
  if (!start.allowed) {
    return { threadId: null, text: LIMITED_TEXT[start.reason](words.artistName), works: [], replies: [], askArtist: true, limited: start.reason };
  }
  const key = `${words.name}\n${words.catalogueVersion}`;
  let cached = digests.get(key);
  if (!cached) {
    const d = await api.digest();
    cached = { version: d.catalogueVersion, works: d.works };
    digests.clear();
    digests.set(key, cached);
  }
  const catalogue = cached.works;
  const piece = input.piece ? catalogue.find((w) => w.slug === input.piece) ?? null : null;

  const model = deps.settings.model ?? VISITOR_MODEL;
  const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [
    { type: "text", text: VISITOR_SYSTEM },
    // A breakpoint here: every visitor of this studio shares the rules, the studio's words and the catalogue.
    { type: "text", text: studioBlock(words, catalogue), cache_control: { type: "ephemeral" } },
  ];
  // The chat so far, as plain text: the cards shown are named so a follow-up ("the second one") makes sense.
  const history: MessageParam[] = start.history.map((m) => ({
    role: m.role,
    content: m.role === "assistant" && m.works.length ? `${m.text}\n[[works: ${m.works.join(" | ")}]]` : m.text || "(no text)",
  }));
  const turn: MessageParam[] = [{ role: "user", content: `${visitorContext(input.today, piece)}\n\n${input.message}` }];
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let final = "";
  let refused = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    const msg = await deps.model({
      ...deps.settings,
      model,
      max_tokens: 2000,
      system,
      tools: [GET_WORK_TOOL],
      cache_control: { type: "ephemeral" },
      messages: [...history, ...turn],
    }, () => {});
    usage.inputTokens += msg.usage.input_tokens ?? 0;
    usage.outputTokens += msg.usage.output_tokens ?? 0;
    usage.cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += msg.usage.cache_creation_input_tokens ?? 0;
    final = msg.content.filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
    if (msg.stop_reason === "refusal") { refused = true; break; }
    const uses = msg.content.filter((b): b is ToolUse => b.type === "tool_use");
    if (!uses.length || msg.stop_reason === "max_tokens") break;
    turn.push({ role: "assistant", content: msg.content as MessageParam["content"] });
    const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      const slug = String((use.input as { slug?: unknown })?.slug ?? "").trim().toLowerCase();
      const w = SLUG.test(slug) && catalogue.some((c) => c.slug === slug) ? await api.work(slug) : null;
      results.push({
        type: "tool_result", tool_use_id: use.id,
        content: w ? JSON.stringify(workForModel(w)) : `No work with slug "${slug.slice(0, 80)}" is in the catalogue.`,
        ...(w ? {} : { is_error: true }),
      });
    }
    turn.push({ role: "user", content: results });
    final = "";
  }

  const marked = readMarkers(refused || !final.trim()
    ? `I can't help with that one here. ${words.artistName === "the artist" ? "The artist" : words.artistName} can answer directly by text, email or call. [[ask_artist]]`
    : final);
  const allowed = [input.message, ...SITE_LABELS.map((l) => `“${l}”`), ...Object.values(words.answers), ...start.history.filter((m) => m.role === "user").map((m) => m.text)].join("\n");
  const checked = checkReply(marked, catalogue, allowed);
  // A price the check replaced is a question the artist should answer.
  const askArtist = marked.askArtist || checked.fixed > 0 && /price on request/.test(checked.text);
  const text = checked.text || "Here's what I found.";

  await api.record({
    threadId: start.threadId, user: input.message.slice(0, MAX_MESSAGE), reply: text.slice(0, 4000),
    works: checked.works.map((w) => w.slug), askArtist, fixed: Math.min(checked.fixed, 100), model, usage,
    ...(input.origin ? { origin: input.origin.slice(0, 200) } : {}),
  });
  return { threadId: start.threadId, text, works: checked.works, replies: marked.replies, askArtist, limited: null };
}

// ------------------------------------------------------------------ the route

const json = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });

/** POST /assistant/visitor. The site's Worker is the only caller that sets the headers (D-134). */
export async function handleVisitor(req: Request, env: Env, modelFor: (env: Env) => Model): Promise<Response> {
  if (req.method !== "POST") return json(405, "bad_request", "POST a message");
  const slug = req.headers.get("x-studio-slug") ?? "";
  const key = req.headers.get("x-visitor-key") ?? "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(slug)) return json(400, "bad_request", "This site isn't set up for the assistant.");
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(key)) return json(400, "bad_request", "Reload the page and try again.");
  const body = (await req.json().catch(() => null)) as { message?: unknown; fresh?: unknown; piece?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE) return json(400, "bad_request", `Ask in up to ${MAX_MESSAGE} characters.`);
  const piece = typeof body?.piece === "string" && SLUG.test(body.piece) ? body.piece : null;
  const ip = req.headers.get("x-visitor-ip");
  const api = visitorApi(env, slug, key, ip && ip.length <= 64 ? ip : null);
  const origin = req.headers.get("x-site-origin");
  try {
    const reply = await visitorTurn({ api, model: modelFor(env), settings: { model: env.VISITOR_MODEL || VISITOR_MODEL, output_config: { effort: "low" } } }, {
      message, fresh: body?.fresh === true, piece, today: new Date().toISOString().slice(0, 10),
      origin: origin && /^https?:\/\/[^\s/]+$/.test(origin) ? origin : null,
    });
    return Response.json(reply, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof VisitorApiError && e.status < 500) return json(e.status, e.code, e.message);
    console.error("visitor turn failed", e);
    await api.failed?.().catch((err) => console.error("reporting the failure failed", err));
    return json(502, "unavailable", "The assistant couldn't answer just now. Please try again, or text, email or call the studio.");
  }
}
