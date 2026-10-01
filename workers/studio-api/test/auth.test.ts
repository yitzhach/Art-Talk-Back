import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, captureCodes, rowCount } from "./helpers";

let mail: ReturnType<typeof captureCodes>;
beforeEach(() => { mail = captureCodes(); });
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

  it("errors use the spec's shape", async () => {
    const res = await call("/v1/me");
    expect(res.data).toEqual({ error: { code: "unauthenticated", message: "Sign in first" } });
  });
});
