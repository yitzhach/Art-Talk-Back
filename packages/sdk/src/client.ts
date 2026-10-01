// Thin typed wrapper over studio-api's /v1 routes. The browser keeps the
// session cookie; pass a custom fetch for tests or other runtimes.
import type { z } from "zod";
import type { Me, SyncOp, SyncPullResponse, SyncPushResponse } from "@studio/core";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

/** Thrown when the request never reached the server (offline, DNS, dropped connection). */
export class NetworkError extends Error {}

export interface ClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

export class ApiClient {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: ClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  async request<T>(method: string, path: string, opts: { json?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.json !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}/v1${path}`, {
        method,
        headers,
        credentials: "include",
        ...(opts.json !== undefined ? { body: JSON.stringify(opts.json) } : {}),
      });
    } catch (err) {
      throw new NetworkError(String((err as Error)?.message ?? err));
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
    if (!res.ok) {
      throw new ApiError(res.status, data?.error?.code ?? "internal", data?.error?.message ?? res.statusText, data?.error?.details);
    }
    return data as T;
  }

  requestCode = (email: string) => this.request<void>("POST", "/auth/code", { json: { email } });
  verify = (email: string, code: string) => this.request<z.infer<typeof Me>>("POST", "/auth/verify", { json: { email, code } });
  logout = () => this.request<void>("POST", "/auth/logout");
  me = () => this.request<z.infer<typeof Me>>("GET", "/me");

  push = (ops: z.infer<typeof SyncOp>[]) => this.request<z.infer<typeof SyncPushResponse>>("POST", "/sync/push", { json: { ops } });
  pull = (since: string, limit = 200) =>
    this.request<z.infer<typeof SyncPullResponse>>("GET", `/sync/pull?since=${encodeURIComponent(since)}&limit=${limit}`);
}
