// Error alerts (card H, D-178). Failures are counted per studio and UTC day (a count only; the details stay in the
// Workers' logs), and once a day the studio hears about yesterday's, at most one email. Outside production the email
// is marked TEST, like every other studio email there (D-167).
import type { Env } from "../env";
import { sendMail } from "../auth/mail";
import { siteFor, studioInbox } from "./site-mail";
import { utcDay } from "./counts";

export type ErrorKind = "server" | "webhook" | "assistant";

/** Add one to the day's count. Never throws: an error while noting an error must not hide the first one. */
export async function noteError(db: D1Database, kind: ErrorKind, studioId = "", day = utcDay()): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO error_counts (studio_id, day, kind, n) VALUES (?, ?, ?, 1)
       ON CONFLICT(studio_id, day, kind) DO UPDATE SET n = n + 1`,
    ).bind(studioId, day, kind).run();
  } catch (e) {
    console.error("noting an error failed", kind, e);
  }
}

const WORDS: Record<ErrorKind, [string, string]> = {
  server: ["time the studio's server hit an error", "times the studio's server hit an error"],
  webhook: ["card-payment message from Square that failed", "card-payment messages from Square that failed"],
  assistant: ["assistant answer that didn't come through", "assistant answers that didn't come through"],
};

/** Yesterday's failures (UTC), one email per studio that had any, at most once a day. Returns the emails sent. */
export async function alertErrors(env: Env, now = new Date().toISOString()): Promise<number> {
  const day = utcDay(new Date(Date.parse(now) - 86_400_000));
  const { results } = await env.DB.prepare(
    "SELECT studio_id, kind, n FROM error_counts WHERE day = ? AND n > 0 ORDER BY studio_id, kind",
  ).bind(day).all<{ studio_id: string; kind: ErrorKind; n: number }>();
  const byStudio = new Map<string, { kind: ErrorKind; n: number }[]>();
  for (const r of results) byStudio.set(r.studio_id, [...(byStudio.get(r.studio_id) ?? []), { kind: r.kind, n: Number(r.n) }]);
  const test = env.ENVIRONMENT !== "production";
  let sent = 0;
  for (const [studioId, kinds] of byStudio) {
    const claimed = await env.DB.prepare("INSERT OR IGNORE INTO error_alerts (studio_id, day, sent_at) VALUES (?, ?, ?)")
      .bind(studioId, day, now).run();
    if (claimed.meta.changes !== 1) continue; // already told today
    let to: string[];
    let name = env.STUDIO_NAME || "Your studio";
    if (studioId) {
      const s = await siteFor(env, studioId).catch(() => null);
      if (s?.name) name = s.name;
      to = await studioInbox(env, studioId, s?.site);
    } else {
      to = (env.OWNER_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
    }
    if (!to.length) continue;
    const lines = [
      ...(test ? ["TEST: this is not the live site.", ""] : []),
      `Yesterday (${day}, UTC) something went wrong on your site:`,
      ...kinds.map((k) => `- ${k.n} ${WORDS[k.kind][k.n === 1 ? 0 : 1]}`),
      "",
      "Nothing is needed from you unless it keeps happening. Visitors saw a short \"please try again\" message, and the",
      "details are in the logs of your Workers in Cloudflare (Workers & Pages → studio-api or studio-assistant → Logs).",
      "You get this email at most once a day, and only on a day with errors.",
    ];
    if (await sendMail(env, { to, subject: `${test ? "TEST: " : ""}${name}: errors on your site yesterday`, text: lines.join("\n") })) sent++;
  }
  return sent;
}
