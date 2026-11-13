// studio-api's scheduled work (Site 3.0 stage 3, D-137): it has the database and the mail key, and none of this needs
// a model. Hourly: holds whose 48 hours ended, and unpaid orders
// whose time ended (D-144), go back on sale. Once a day: each studio whose site had chats or leads
// gets one summary email.
import { getAction, runAction } from "./actions/runner";
import type { Actor, Env } from "./env";
import { sendMail } from "./auth/mail";
import { assistantSettings, money, siteFor, studioInbox } from "./lib/site-mail";
import { nowIso } from "./lib/time";
import { alertErrors } from "./lib/error-alerts";
import { expireOrders } from "./routes/orders";

/** wrangler.jsonc → triggers.crons. */
export const HOURLY = "7 * * * *";
export const DAILY = "23 15 * * *"; // 15:23 UTC: early morning in the US

type Row = Record<string, unknown>;

/** The studio's own scheduled work: an owner-level actor that is no one, logged as the system. */
const systemActor = (studioId: string): Actor => ({
  userId: "system", email: "", name: null, sessionId: null, studioId, role: "owner", clientId: null,
});

export async function expireHolds(env: Env, now = nowIso()): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id, studio_id FROM leads WHERE status = 'held' AND expires_at <= ? AND deleted_at IS NULL LIMIT 200",
  ).bind(now).all<{ id: string; studio_id: string }>();
  let n = 0;
  for (const l of results) {
    try {
      const r = await runAction(getAction("lead.expire_hold") as never, { id: l.id }, { env, actor: systemActor(l.studio_id), origin: "https://studio-api", source: "system" });
      if (r.activityIds.length) n++;
    } catch (e) {
      console.error("hold expiry failed", l.id, e);
    }
  }
  return n;
}

/** One email per studio about the last 24 hours of its site's chats and leads. Studios with nothing get nothing. */
export async function dailySummaries(env: Env, now = nowIso()): Promise<number> {
  const since = new Date(Date.parse(now) - 86_400_000).toISOString();
  const { results: studios } = await env.DB.prepare(
    `SELECT studio_id FROM visitor_messages WHERE created_at > ? UNION SELECT studio_id FROM leads WHERE created_at > ?`,
  ).bind(since, since).all<{ studio_id: string }>();
  let sent = 0;
  for (const { studio_id: studioId } of studios) {
    const { site, name } = await siteFor(env, studioId);
    const msgs = (await env.DB.prepare(
      `SELECT thread_id, role, text, meta, created_at FROM visitor_messages WHERE studio_id = ? AND created_at > ? ORDER BY created_at, id LIMIT 2000`,
    ).bind(studioId, since).all<Row>()).results;
    const leads = (await env.DB.prepare(
      "SELECT kind, name, email, phone, artwork_ids FROM leads WHERE studio_id = ? AND created_at > ? AND deleted_at IS NULL ORDER BY created_at",
    ).bind(studioId, since).all<Row>()).results;
    const chats = new Set(msgs.map((m) => m.thread_id)).size;
    const questions = msgs.filter((m) => m.role === "user").length;
    // A question it handed to the artist: the visitor's message just before such a reply.
    const unanswered: string[] = [];
    msgs.forEach((m, i) => {
      const meta = (() => { try { return JSON.parse(String(m.meta)) as Row; } catch { return {}; } })();
      const prev = msgs[i - 1];
      if (m.role === "assistant" && meta.askArtist && prev?.role === "user" && prev.thread_id === m.thread_id) unanswered.push(String(prev.text));
    });
    const origin = msgs.map((m) => { try { return (JSON.parse(String(m.meta)) as Row).origin as string | undefined; } catch { return undefined; } }).filter(Boolean).at(-1);
    const usage = await env.DB.prepare("SELECT cost_millicents FROM assistant_usage WHERE studio_id = ? AND month = ?").bind(studioId, now.slice(0, 7)).first<number>("cost_millicents");
    const lines = [
      `Your site's assistant, the last 24 hours: ${chats} chat${chats === 1 ? "" : "s"}, ${questions} question${questions === 1 ? "" : "s"}, ${leads.length} lead${leads.length === 1 ? "" : "s"}.`,
    ];
    if (leads.length) {
      lines.push("", "Leads:");
      for (const l of leads) {
        const n = (() => { try { return (JSON.parse(String(l.artwork_ids)) as unknown[]).length; } catch { return 0; } })();
        lines.push(`- ${l.kind === "hold" ? "Hold request" : "Inquiry"} from ${l.name || l.email || l.phone || "a visitor"}${n ? ` (${n} piece${n === 1 ? "" : "s"})` : ""}`);
      }
    }
    if (unanswered.length) {
      lines.push("", "Questions it handed to you (it offered Text, Email and Call):");
      for (const q of unanswered.slice(0, 20)) lines.push(`- ${q.slice(0, 300)}`);
    }
    lines.push("", `This month it has cost ${money(Math.round(Number(usage ?? 0) / 1000), "USD")} of your ${money(assistantSettings(site).budgetCents, "USD")} budget.`);
    if (origin) lines.push(`Leads screen: ${origin}/studio/leads`);
    if (await sendMail(env, { to: await studioInbox(env, studioId, site), subject: `${name}: your site today`, text: lines.join("\n") })) sent++;
  }
  return sent;
}

/**
 * Works whose first look ended since the last run (D-165) reach the public site: each such studio's catalogue version
 * moves on, so its cached pages are made again. The window overlaps the hour so a late run misses nothing.
 */
export async function endFirstLooks(env: Env, now = nowIso()): Promise<number> {
  const since = new Date(Date.parse(now) - 65 * 60_000).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT studio_id FROM artworks WHERE public_from > ? AND public_from <= ? AND public = 1 AND deleted_at IS NULL LIMIT 500",
  ).bind(since, now).all<{ studio_id: string }>();
  let n = 0;
  for (const { studio_id: studioId } of results) {
    try {
      await runAction(getAction("first_look.ended") as never, {}, { env, actor: systemActor(studioId), origin: "https://studio-api", source: "system" });
      n++;
    } catch (e) {
      console.error("first look end failed", studioId, e);
    }
  }
  return n;
}

export async function scheduled(event: { cron: string; scheduledTime?: number }, env: Env): Promise<void> {
  await expireHolds(env);
  await expireOrders(env);
  await endFirstLooks(env);
  if (event.cron === DAILY) {
    await dailySummaries(env);
    await alertErrors(env);
  }
}
