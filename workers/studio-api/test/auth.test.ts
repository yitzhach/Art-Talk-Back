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

describe("an optional password (D-080)", () => {
  const byCode = async (email: string) => {
    await call("/v1/auth/code", { method: "POST", json: { email } });
    const res = await call("/v1/auth/verify", { method: "POST", json: { email, code: mail.codes[email] } });
    return cookieFrom(res.headers);
  };
  const login = (email: string, password: string) => call("/v1/auth/password/login", { method: "POST", json: { email, password } });

  it("is set once signed in, then signs in instead of a code; the code still works", async () => {
    const cookie = await byCode("pw@example.test");
    expect((await call("/v1/me", { cookie })).data.hasPassword).toBe(false);
    expect((await call("/v1/auth/password", { method: "PUT", cookie, json: { password: "short" } })).status).toBe(400);
    expect((await call("/v1/auth/password", { method: "PUT", cookie, json: { password: "harbour mural 2026" } })).status).toBe(204);
    expect((await call("/v1/me", { cookie })).data.hasPassword).toBe(true);
    expect(await rowCount("SELECT COUNT(*) AS n FROM users WHERE password_hash LIKE '%harbour%'")).toBe(0);

    const ok = await login("PW@example.test", "harbour mural 2026");
    expect(ok.status).toBe(200);
    expect((await call("/v1/me", { cookie: cookieFrom(ok.headers) })).data.user.email).toBe("pw@example.test");
    expect((await byCode("pw@example.test")).length).toBeGreaterThan(20);
  });

  it("gives one answer for a wrong password, no password, or no account", async () => {
    await byCode("nopw@example.test");
    const answers = await Promise.all([login("pw@example.test", "wrong wrong wrong"), login("nopw@example.test", "anything at all"), login("ghost@example.test", "anything at all")]);
    expect(answers.map((r) => r.status)).toEqual([400, 400, 400]);
    expect(new Set(answers.map((r) => r.data.error.message)).size).toBe(1);
  });

  it("locks password sign-in for 15 minutes after 5 wrong in a row", async () => {
    const cookie = await byCode("lock@example.test");
    await call("/v1/auth/password", { method: "PUT", cookie, json: { password: "the right one here" } });
    for (let i = 0; i < 5; i++) expect((await login("lock@example.test", "not the right one")).status).toBe(400);
    const locked = await login("lock@example.test", "the right one here");
    expect(locked.status).toBe(429);
    expect(locked.data.error.code).toBe("rate_limited");
  });

  it("can be removed; needs a session; a new one signs other sessions out", async () => {
    expect((await call("/v1/auth/password", { method: "PUT", json: { password: "no session here" } })).status).toBe(401);
    const one = await byCode("rm@example.test");
    const two = await byCode("rm@example.test");
    await call("/v1/auth/password", { method: "PUT", cookie: one, json: { password: "first password!" } });
    expect((await call("/v1/me", { cookie: two })).status).toBe(401);
    expect((await call("/v1/me", { cookie: one })).status).toBe(200);
    expect((await call("/v1/auth/password", { method: "DELETE", cookie: one })).status).toBe(204);
    expect((await login("rm@example.test", "first password!")).status).toBe(400);
  });
});
