// Runs the eval cases (D-047): each case gets a fresh studio with the fixture,
// one turn of the assistant, and checks on the tool calls it made and how the
// turn ended. The model is either the recorded replay or the real one.
import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import type { Server } from "../../../packages/sdk/test/server";
import { api, assistantEnv, ownerCookie } from "../test/harness";
import type { Model } from "../src/model";
import { modelSettings } from "../src/model";
import { studioFor } from "../src/studio";
import { type TurnEvent, runTurn } from "../src/turn";

type Block = Anthropic.Beta.Messages.BetaContentBlock;
export interface Call { tool: string; input?: Record<string, unknown> }
export interface Case {
  id: string; source: string; app: string; today: string; request: string;
  expect: { calls: Call[]; forbid?: string[]; outcome: "card" | "done" | "answer" };
  replay: Record<string, unknown>[][];
}
export interface EvalFile { fixture: { shows: Record<string, unknown>[]; sales: Record<string, unknown>[] }; cases: Case[] }
export interface CaseResult { id: string; pass: boolean; failures: string[]; calls: Call[]; events: TurnEvent[]; replies: Record<string, unknown>[][] }

export const loadCases = (): EvalFile => JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));

/** Fixture ids, both ways: "$show:<name>" ⇄ id. */
type Refs = { toId: Map<string, string>; toRef: Map<string, string> };

async function seed(server: Server, cookie: string, fixture: EvalFile["fixture"]): Promise<Refs> {
  const toId = new Map<string, string>();
  for (const s of fixture.shows) toId.set(`$show:${s.name}`, (await api(server, cookie, "POST", "/shows", s)).data.id);
  for (const { show, ...sale } of fixture.sales) {
    const body = { ...sale, ...(show ? { showId: toId.get(`$show:${show}`) } : {}) };
    toId.set(`$sale:${sale.title}`, (await api(server, cookie, "POST", "/sales", body)).data.id);
  }
  return { toId, toRef: new Map([...toId].map(([k, v]) => [v, k])) };
}

/** Swap refs for ids (or back) anywhere in a JSON value. */
function swap(v: unknown, map: Map<string, string>): unknown {
  if (typeof v === "string") return map.get(v) ?? v;
  if (Array.isArray(v)) return v.map((x) => swap(x, map));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x, map)]));
  return v;
}

/** A model that plays back a case's recorded steps. */
export function replayModel(steps: Record<string, unknown>[][], refs: Refs): Model {
  let i = 0;
  return async (_req, onText) => {
    const step = steps[i++];
    if (!step) throw new Error("the recording has no more steps");
    const content = (swap(step, refs.toId) as Record<string, unknown>[]).map((b, n) =>
      (b.type === "tool_use" ? { id: `toolu_replay_${i}_${n}`, ...b } : b.type === "text" ? { citations: null, ...b } : b) as unknown as Block);
    for (const b of content) if (b.type === "text") onText(b.text);
    const stop = content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
    return { id: `msg_replay_${i}`, type: "message", role: "assistant", model: "replay", content, stop_reason: stop,
      stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Beta.Messages.BetaMessage;
  };
}

/** Does `actual` contain everything `want` asks for? "$absent" = the key must not be there. */
function matches(want: unknown, actual: unknown, path = ""): string[] {
  if (want && typeof want === "object" && !Array.isArray(want)) {
    const a = (actual ?? {}) as Record<string, unknown>;
    return Object.entries(want).flatMap(([k, w]) =>
      w === "$absent" ? (k in a ? [`${path}${k} should not be sent (got ${JSON.stringify(a[k])})`] : []) : matches(w, a[k], `${path}${k}.`));
  }
  return JSON.stringify(want) === JSON.stringify(actual) ? [] : [`${path.replace(/\.$/, "")}: wanted ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`];
}

export function check(c: Case, calls: Call[], events: TurnEvent[], refs: Refs): string[] {
  const failures: string[] = [];
  // Expected calls in order, other calls (an extra search) allowed between them.
  let at = 0;
  for (const want of c.expect.calls) {
    const wanted = swap(want.input ?? {}, refs.toId);
    let found = false;
    let closest: string[] = [];
    for (; at < calls.length; at++) {
      if (calls[at]!.tool !== want.tool) continue;
      const diff = matches(wanted, calls[at]!.input);
      if (!diff.length) { found = true; at++; break; }
      closest = diff;
    }
    if (!found) failures.push(`expected a ${want.tool} call${closest.length ? `: ${closest.join("; ")}` : ""}`);
  }
  for (const t of c.expect.forbid ?? []) if (calls.some((x) => x.tool === t)) failures.push(`must not call ${t}`);
  const outcome = events.some((e) => e.type === "card") ? "card" : events.some((e) => e.type === "done") ? "done" : "answer";
  if (outcome !== c.expect.outcome) failures.push(`expected the turn to end with ${c.expect.outcome}, got ${outcome}`);
  const end = events.at(-1);
  if (!end || end.type !== "end" || end.reason !== "end_turn") failures.push(`turn ended ${JSON.stringify(end)}`);
  return failures;
}

/** One case, start to finish, on its own fresh studio. */
export async function runCase(server: Server, file: EvalFile, c: Case, n: number, modelFor: (refs: Refs) => Model): Promise<CaseResult> {
  const cookie = await ownerCookie(server, `eval-${n}@eval.test`);
  const refs = await seed(server, cookie, file.fixture);
  const env = assistantEnv(server);
  const calls: Call[] = [];
  const replies: Record<string, unknown>[][] = [];
  const events: TurnEvent[] = [];
  const inner = modelFor(refs);
  // Watch what the model asks for, and keep its replies (with ids back as refs) for --record.
  const model: Model = async (req, onText) => {
    const msg = await inner(req, onText);
    replies.push(msg.content.filter((b) => b.type === "tool_use" || b.type === "text")
      .map((b) => (b.type === "tool_use" ? { type: "tool_use", name: b.name, input: swap(b.input, refs.toRef) } : { type: "text", text: (b as { text: string }).text })));
    for (const b of msg.content) if (b.type === "tool_use") calls.push({ tool: b.name, input: b.input as Record<string, unknown> });
    return msg;
  };
  try {
    await runTurn({ studio: studioFor(env, cookie), model, settings: modelSettings(env) },
      { app: c.app, message: c.request, today: c.today }, (e) => events.push(e));
  } catch { /* the end event says so */ }
  const failures = check(c, calls, events, refs);
  return { id: c.id, pass: !failures.length, failures, calls: calls.map((x) => ({ ...x, input: swap(x.input, refs.toRef) as Record<string, unknown> })), events, replies };
}

export const evalOwners = (file: EvalFile) => file.cases.map((_, n) => `eval-${n}@eval.test`).join(",");
