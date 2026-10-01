// File links signed by studio-api itself (D-020): HMAC over method, file id
// and expiry. The link is the permission, so it is short-lived and bound to
// one file and one method.
import { hmac, safeEqual } from "./crypto";

export const LINK_TTL_SECONDS = 15 * 60;

export async function signFileLink(key: string, origin: string, method: "PUT" | "GET", fileId: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + LINK_TTL_SECONDS;
  const sig = await hmac(key, `${method}\n${fileId}\n${exp}`);
  return {
    url: `${origin}/v1/files/${fileId}/content?exp=${exp}&sig=${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export async function verifyFileLink(key: string, method: "PUT" | "GET", fileId: string, exp: string | undefined, sig: string | undefined, now = Date.now()) {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < now) return false;
  return safeEqual(await hmac(key, `${method}\n${fileId}\n${exp}`), sig);
}
