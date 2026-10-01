// Cloudflare Access sign-in for the owner, ported from iaa-invoice-api.
// Returns the verified email, or null when Access isn't configured or the token is bad.
import type { Env } from "../env";

let keys: JsonWebKey[] | null = null;

const b64 = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
export { cookie };

export async function accessEmail(req: Request, env: Env): Promise<string | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const token = req.headers.get("Cf-Access-Jwt-Assertion") ?? cookie(req, "CF_Authorization");
  const [h, p, s] = token?.split(".") ?? [];
  if (!h || !p || !s) return null;
  try {
    const head = JSON.parse(b64(h)) as { kid?: string };
    const payload = JSON.parse(b64(p)) as { exp?: number; aud?: string | string[]; email?: string };
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    if (![payload.aud ?? []].flat().includes(env.ACCESS_AUD)) return null;
    if (!keys) {
      const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
      keys = ((await res.json()) as { keys?: JsonWebKey[] }).keys ?? [];
    }
    const jwk = keys.find((k) => (k as { kid?: string }).kid === head.kid);
    if (!jwk) { keys = null; return null; }
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const sig = Uint8Array.from(b64(s), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, new TextEncoder().encode(`${h}.${p}`));
    return ok && payload.email ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}
