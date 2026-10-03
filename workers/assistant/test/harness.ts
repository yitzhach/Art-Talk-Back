// A real studio-api in-process (the SDK's test server) and a scripted model,
// so the assistant's whole turn runs in tests with no key and no network.
import type Anthropic from "@anthropic-ai/sdk";
import { vi } from "vitest";
import { device, startServer, type Server } from "../../../packages/sdk/test/server";
import type { Env } from "../src/env";
import type { Model, ModelRequest } from "../src/model";

export const KEY = "assistant-test-key";
type Block = Anthropic.Beta.Messages.BetaContentBlock;
type Msg = Anthropic.Beta.Messages.BetaMessage;

export const startStudio = () => startServer({ ASSISTANT_KEY: KEY });

/** Signs in as the owner (the first sign-in creates the studio) and returns the cookie. */
export async function ownerCookie(server: Server, email = "owner@sdk.test") {
  await server.DB.prepare("DELETE FROM login_codes").run();
  const d = device(server);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await d.fetch("https://api.test/v1/auth/code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  const code = /(\d{6})/.exec(String(log.mock.calls.at(-1)?.[0]))![1]!;
  log.mockRestore();
  const res = await server.app.fetch(new Request("https://api.test/v1/auth/verify", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, code }),
  }), server.env as never);
  return res.headers.get("Set-Cookie")!.split(";")[0]!;
}

/** studio-api as the assistant's service binding sees it. */
export function assistantEnv(server: Server, extra: Partial<Env> = {}): Env {
  return {
    STUDIO_API: { fetch: (input: RequestInfo | URL, init?: RequestInit) => server.app.fetch(new Request(input as string, init), server.env as never) } as unknown as Fetcher,
    ASSISTANT_KEY: KEY, ASSISTANT_MODEL: "claude-sonnet-5-5", ASSISTANT_EFFORT: "low", AI_GATEWAY_URL: "",
    ...extra,
  };
}

/** A call to studio-api as the person (no assistant key). */
export async function api(server: Server, cookie: string, method: string, path: string, json?: unknown) {
  const res = await server.app.fetch(new Request(`https://api.test/v1${path}`, {
    method, headers: { cookie, ...(json !== undefined ? { "content-type": "application/json" } : {}) },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  }), server.env as never);
  return { status: res.status, data: (await res.json().catch(() => null)) as any };
}

export const toolUse = (name: string, input: Record<string, unknown>, id = `toolu_${Math.random().toString(36).slice(2)}`): Block =>
  ({ type: "tool_use", id, name, input } as Block);
export const text = (t: string): Block => ({ type: "text", text: t, citations: null } as Block);

export function message(content: Block[], stop_reason: Msg["stop_reason"] = content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn"): Msg {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`, type: "message", role: "assistant", model: "claude-sonnet-5-5",
    content, stop_reason, stop_sequence: null, container: null, context_management: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Msg;
}

/**
 * A model that answers from a script. Each step sees the request (to assert on
 * it) and returns the next message; text blocks are streamed through onText.
 */
export function scripted(steps: ((req: ModelRequest) => Msg)[]) {
  const requests: ModelRequest[] = [];
  const model: Model = async (req, onText) => {
    requests.push(structuredClone(req));
    const step = steps[requests.length - 1];
    if (!step) throw new Error(`The script has no step ${requests.length}`);
    const msg = step(req);
    for (const b of msg.content) if (b.type === "text") onText(b.text);
    return msg;
  };
  return { model, requests };
}

/** The last tool_result content the model was sent, parsed. */
export function lastResult(req: ModelRequest): any {
  const last = req.messages.at(-1)!;
  const block = (last.content as Anthropic.Beta.Messages.BetaToolResultBlockParam[]).at(-1)!;
  try { return JSON.parse(block.content as string); } catch { return block.content; }
}

/** Runs the Worker's fetch and collects the server-sent events. */
export async function chat(handler: { fetch: (r: Request, e: Env, c: ExecutionContext) => Promise<Response> }, env: Env, cookie: string, body: Record<string, unknown>) {
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException: () => {} } as unknown as ExecutionContext;
  const res = await handler.fetch(new Request("https://app.test/assistant/chat", {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  }), env, ctx);
  if (!res.headers.get("content-type")?.startsWith("text/event-stream")) return { status: res.status, events: [], body: await res.json() as any };
  const raw = await res.text();
  await Promise.all(waits);
  const events = raw.split("\n\n").filter(Boolean).map((chunk) => JSON.parse(chunk.split("\n").find((l) => l.startsWith("data: "))!.slice(6)));
  return { status: res.status, events, body: null };
}
