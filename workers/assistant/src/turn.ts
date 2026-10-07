// One turn of the conversation: the artist's message in, a streamed reply and
// any cards out. A manual tool loop over studio-api: search reads, every other
// tool goes to POST /assistant/act, where studio-api runs it or turns it into a
// confirm card (D-045). The thread is append-only: this turn's messages are
// added at the end, exactly as sent and received (D-053).
import type Anthropic from "@anthropic-ai/sdk";
import { contextLine, systemFor } from "./prompt";
import type { Model, ModelRequest } from "./model";
import { type CardState, type Studio, StudioError, type Tool } from "./studio";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/** What the panel shows as the turn happens. */
export type TurnEvent =
  | { type: "text"; text: string }
  | { type: "search"; q: string; items: { type: string; id: string; label: string; detail: string }[] }
  | { type: "card"; proposal: Record<string, unknown> }
  | { type: "replies"; items: string[] }
  | { type: "done"; action: string; record: Record<string, unknown>; activityIds: string[] }
  /** The app shows a place on screen (D-075): a tab, section or control from its map. Nothing changes. */
  | { type: "open"; place: string; control?: string }
  | { type: "end"; reason: "end_turn" | "refusal" | "max_tokens" | "step_limit" | "error"; message?: string };

export interface TurnInput {
  app: string;
  message: string;
  today: string; // YYYY-MM-DD in the artist's time zone
  page?: string | undefined;
  record?: { type: string; id: string; label: string; note?: string } | undefined;
  /** The artist tapped New conversation: start an empty thread. */
  fresh?: boolean | undefined;
  /** Continue this past conversation (from the panel's Past chats). */
  threadId?: string | undefined;
  /** Pictures attached to this message (D-071): the model sees them; the thread keeps a note. */
  images?: { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string }[] | undefined;
  /** The app's map of its own screens, "where: names" per line (D-072); goes in the system prompt, so it caches. */
  appMap?: string | undefined;
  /** What the app can do on the device when asked (D-075); "open" shows a place from its map. */
  commands?: string[] | undefined;
}

/**
 * Not a studio tool: the app runs it on the device (D-075). It only shows a
 * place, so nothing goes to studio-api and there is no card.
 */
export const OPEN_TOOL: Anthropic.Beta.Messages.BetaTool = {
  name: "open_in_app",
  description: "Show the artist a place in the app on their screen: open its tab, scroll to the section and highlight the control, without pressing anything or changing the booth. Use it when they ask to be taken to, shown or given a tool (\"take me to lighting\", \"open the layout tab\", \"where's Add man?\"), then say what to tap. place and control are copied exactly from the app's map.",
  input_schema: {
    type: "object",
    properties: {
      place: { type: "string", description: "The part before the colon in the map, e.g. \"Layout · People for scale\"", maxLength: 200 },
      control: { type: "string", description: "Optional: one of the names listed after it, e.g. \"Add man\"", maxLength: 200 },
    },
    required: ["place"],
    additionalProperties: false,
  },
};

/**
 * What the stored thread keeps in place of a picture (D-071): a picture in
 * every later request would cost its tokens each turn and could outgrow a
 * stored row, so later turns have this note and the reply that read it.
 */
export const PICTURE_NOTE = (mediaType: string) =>
  `[The artist attached a picture here (${mediaType}). Pictures aren't kept: later turns see only this note and what you said about it.]`;

/** Each action tool also takes the line for its confirm card; studio-api never sees it in the input. */
const CARD_FIELD = "card_summary";
/** Tool calls per turn before the assistant stops and says so. */
const MAX_STEPS = 8;

/**
 * The artist answers cards by tapping, outside the conversation, so each turn
 * says how the newest cards ended. Without it the model claimed a confirmed
 * sale was "not saved yet" (staging, 2026-10-05).
 */
export function cardOutcomes(cards: CardState[], now = new Date().toISOString()): string[] {
  return cards.slice(0, 5).map((c) => {
    const state = c.status === "confirmed" ? "confirmed by the artist and saved then (it may since have been changed or deleted: search before relying on it)"
      : c.status === "cancelled" ? "cancelled, nothing saved"
      : c.expiresAt < now ? "expired, nothing saved" : "waiting for the artist's tap, nothing saved yet";
    return `card ${c.id} "${c.summary.slice(0, 120)}": ${state}`;
  });
}

