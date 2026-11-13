// Limits on the codes a public site emails (card S, D-179). Each address already gets at most 5 codes an hour
// (D-049); this also limits one sender and the whole studio, so the "follow" and "keep this chat" forms can't be
// used to email strangers in bulk. The sender is a keyed hash of their internet address, never the address itself.
import type { Env } from "../env";
import { HttpError } from "./errors";
import { sha256 } from "./crypto";

/** Codes one internet address may have sent in an hour, across both forms and any email addresses. */
export const CODES_PER_SENDER_HOUR = 6;
/** Codes a studio's site may send in an hour in all. */
export const CODES_PER_STUDIO_HOUR = 60;

/** A keyed hash: without the server's key it can't be matched to an address by trying them all. */
export const keyedIpHash = (env: Pick<Env, "SIGNING_KEY">, ip: string | null | undefined) =>
  sha256(`ip\n${env.SIGNING_KEY ?? ""}\n${ip ?? "unknown"}`);

/** Throws rate_limited past either limit; otherwise records this send. */
export async function claimCodeSend(env: Env, studioId: string, ip: string | null | undefined, now = new Date()): Promise<void> {
  const ih = await keyedIpHash(env, ip);
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const row = await env.DB.prepare(
    "SELECT count(*) AS studio, sum(ip_hash = ?) AS mine FROM code_sends WHERE studio_id = ? AND sent_at > ?",
  ).bind(ih, studioId, since).first<{ studio: number; mine: number | null }>();
  if (Number(row?.mine ?? 0) >= CODES_PER_SENDER_HOUR) throw new HttpError("rate_limited", "That's a lot of codes from here. Try again in an hour.");
  if (Number(row?.studio ?? 0) >= CODES_PER_STUDIO_HOUR) throw new HttpError("rate_limited", "The site is sending a lot of codes just now. Try again in an hour.");
  await env.DB.prepare("INSERT INTO code_sends (studio_id, ip_hash, sent_at) VALUES (?, ?, ?)").bind(studioId, ih, now.toISOString()).run();
}
