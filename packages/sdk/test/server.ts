// A real studio-api for SDK tests: the Worker's app code running in Node
// against local D1/R2 from Wrangler's platform proxy (fresh, not persisted).
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";

const apiDir = new URL("../../../workers/studio-api/", import.meta.url);

export async function startServer() {
  const proxy = await getPlatformProxy<Record<string, unknown>>({
    configPath: new URL("wrangler.jsonc", apiDir).pathname,
    persist: false,
  });
  const DB = proxy.env.DB as D1Database;
  const migrations = readdirSync(new URL("migrations/", apiDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of migrations) {
    const sql = readFileSync(new URL(`migrations/${f}`, apiDir), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    const statements = sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
    await DB.batch(statements.map((s) => DB.prepare(s)));
  }
  const { app } = await import("../../../workers/studio-api/src/index");
  const env = { ...proxy.env, SIGNING_KEY: "test", RESEND_API_KEY: undefined, ENVIRONMENT: "dev", OWNER_EMAILS: "owner@sdk.test" };
  return { DB, env, app, dispose: () => proxy.dispose() };
}

export type Server = Awaited<ReturnType<typeof startServer>>;

/** One "device": its own cookie jar and an on/off switch for the network. */
export function device(server: Server) {
  let cookie = "";
  const net = { online: true };
  const fetchFn: typeof fetch = async (input, init) => {
    if (!net.online) throw new TypeError("Failed to fetch");
    const req = new Request(input as string, init);
    if (cookie) req.headers.set("Cookie", cookie);
    const res = await server.app.fetch(req, server.env as never);
    const set = res.headers.get("Set-Cookie");
    if (set) cookie = set.split(";")[0]!;
    return res;
  };
  return { fetch: fetchFn, net, setCookie: (c: string) => { cookie = c; } };
}
