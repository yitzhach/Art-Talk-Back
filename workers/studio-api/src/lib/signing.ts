// File links signed by studio-api itself (D-020): HMAC over method, file id
// and expiry. The link is the permission, so it is short-lived and bound to
// one file and one method.
import { hmac, safeEqual } from "./crypto";

export const LINK_TTL_SECONDS = 15 * 60;

/** `width`: one of the picture's WebP copies (D-106); the signature names file and width together. */
export async function signFileLink(key: string, origin: string, method: "PUT" | "GET", fileId: string, now = Date.now(), width?: number) {
  const exp = Math.floor(now / 1000) + LINK_TTL_SECONDS;
  const subject = width ? `${fileId}@${width}` : fileId;
  const sig = await hmac(key, `${method}\n${subject}\n${exp}`);
  return {
    url: `${origin}/v1/files/${fileId}/content?${width ? `w=${width}&` : ""}exp=${exp}&sig=${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export async function verifyFileLink(key: string, method: "PUT" | "GET", fileId: string, exp: string | undefined, sig: string | undefined, now = Date.now(), width?: number) {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < now) return false;
  const subject = width ? `${fileId}@${width}` : fileId;
  return safeEqual(await hmac(key, `${method}\n${subject}\n${exp}`), sig);
}