const REPLIES = /^\[\[replies:([^\]]*)\]\]$/;

/**
 * Streams the model's text through, but holds back a closing
 * "[[replies: Yes | No]]" line (the panel shows those as buttons). Anything
 * held that turns out not to be that line is sent at the end, unchanged.
 */
export function replySplitter(send: (text: string) => void) {
  let held = "";
  return {
    push(delta: string) {
      held += delta;
      const at = held.indexOf("[[");
      // A lone "[" at the end may be the start of "[[": keep it back too.
      const cut = at >= 0 ? at : held.endsWith("[") ? held.length - 1 : held.length;
      if (cut > 0) { send(held.slice(0, cut)); held = held.slice(cut); }
    },
    end(): string[] {
      const rest = held;
      held = "";
      const m = REPLIES.exec(rest.trim());
      if (!m) { if (rest) send(rest); return []; }
      return m[1]!.split("|").map((r) => r.trim().slice(0, 60)).filter(Boolean).slice(0, 4);
    },
  };
}

export function modelTools(tools: Tool[]): Anthropic.Beta.Messages.BetaTool[] {
  return tools.map((t) => {
    const schema = structuredClone(t.inputSchema) as { properties?: Record<string, unknown>; required?: string[] };
    if (t.action) {
      schema.properties = { ...(schema.properties ?? {}), [CARD_FIELD]: {
        type: "string", description: "One short line for the artist's confirm card, e.g. \"2 small heron prints, $90 each, cash, Winter Park\"",
      } };
      schema.required = [...(schema.required ?? []), CARD_FIELD];
    }
    return { name: t.name, description: t.description, input_schema: schema as Anthropic.Beta.Messages.BetaTool.InputSchema };
  });
}

