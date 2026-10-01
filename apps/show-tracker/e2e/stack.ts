// Boots the pieces a real phone/laptop pair would talk to: a studio-api on
// `wrangler dev` (fresh local D1), and the tracker served beside it on ONE
// origin with /v1 forwarded to the API (D-034). Plus Chromium.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright-core";
import { startDevServer } from "../scripts/dev-server.mjs";

const apiDir = new URL("../../../workers/studio-api/", import.meta.url).pathname;
const trackerDir = new URL("../", import.meta.url).pathname;
export const OWNER = "owner@example.com"; // wrangler.jsonc's dev OWNER_EMAILS
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

export interface Stack {
  url: string;
  browser: Browser;
  /** Waits for the sign-in code the API just "emailed" (dev mode logs it). */
  nextCode(afterCount: number): Promise<string>;
  codeCount(): number;
  stop(): Promise<void>;
}

export async function startStack(): Promise<Stack> {
  const state = mkdtempSync(join(tmpdir(), "studio-e2e-"));
  const apiPort = 18000 + Math.floor(Math.random() * 1000);
  const webPort = apiPort + 1000;

  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", state], { cwd: apiDir, stdio: "pipe" });
  let log = "";
  // E2E_WORKER=1 runs the deployed topology instead: the tracker Worker (dist/) with studio-api behind a service binding.
  const asWorker = !!process.env.E2E_WORKER;
  const args = asWorker
    ? ["exec", "wrangler", "dev", "-c", `${trackerDir}wrangler.jsonc`, "-c", `${apiDir}wrangler.jsonc`, "--port", String(webPort), "--persist-to", state]
    : ["exec", "wrangler", "dev", "--port", String(apiPort), "--persist-to", state];
  const api: ChildProcess = spawn("pnpm", args, { cwd: asWorker ? trackerDir : apiDir, env: { ...process.env, NO_COLOR: "1" } });
  api.stdout?.on("data", (d) => { log += strip(String(d)); });
  api.stderr?.on("data", (d) => { log += strip(String(d)); });
  await until(() => /Ready on/.test(log), 90_000, () => `studio-api did not start:\n${log.slice(-800)}`);

  const web = asWorker ? { close: async () => {} } : await startDevServer({ port: webPort, api: `http://localhost:${apiPort}` });

  const executablePath = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ["--no-sandbox"] });

  const codes = () => [...log.matchAll(/sign-in code for [^\d\n]*(\d{6})/g)].map((m) => m[1]!);
  return {
    url: `http://localhost:${webPort}`,
    browser,
    codeCount: () => codes().length,
    async nextCode(after) {
      await until(() => codes().length > after, 15_000, () => "no sign-in code was logged");
      return codes().at(-1)!;
    },
    async stop() {
      await browser.close().catch(() => {});
      await web.close();
      api.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      if (api.exitCode === null) api.kill("SIGKILL");
      rmSync(state, { recursive: true, force: true });
    },
  };
}

export async function until(fn: () => boolean | Promise<boolean>, ms: number, why: () => string = () => "timed out") {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(why());
}

// ---------------------------------------------------------------- a device

export interface Dev {
  ctx: BrowserContext;
  page: Page;
  name: string;
  errors: string[];
}

const IGNORED = /ERR_(TUNNEL|CERT|NAME|INTERNET|CONNECTION)|Failed to load resource/; // fonts and map tiles: no internet in CI

/** A new browser profile, signed in as the owner through the real sign-in chip. */
export async function newDevice(stack: Stack, name: string): Promise<Dev> {
  const ctx = await stack.browser.newContext();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !IGNORED.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  await page.goto(`${stack.url}/index.html`);

  const before = stack.codeCount();
  await page.locator(".studio-chip").click();
  await page.fill("#studioEmail", OWNER);
  await page.click("[data-act=send]");
  await page.waitForSelector("#studioCode");
  await page.fill("#studioCode", await stack.nextCode(before));
  await page.click("[data-act=verify]");
  await synced(page);
  await page.locator(".studio-chip").click(); // close the panel
  return { ctx, page, name, errors };
}

export const chipText = async (page: Page) => (await page.locator(".studio-chip").innerText()).replace(/\s+/g, " ").trim();
/** Waits for the chip to say plain "Synced"; on timeout, says what it said instead. */
export async function synced(page: Page) {
  try {
    await page.waitForFunction(() => /^\W*synced\W*$/i.test(document.querySelector(".studio-chip")!.textContent!.trim()), null, { timeout: 20_000 });
  } catch (err) {
    const now = await page.evaluate(() => {
      const st = (window as any).ASTStudio;
      return { chip: document.querySelector(".studio-chip")!.textContent, status: st.status(), reviews: st.Reviews.list() };
    }).catch(() => "(page not readable)");
    throw new Error(`chip never said Synced: ${JSON.stringify(now)}`, { cause: err });
  }
}

/** What a phone does when the app comes back to the front, or the network returns. */
export const nudge = (page: Page) => page.evaluate(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); });

export async function goOffline(d: Dev) { await d.ctx.setOffline(true); }
export async function goOnline(d: Dev) { await d.ctx.setOffline(false); await nudge(d.page); }

/** After an edit made offline: wait until the chip admits there is a change waiting to be sent. */
export const waiting = (d: Dev) =>
  until(async () => /offline/i.test(await chipText(d.page)) && /waiting/i.test(await chipText(d.page)), 10_000, () => `${d.name}'s chip never showed a change waiting`);
