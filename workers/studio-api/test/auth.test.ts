import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, captureCodes, rowCount } from "./helpers";

let mail: ReturnType<typeof captureCodes>;
beforeEach(async () => {
  mail = captureCodes();
  // Tests share one database; each starts with no codes asked for (D-049 counts them).
  await env.DB.prepare("DELETE FROM login_codes").run();
});
afterEach(() => mail.restore());

const cookieFrom = (h: Headers) => /studio_session=([^;]*)/.exec(h.get("Set-Cookie") ?? "")?.[0] ?? "";

describe("sign in by email code", () => {
  it("emails a code, verifies it, and /me shows the user and their new studio (owner bootstrap, D-022)", async () => {
    const sent = await call("/v1/auth/code", { method: "POST", json: { email: "Owner@Studio-A.test" } });
    expect(sent.status).toBe(204);
    const code = mail.codes["owner@studio-a.test"]!;
    expect(code).toMatch(/^\d{6}$/);

    const verified = await call("/v1/auth/verify", { method: "POST", json: { email: "owner@studio-a.test", code } });
    expect(verified.status).toBe(200);
    const cookie = cookieFrom(verified.headers);
    expect(verified.headers.get("Set-Cookie")).toMatch(/HttpOnly; Secure; SameSite=Lax/);

    const me = await call("/v1/me", { cookie });
    expect(me.status).toBe(200);
    expect(me.data.user.email).toBe("owner@studio-a.test");
    expect(me.data.memberships).toHaveLength(1);
    expect(me.data.memberships[0]).toMatchObject({ role: "owner", studioName: "Dev Studio" });
    expect(me.data.activeStudioId).toBe(me.data.memberships[0].studioId);

    // The session works on studio routes, and settings were created with the studio.
    expect((await call("/v1/settings", { cookie })).data).toMatchObject({ currency: "USD", depositBps: 5000 });
  });

  it("stores only a hash of the session token (D-005)", async () => {
    await call("/v1/auth/code", { method: "POST", json: { email: "owner@studio-b.test" } });
    const res = await call("/v1/auth/verify", { method: "POST", json: { email: "owner@studio-b.test", code: mail.codes["owner@studio-b.test"] } });
    const token = cookieFrom(res.headers).split("=")[1]!;
    expect(await rowCount("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?", token)).toBe(0);
  });

  it("answers 204 for any address, and a stranger gets no studio", async () => {
    expect((await call("/v1/auth/code", { method: "POST", json: { email: "stranger@else.test" } })).status).toBe(204);
    const res = await call("/v1/auth/verify", { method: "POST", json: { email: "stranger@else.test", code: mail.codes["stranger@else.test"] } });
    const cookie = cookieFrom(res.headers);
    expect(res.data.memberships).toEqual([]);
    expect((await call("/v1/artworks", { cookie })).status).toBe(403);
  });

  it("rejects a wrong code, and locks the code after 6 tries (D-019)", async () => {
    await call("/v1/auth/code", { method: "POST", json: { email: "boot@example.test" } });
    const right = mail.codes["boot@example.test"]!;
    const wrong = right === "111111" ? "222222" : "111111";
    for (let i = 0; i < 6; i++) {
      expect((await call("/v1/auth/verify", { method: "POST", json: { email: "boot@example.test", code: wrong } })).status).toBe(400);
    }
    const locked = await call("/v1/auth/verify", { method: "POST", json: { email: "boot@example.test", code: right } });
    expect(locked.status).toBe(429);
    expect(locked.data.error.code).toBe("rate_limited");
  });

  it("sends at most 5 codes an hour per address, with the same answer for any address (D-049)", async () => {
    const ask = (email: string) => call("/v1/auth/code", { method: "POST", json: { email } });
    for (let i = 1; i <= 5; i++) {
      expect((await ask("boot@example.test")).status).toBe(204);
      expect((await ask("nobody@else.test")).status).toBe(204);
    }
    const sixth = await ask("boot@example.test");
    expect(sixth.status).toBe(429);
    expect(sixth.data.error.message).toMatch(/5 codes this hour/);
    // A stranger gets exactly the same answer, so a 429 says nothing about who has an account.
    expect((await ask("nobody@else.test")).status).toBe(429);
    expect(await rowCount("SELECT sends AS n FROM login_codes WHERE email = 'boot@example.test'")).toBe(5);

    // The newest code still works.
    const ok = await call("/v1/auth/verify", { method: "POST", json: { email: "boot@example.test", code: mail.codes["boot@example.test"] } });
    expect(ok.status).toBe(200);

    // An hour on, the count starts again.
    await env.DB.prepare("UPDATE login_codes SET created_at = ? WHERE email = 'nobody@else.test'")
      .bind(new Date(Date.now() - 3601_000).toISOString()).run();
    expect((await ask("nobody@else.test")).status).toBe(204);
    expect(await rowCount("SELECT sends AS n FROM login_codes WHERE email = 'nobody@else.test'")).toBe(1);
  });

  it("rejects an expired code", async () => {
    await call("/v1/auth/code", { method: "POST", json: { email: "boot@example.test" } });
    await env.DB.prepare("UPDATE login_codes SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    const res = await call("/v1/auth/verify", { method: "POST", json: { email: "boot@example.test", code: mail.codes["boot@example.test"] } });
    expect(res.status).toBe(400);
  });

  it("logout ends the session", async () => {
    await call("/v1/auth/code", { method: "POST", json: { email: "boot@example.test" } });
    const res = await call("/v1/auth/verify", { method: "POST", json: { email: "boot@example.test", code: mail.codes["boot@example.test"] } });
    const cookie = cookieFrom(res.headers);
    expect((await call("/v1/auth/logout", { method: "POST", cookie })).status).toBe(204);
    expect((await call("/v1/me", { cookie })).status).toBe(401);
  });

  it("renews a session in use once it is past half its life, and not before (D-048)", async () => {
    await call("/v1/auth/code", { method: "POST", json: { email: "boot@example.test" } });
    const res = await call("/v1/auth/verify", { method: "POST", json: { email: "boot@example.test", code: mail.codes["boot@example.test"] } });
    const cookie = cookieFrom(res.headers);
    const fresh = await call("/v1/me", { cookie });
    expect(fresh.headers.get("Set-Cookie")).toBeNull();

    // Ten days left: the next request pushes it back out to 30 and re-sends the cookie.
    const tenDays = new Date(Date.now() + 10 * 86400_000).toISOString();
    await env.DB.prepare("UPDATE sessions SET expires_at = ?").bind(tenDays).run();
    const renewed = await call("/v1/me", { cookie });
    expect(renewed.status).toBe(200);
    expect(renewed.headers.get("Set-Cookie")).toBe(`${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
    const expires = await env.DB.prepare("SELECT MAX(expires_at) AS e FROM sessions").first<string>("e");
    expect(Date.parse(expires!) - Date.now()).toBeGreaterThan(29 * 86400_000);

    // An expired session is not renewed: it is gone.
    await env.DB.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    const ended = await call("/v1/me", { cookie });
    expect(ended.status).toBe(401);
    expect(ended.headers.get("Set-Cookie")).toBeNull();
  });

  it("errors use the spec's shape", async () => {
    const res = await call("/v1/me");
    expect(res.data).toEqual({ error: { code: "unauthenticated", message: "Sign in first" } });
  });
});
