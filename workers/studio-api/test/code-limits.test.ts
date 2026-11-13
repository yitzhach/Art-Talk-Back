// The public email codes (card S, D-179): beyond 5 an hour per address, one sender and the whole studio are limited,
// so the follow and keep-this-chat forms can't email strangers in bulk; the stored address hash is keyed.
import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CODES_PER_SENDER_HOUR, CODES_PER_STUDIO_HOUR, keyedIpHash } from "../src/lib/code-limits";
import { sha256 } from "../src/lib/crypto";
import { studioSlug } from "./catalogue-helpers";
import { call, makeStudio, type Studio } from "./helpers";

let A: Studio, slug: string;
let sent = 0;
const vkey = (n: string) => `visitor-${n}`.padEnd(32, "k");
const follow = (email: string, ip: string, v = "f") =>
  call(`/v1/public/studios/${slug}/follow/email-code`, { method: "POST", headers: { "x-visitor-key": vkey(v), "cf-connecting-ip": ip }, json: { email } });
const keep = (email: string, ip: string, v = "k") =>
  call(`/v1/public/studios/${slug}/visitor/email-code`, { method: "POST", headers: { "x-visitor-key": vkey(v), "cf-connecting-ip": ip }, json: { email } });

beforeAll(async () => {
  A = await makeStudio("Limits Studio");
  slug = await studioSlug(A.studioId);
});
beforeEach(() => {
  sent = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://api.resend.com/emails") { sent++; return Response.json({ id: "email" }); }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof fetch);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.prepare("DELETE FROM code_sends").run();
  await env.DB.prepare("DELETE FROM login_codes").run();
});

describe("one sender", () => {
  it(`gets ${CODES_PER_SENDER_HOUR} codes an hour across both forms and any addresses, then a plain refusal`, async () => {
    for (let i = 0; i < CODES_PER_SENDER_HOUR; i++) {
      const r = i % 2 ? await keep(`stranger${i}@example.test`, "198.51.100.1") : await follow(`stranger${i}@example.test`, "198.51.100.1");
      expect(r.status, r.raw).toBe(204);
    }
    const over = await follow("one-more@example.test", "198.51.100.1");
    expect(over.status).toBe(429);
    expect(over.data.error.message).toContain("Try again in an hour");
    expect(sent).toBe(CODES_PER_SENDER_HOUR);
    // Someone else is not held up by it.
    expect((await follow("someone@example.test", "198.51.100.2")).status).toBe(204);
  });

  it("keeps a keyed hash, never the address", async () => {
    await follow("x@example.test", "203.0.113.50");
    const rows = (await env.DB.prepare("SELECT ip_hash FROM code_sends").all<{ ip_hash: string }>()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ip_hash).not.toContain("203.0.113.50");
    expect(rows[0]!.ip_hash).not.toBe(await sha256("ip\n203.0.113.50"));
    expect(rows[0]!.ip_hash).toBe(await keyedIpHash(env as any, "203.0.113.50"));
    expect(await keyedIpHash({ SIGNING_KEY: "another key" } as any, "203.0.113.50")).not.toBe(rows[0]!.ip_hash);
  });
});

describe("the whole studio", () => {
  it(`stops at ${CODES_PER_STUDIO_HOUR} codes an hour`, async () => {
    const now = new Date().toISOString();
    const stmts = Array.from({ length: CODES_PER_STUDIO_HOUR }, (_, i) =>
      env.DB.prepare("INSERT INTO code_sends (studio_id, ip_hash, sent_at) VALUES (?, ?, ?)").bind(A.studioId, `other-${i}`, now));
    await env.DB.batch(stmts);
    const r = await follow("late@example.test", "198.51.100.9");
    expect(r.status).toBe(429);
    expect(sent).toBe(0);
  });

  it("an hour later the sender's codes no longer count", async () => {
    const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const ih = await keyedIpHash(env as any, "198.51.100.3");
    await env.DB.batch(Array.from({ length: CODES_PER_SENDER_HOUR }, () =>
      env.DB.prepare("INSERT INTO code_sends (studio_id, ip_hash, sent_at) VALUES (?, ?, ?)").bind(A.studioId, ih, old)));
    expect((await follow("fresh@example.test", "198.51.100.3")).status).toBe(204);
  });
});
