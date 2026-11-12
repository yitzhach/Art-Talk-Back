// Runs the visitor assistant's eval cases (Site 3.0 stage 3, gate items 1 and 2; D-132). Each case is ONE turn through
// `visitorTurn` with `visitorApi` against the in-process studio-api, as its own visitor (own key, own address). The
// model is the recorded replay or the real one. Graders: the gate's universal checks on every case, then the case's own.
import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import type { Server } from "../../../packages/sdk/test/server";
import type { Model, ModelRequest } from "../src/model";
import { type VisitorReply, checkReply, readMarkers, visitorApi, visitorTurn } from "../src/visitor";
import type { DigestWork } from "../src/visitor-prompt";
import { assistantEnv, message, scripted, text } from "../test/harness";
import type { Fixture } from "../test/visitor-fixture";

type Block = Anthropic.Beta.Messages.BetaContentBlock;
export interface Usage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
export interface VisitorCase {
  id: string; source: "coverage" | "isaac" | "isaac-slot"; topic: string; question: string;
  piece?: string; history?: { role: "user" | "assistant"; text: string }[];
  expect: {
    askArtist?: boolean;
    cards?: { include?: string[]; only?: string[]; none?: true };
    textIncludes?: string[]; textExcludes?: string[];
  };
  /** The model's steps for the turn: each step is its content blocks (text, tool_use). null = not recorded. */
  replay: null | Record<string, unknown>[][];
}
export interface VisitorFile { note: string; cases: VisitorCase[] }
export interface VisitorResult {
  id: string; pass: boolean; failures: string[]; rawText: string; finalText: string; cards: string[]; askArtist: boolean;
  usage: Usage; model: string; replay: Record<string, unknown>[][];
}

export const TODAY = "2026-11-12";
export const loadVisitorCases = (): VisitorFile => JSON.parse(readFileSync(new URL("./visitor-cases.json", import.meta.url), "utf8"));
/** Slots for Isaac's questions have no question yet: skipped (D-132). */
export const isSlot = (c: VisitorCase) => c.source === "isaac-slot" || !c.question.trim();

/** A model that plays back a case's recorded steps. */
export function visitorReplayModel(steps: Record<string, unknown>[][]): Model {
  let i = 0;
  return async (_req, onText) => {
    const step = steps[i++];
    if (!step) throw new Error("the recording has no more steps");
    const content = step.map((b, n) =>
      (b.type === "tool_use" ? { id: `toolu_replay_${i}_${n}`, ...b } : b.type === "text" ? { citations: null, ...b } : b) as unknown as Block);
    for (const b of content) if (b.type === "text") onText(b.text);
    const stop = content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
    return { id: `msg_replay_${i}`, type: "message", role: "assistant", model: "replay", content, stop_reason: stop,
      stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Beta.Messages.BetaMessage;
  };
}

const safe = (id: string) => id.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
/** A visitor key and an address of its own per case, so no case hits another's limits (D-130). */
function identity(id: string) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return { key: `eval_${safe(id)}_${h.toString(36)}`.padEnd(32, "x"), ip: `198.51.${(h >>> 8) & 255}.${h & 255}` };
}

const occurrences = (s: string, needle: string) => s.split(needle).length - 1;
const POR = "price on request";

