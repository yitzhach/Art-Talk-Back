// studio-api, as seen by the assistant: every call goes through the service
// binding with the person's own session and the assistant's key (D-046), so
// studio-api applies that person's permissions plus the assistant's limits.
import type { Env } from "./env";

export class StudioError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

export interface Tool {
  name: string;
  action: string | null;
  description: string;
  inputSchema: Record<string, unknown>;
  level: "auto" | "confirm" | "always_confirm" | "never";
}
export interface SearchItem { type: string; id: string; version: number; label: string; detail: string }
export type Proposal = Record<string, unknown> & { id: string; summary: string; details: { label: string; value: string }[] };
export type ActResult =
  | { status: "done"; result: Record<string, unknown>; activityIds: string[] }
  | { status: "needs_confirmation"; proposal: Proposal };
export interface CardState { id: string; summary: string; status: "pending" | "confirmed" | "cancelled"; expiresAt: string }
export interface StoredMessage { role: "user" | "assistant"; content: unknown }

export interface Studio {
  tools(app: string): Promise<Tool[]>;
  search(q: string, types?: string[]): Promise<SearchItem[]>;
  act(action: string, input: Record<string, unknown>, summary: string): Promise<ActResult>;
  /** The current conversation; a new empty one (fresh); or a past one by id. */
  thread(fresh?: boolean, id?: string): Promise<{ threadId: string; messages: StoredMessage[] }>;
  /** My newest cards, any status: how each one ended. */
  cards(): Promise<CardState[]>;
  append(threadId: string, app: string | null, messages: StoredMessage[]): Promise<void>;
}

export function studioFor(env: Env, cookie: string): Studio {
  async function call<T>(method: string, path: string, json?: unknown): Promise<T> {
    const headers: Record<string, string> = { cookie, "x-studio-assistant": env.ASSISTANT_KEY ?? "" };
    if (json !== undefined) headers["content-type"] = "application/json";
    const res = await env.STUDIO_API.fetch(`https://studio-api/v1${path}`, {
      method, headers, ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
    const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
    if (!res.ok) throw new StudioError(res.status, data?.error?.code ?? "internal", data?.error?.message ?? res.statusText, data?.error?.details);
    return data as T;
  }
  return {
    tools: async (app) => (await call<{ tools: Tool[] }>("GET", `/assistant/tools?app=${encodeURIComponent(app)}`)).tools,
    search: async (q, types) => (await call<{ items: SearchItem[] }>("GET",
      `/search?q=${encodeURIComponent(q)}${types?.length ? `&types=${encodeURIComponent(types.join(","))}` : ""}`)).items,
    act: (action, input, summary) => call<ActResult>("POST", "/assistant/act", { action, input, summary }),
    thread: (fresh, id) => call("GET", fresh ? "/assistant/thread?fresh=1" : id ? `/assistant/thread?id=${encodeURIComponent(id)}` : "/assistant/thread"),
    cards: async () => (await call<{ items: CardState[] }>("GET", "/assistant/proposals?status=all")).items,
    append: async (threadId, app, messages) => { await call("POST", "/assistant/thread/messages", { threadId, app, messages }); },
  };
}