export async function runTurn(
  deps: { studio: Studio; model: Model; settings: Partial<ModelRequest> },
  input: TurnInput,
  emit: (e: TurnEvent) => void,
): Promise<void> {
  const { studio, model } = deps;
  const [tools, thread, cards] = await Promise.all([studio.tools(input.app), studio.thread(input.fresh, input.threadId), studio.cards()]);
  const byName = new Map(tools.map((t) => [t.name, t]));
  // Exactly the role and content that were stored: nothing added, nothing edited.
  const history = thread.messages.map(({ role, content }) => ({ role, content }) as MessageParam);
  const said = { type: "text" as const, text: `${contextLine({ ...input, cards: cardOutcomes(cards) })}\n\n${input.message}` };
  const images = input.images ?? [];
  const turn: MessageParam[] = [{
    role: "user",
    content: [...images.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mediaType, data: i.data } })), said],
  }];

  let end: TurnEvent = { type: "end", reason: "step_limit" };
  // Text from separate model calls in one turn: keep the sentences apart.
  let wrote = false, gap = false;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const replies = replySplitter((text) => {
        if (gap && !/^\s/.test(text)) text = ` ${text}`;
        gap = false;
        wrote = true;
        emit({ type: "text", text });
      });
      const msg = await model({
        ...deps.settings,
        model: deps.settings.model ?? "claude-sonnet-5-5",
        max_tokens: 16000,
        system: systemFor(deps.settings.model ?? "claude-sonnet-5-5", input.app, input.appMap),
        tools: input.commands?.includes("open") ? [...modelTools(tools), OPEN_TOOL] : modelTools(tools),
        // Caches the stable prefix (tools, system, earlier turns) across the loop.
        cache_control: { type: "ephemeral" },
        messages: [...history, ...turn],
      }, (text) => replies.push(text));
      const suggested = replies.end();
      gap = wrote;
      if (suggested.length) emit({ type: "replies", items: suggested });
      turn.push({ role: "assistant", content: msg.content as MessageParam["content"] });

      const uses = msg.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
      if (msg.stop_reason === "refusal") { end = { type: "end", reason: "refusal" }; break; }
      if (msg.stop_reason === "pause_turn") continue;
      if (!uses.length) { end = { type: "end", reason: msg.stop_reason === "max_tokens" ? "max_tokens" : "end_turn" }; break; }

      const results: ToolResult[] = [];
      let cards = 0;
      for (const use of uses) {
        // A tool call cut off at max_tokens may parse as a smaller valid object: never run it.
        if (msg.stop_reason === "max_tokens") {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "Cut off before the input was complete; not run." });
          continue;
        }
        const ran = use.name === OPEN_TOOL.name && input.commands?.includes("open")
          ? { result: openInApp(use, emit) }
          : await runTool(studio, byName.get(use.name), use, emit);
        if (ran.card) cards++;
        results.push(ran.result);
      }
      turn.push({ role: "user", content: results });
      if (msg.stop_reason === "max_tokens") { end = { type: "end", reason: "max_tokens" }; break; }
      // Every call left a confirm card: the card says what it does, so the turn ends here
      // instead of paying for another model call to describe it (D-059).
      if (cards === uses.length) { end = { type: "end", reason: "end_turn" }; break; }
    }
  } catch (err) {
    // Nothing from a failed turn is kept, so the stored thread never ends on an unanswered tool call.
    emit({ type: "end", reason: "error", message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  // The thread keeps a note where each picture was, never the picture (D-071).
  const stored = images.length
    ? [{ role: "user" as const, content: [...images.map((i) => ({ type: "text" as const, text: PICTURE_NOTE(i.mediaType) })), said] }, ...turn.slice(1)]
    : turn;
  await studio.append(thread.threadId, input.app, stored as { role: "user" | "assistant"; content: unknown }[]);
  emit(end);
}

function openInApp(use: Anthropic.Beta.Messages.BetaToolUseBlock, emit: (e: TurnEvent) => void): ToolResult {
  const input = (use.input ?? {}) as Record<string, unknown>;
  const place = typeof input.place === "string" ? input.place.trim().slice(0, 200) : "";
  if (!place) return result(use, "Give the place, copied from the app's map.", true);
  const control = typeof input.control === "string" && input.control.trim() ? input.control.trim().slice(0, 200) : undefined;
  emit({ type: "open", place, ...(control ? { control } : {}) });
  return result(use, "The app is showing it on the artist's screen. Nothing was changed: tell them what to tap there.");
}

const result = (use: { id: string }, content: unknown, isError = false): ToolResult => ({
  type: "tool_result", tool_use_id: use.id, content: typeof content === "string" ? content : JSON.stringify(content),
  ...(isError ? { is_error: true } : {}),
});

async function runTool(studio: Studio, tool: Tool | undefined, use: Anthropic.Beta.Messages.BetaToolUseBlock, emit: (e: TurnEvent) => void): Promise<{ result: ToolResult; card?: true }> {
  const input = (use.input ?? {}) as Record<string, unknown>;
  if (!tool) return { result: result(use, `There is no tool named ${use.name}.`, true) };
  try {
    if (!tool.action && tool.read) {
      // `{name}` from the input, each part escaped; the rest of the input goes as the query.
      let missing = "";
      const used = new Set<string>();
      const path = tool.read.path.replace(/\{(\w+)\}/g, (_m, k: string) => {
        used.add(k);
        const v = input[k];
        if (typeof v !== "string" || !v) missing = k;
        return encodeURIComponent(String(v ?? ""));
      });
      if (missing) return { result: result(use, `${tool.name} needs ${missing}.`, true) };
      const query = Object.entries(input).filter(([k, v]) => !used.has(k) && v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
      return { result: result(use, await studio.read(query ? `${path}?${query}` : path)) };
    }
    if (!tool.action) {
      const q = String(input.q ?? "").trim();
      if (!q) return { result: result(use, "Give search some words to look for (q).", true) };
      const types = Array.isArray(input.types) ? input.types.map(String) : undefined;
      const items = await studio.search(q, types);
      emit({ type: "search", q, items: items.map(({ type, id, label, detail }) => ({ type, id, label, detail })) });
      return { result: result(use, items.length ? { items } : `Nothing in the studio matches "${q}".`) };
    }
    const { [CARD_FIELD]: summary, ...actionInput } = input;
    const out = await studio.act(tool.action, actionInput, String(summary || tool.description).slice(0, 300));
    if (out.status === "done") {
      emit({ type: "done", action: tool.action, record: out.result, activityIds: out.activityIds });
      return { result: result(use, { saved: true, record: out.result }) };
    }
    emit({ type: "card", proposal: out.proposal });
    return { card: true, result: result(use, {
      saved: false, card: out.proposal.id, card_lines: out.proposal.details,
      note: "A confirm card is on the artist's screen. Nothing is saved until they tap Confirm.",
    }) };
  } catch (err) {
    if (err instanceof StudioError && err.status < 500) {
      return { result: result(use, { error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) }, true) };
    }
    throw err;
  }
}
