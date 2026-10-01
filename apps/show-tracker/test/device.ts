// One simulated "device": a fresh copy of the tracker's real scripts (core.js,
// store-studio.js) running in their own global, with their own localStorage,
// talking to the real studio-api through a cookie jar and an on/off network.
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { vi } from "vitest";
import * as SDK from "../../../packages/sdk/src";
import { type Server, device } from "../../../packages/sdk/test/server";

const dir = new URL("../", import.meta.url);
export const API = "https://api.test";
export const OWNER = "owner@sdk.test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let n = 0;

export interface TrackerDevice {
  AST: Any;
  ST: Any;
  /** Close the page and open it again: same localStorage, same IndexedDB, same cookie, fresh scripts. */
  restart(): Promise<void>;
  net: { online: boolean };
  storage: Map<string, string>;
  /** Wait for mirrors to finish, push, then pull. */
  settle(): Promise<void>;
  /** Connect the adapter (signed in as the owner). */
  connect(): Promise<void>;
  events: string[];
}

export async function trackerDevice(
  server: Server,
  opts: { signedIn?: boolean; localStorage?: Record<string, unknown> } = {},
): Promise<TrackerDevice> {
  const d = device(server);
  const storage = new Map<string, string>(
    Object.entries(opts.localStorage ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
  );
  const events: string[] = [];
  let session: Any = null;
  const dbName = `tracker-${++n}`;

  function load() {
    const sandbox: Any = {
      console, setTimeout, clearTimeout, setInterval, clearInterval,
      localStorage: {
        getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
        setItem: (k: string, v: string) => { storage.set(k, String(v)); },
        removeItem: (k: string) => { storage.delete(k); },
      },
      navigator: { onLine: true },
      crypto: { randomUUID: () => globalThis.crypto.randomUUID() },
      document: { addEventListener() {}, documentElement: { setAttribute() {}, getAttribute: () => null }, querySelector: () => null },
      CustomEvent: class { constructor(public type: string) {} },
      addEventListener() {},
      dispatchEvent(e: { type: string }) { events.push(e.type); return true; },
      StudioSDK: SDK,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    for (const f of ["core.js", "store-studio.js"]) {
      vm.runInContext(readFileSync(new URL(f, dir), "utf8"), sandbox, { filename: f });
    }
    return { AST: sandbox.AST as Any, ST: sandbox.ASTStudio as Any };
  }

  const first = load();

  const dev: TrackerDevice = {
    AST: first.AST, ST: first.ST, net: d.net, storage, events,
    async restart() {
      await dev.ST.disconnect();
      Object.assign(dev, load());
      await dev.ST.connect({ session, fetch: d.fetch, dbName, intervalMs: 3_600_000 });
    },
    async connect() {
      const api = new SDK.ApiClient({ baseUrl: API, fetch: d.fetch });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await api.requestCode(OWNER);
      const code = /(\d{6})/.exec(String(log.mock.calls.at(-1)?.[0]))![1]!;
      log.mockRestore();
      const me = await api.verify(OWNER, code);
      session = { apiUrl: API, studioId: me.activeStudioId, email: OWNER };
      await dev.ST.connect({ session, fetch: d.fetch, dbName, intervalMs: 3_600_000 });
    },
    async settle() {
      await dev.ST._flush();
      await dev.ST.sync();
      await dev.ST._flush();
    },
  };
  if (opts.signedIn !== false) await dev.connect();
  return dev;
}