/** One case, start to finish, as its own visitor. `settings` are the request settings the Worker would send. */
export async function runVisitorCase(
  server: Server, fixture: Fixture, c: VisitorCase, model: Model, settings: Partial<ModelRequest> = {},
): Promise<VisitorResult> {
  const env = assistantEnv(server);
  const { key, ip } = identity(c.id);
  const api = visitorApi(env, fixture.slug, key, ip);

  // The chat so far: run the history turns with a scripted model (they are set-up, not graded).
  const hist = c.history ?? [];
  for (let i = 0; i < hist.length; i++) {
    const m = hist[i]!;
    if (m.role !== "user") continue;
    const next = hist[i + 1];
    const reply = next?.role === "assistant" ? next.text : "Okay.";
    const s = scripted([() => message([text(reply)])]);
    await visitorTurn({ api, model: s.model, settings }, { message: m.text, fresh: i === 0, piece: null, today: TODAY, origin: null });
  }

  const catalogue: DigestWork[] = (await api.digest()).works;
  const words = await api.words();
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const replay: Record<string, unknown>[][] = [];
  let rawText = "";
  const watched: Model = async (req, onText) => {
    const msg = await model(req, onText);
    usage.inputTokens += msg.usage.input_tokens ?? 0;
    usage.outputTokens += msg.usage.output_tokens ?? 0;
    usage.cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += msg.usage.cache_creation_input_tokens ?? 0;
    // What the visitor assistant takes as the reply: the text of the last message (as visitorTurn reads it).
    rawText = msg.content.filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
    replay.push(msg.content.filter((b) => b.type === "tool_use" || b.type === "text")
      .map((b) => (b.type === "tool_use" ? { type: "tool_use", name: b.name, input: b.input } : { type: "text", text: (b as { text: string }).text })));
    return msg;
  };

  const failures: string[] = [];
  let reply: VisitorReply | null = null;
  try {
    reply = await visitorTurn({ api, model: watched, settings }, { message: c.question, fresh: !hist.length, piece: c.piece ?? null, today: TODAY, origin: null });
  } catch (e) { failures.push(`the turn failed: ${e instanceof Error ? e.message : String(e)}`); }

  const finalText = reply?.text ?? "";
  const cards = reply?.works.map((w) => w.slug) ?? [];
  if (reply?.limited) failures.push(`the turn was not allowed (${reply.limited})`);

  // The universal checks, on the model's RAW output (what it said before the reply check cleaned it).
  const raw = readMarkers(rawText);
  const bySlug = new Set(catalogue.map((w) => w.slug));
  // (a) no card outside the catalogue
  for (const s of raw.works) if (!bySlug.has(s.trim().toLowerCase())) failures.push(`(a) card outside the catalogue: ${s}`);
  // (b) no wrong or invented price: the reply check must not have had to replace one
  const allowed = [c.question, ...Object.values(words.answers), ...hist.filter((m) => m.role === "user").map((m) => m.text)].join("\n");
  const checked = checkReply(raw, catalogue, allowed);
  const replaced = occurrences(checked.text, POR) - occurrences(raw.text, POR);
  if (replaced > 0) failures.push(`(b) wrong or invented price in the raw text (${replaced} replaced): ${rawText.replace(/\s+/g, " ").slice(0, 200)}`);
  // (c) no invented quoted title
  if (checked.inventedTitles.length) failures.push(`(c) invented title: ${checked.inventedTitles.join(", ")}`);
  // (d) a needed handoff
  if (c.expect.askArtist === true && !reply?.askArtist) failures.push("(d) should have been handed to the artist (askArtist false)");
  // (e) the banned word
  if (/affordable/i.test(rawText) || /affordable/i.test(finalText)) failures.push('(e) used the word "affordable"');

  // (f) the case's own expectations
  const e = c.expect;
  const lower = finalText.toLowerCase();
  if (e.askArtist === false && reply?.askArtist) failures.push("(f) should have answered, not handed to the artist");
  for (const t of e.textIncludes ?? []) if (!lower.includes(t.toLowerCase())) failures.push(`(f) text should include "${t}"`);
  for (const t of e.textExcludes ?? []) if (lower.includes(t.toLowerCase())) failures.push(`(f) text should not include "${t}"`);
  const cc = e.cards;
  if (cc?.none && cards.length) failures.push(`(f) expected no cards, got ${cards.join(", ")}`);
  for (const s of cc?.include ?? []) if (!cards.includes(s)) failures.push(`(f) expected card ${s}, got ${cards.join(", ") || "none"}`);
  if (cc?.only && (cards.length !== cc.only.length || cc.only.some((s) => !cards.includes(s)))) failures.push(`(f) expected only ${cc.only.join(", ")}, got ${cards.join(", ") || "none"}`);

  return { id: c.id, pass: !failures.length, failures, rawText, finalText, cards, askArtist: reply?.askArtist ?? false, usage, model: settings.model ?? "default", replay };
}
