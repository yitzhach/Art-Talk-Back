// Error alerts (card H, D-178): failures are counted per studio and day, and one bad day sends the studio's owner one
// email, nobody else, once. Outside production it is marked TEST (D-167).
import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { alertErrors, noteError } from "../src/lib/error-alerts";
import { utcDay } from "../src/lib/counts";
import { studioSlug } from "./catalogue-helpers";
import { ASSISTANT, call, makeStudio, type Studio } from "./helpers";

type Mail = { to: string[]; subject: string; text: string };
let mails: Mail[] = [];
let A: Studio, B: Studio, slugA: string;
const ownerEmail = (s: Studio) => `${s.userId.toLowerCase()}@example.test`;
const count = async (studioId: string, kind: string) =>
  Number((await env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM error_counts WHERE studio_id = ? AND kind = ?").bind(studioId, kind).first<any>()).n);

// A route that fails, only in this test, to see what the error handler does with a real 500.
app.get("/v1/public/studios/:slug/test-boom", () => { throw new Error("boom"); });

beforeAll(async () => {
  A = await makeStudio("Alpha Studio");
  B = await makeStudio("Beta Studio");
  slugA = await studioSlug(A.studioId);
});
beforeEach(() => {
  mails = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://api.resend.com/emails") {
      mails.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "email" });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof fetch);
});
afterEach(() => vi.restoreAllMocks());

describe("counting failures", () => {
  it("a server error is counted for the studio whose site it was, and still answers a plain 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const before = await count(A.studioId, "server");
    const r = await call(`/v1/public/studios/${slugA}/test-boom`);
    expect(r.status).toBe(500);
    expect(r.data.error.code).toBe("internal");
    expect(r.raw).not.toContain("boom");
    // Written after the answer goes out (waitUntil in the Worker), so give it a moment.
    for (let i = 0; i < 50 && (await count(A.studioId, "server")) === before; i++) await new Promise((r) => setTimeout(r, 10));
    expect(await count(A.studioId, "server")).toBe(before + 1);
    expect(await count(B.studioId, "server")).toBe(0);
  });

  it("a 4xx is not a failure", async () => {
    const before = await count(A.studioId, "server");
    expect((await call(`/v1/public/studios/${slugA}/artworks/no-such-piece`)).status).toBe(404);
    expect(await count(A.studioId, "server")).toBe(before);
  });

  it("only the assistant can report a failed answer", async () => {
    const url = `/v1/public/studios/${slugA}/visitor/turn-failed`;
    expect((await call(url, { method: "POST" })).status).toBe(403);
    expect((await call(url, { method: "POST", headers: { "X-Studio-Assistant": "wrong" } })).status).toBe(401);
    expect(await count(A.studioId, "assistant")).toBe(0);
    expect((await call(url, { method: "POST", headers: ASSISTANT })).status).toBe(204);
    expect(await count(A.studioId, "assistant")).toBe(1);
  });
});

describe("the daily error email", () => {
  const today = new Date().toISOString();
  const yesterday = utcDay(new Date(Date.now() - 86_400_000));

  it("one bad day sends the studio's owner one email, once, and nobody else", async () => {
    await env.DB.prepare("DELETE FROM error_counts").run();
    await noteError(env.DB, "server", A.studioId, yesterday);
    await noteError(env.DB, "server", A.studioId, yesterday);
    await noteError(env.DB, "webhook", A.studioId, yesterday);
    await noteError(env.DB, "assistant", A.studioId, utcDay()); // today's: tomorrow's email
    const sent = await alertErrors({ ...env, ENVIRONMENT: "production" } as any, today);
    expect(sent).toBe(1);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toEqual([ownerEmail(A)]);
    expect(mails[0]!.subject).toBe("Alpha Studio: errors on your site yesterday");
    expect(mails[0]!.text).toContain("2 times the studio's server hit an error");
    expect(mails[0]!.text).toContain("1 card-payment message from Square that failed");
    expect(mails[0]!.text).not.toContain("assistant answer");
    expect(mails[0]!.text).not.toContain("TEST");

    mails = [];
    expect(await alertErrors({ ...env, ENVIRONMENT: "production" } as any, today)).toBe(0);
    expect(mails).toEqual([]);
  });

  it("a quiet day sends nothing", async () => {
    await env.DB.prepare("DELETE FROM error_counts").run();
    await env.DB.prepare("DELETE FROM error_alerts").run();
    expect(await alertErrors({ ...env, ENVIRONMENT: "production" } as any, today)).toBe(0);
    expect(mails).toEqual([]);
  });

  it("outside production the email is marked TEST and goes to the studio's inbox", async () => {
    await env.DB.prepare("DELETE FROM error_alerts").run();
    await noteError(env.DB, "assistant", B.studioId, yesterday);
    expect(await alertErrors({ ...env, ENVIRONMENT: "staging" } as any, today)).toBe(1);
    expect(mails[0]!.to).toEqual([ownerEmail(B)]);
    expect(mails[0]!.subject).toBe("TEST: Beta Studio: errors on your site yesterday");
    expect(mails[0]!.text.startsWith("TEST: this is not the live site.")).toBe(true);
    expect(mails[0]!.text).toContain("1 assistant answer that didn't come through");
  });

  it("a failure with no studio goes to the platform's owners only", async () => {
    await env.DB.prepare("DELETE FROM error_counts").run();
    await env.DB.prepare("DELETE FROM error_alerts").run();
    await noteError(env.DB, "webhook", "", yesterday);
    expect(await alertErrors({ ...env, ENVIRONMENT: "production", OWNER_EMAILS: "owner@example.test" } as any, today)).toBe(1);
    expect(mails.map((m) => m.to)).toEqual([["owner@example.test"]]);
  });
});
