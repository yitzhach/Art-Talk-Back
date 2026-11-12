// What the visitor assistant and the site's leads tell the artist by email (D-129, D-136, D-137, D-138), and the
// studio's assistant settings with their defaults. Text emails only, through Resend like the sign-in code.
import { SiteAssistant, SiteProfile } from "@studio/core";
import type { z } from "zod";
import { type Mail, sendMail } from "../auth/mail";
import type { Env } from "../env";

type Row = Record<string, unknown>;
const parse = <T>(v: unknown, fallback: T): T => {
  try { return typeof v === "string" ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};

export const DEFAULT_BUDGET_CENTS = 1000;

/** The studio's site profile as stored, or an empty one. */
export async function siteFor(env: Env, studioId: string): Promise<{ site: z.infer<typeof SiteProfile>; name: string; timezone: string }> {
  const row = await env.DB.prepare(
    `SELECT s.meta, s.timezone, st.name FROM studio_settings s JOIN studios st ON st.id = s.studio_id
     WHERE s.studio_id = ? AND s.deleted_at IS NULL`,
  ).bind(studioId).first<Row>();
  const ok = SiteProfile.safeParse(parse<Row>(row?.meta, {}).site ?? {});
  const site = ok.success ? ok.data : {};
  return { site, name: site.name ?? (row?.name as string | undefined) ?? "the studio", timezone: (row?.timezone as string | undefined) ?? "America/New_York" };
}

export interface AssistantSettings {
  enabled: boolean;
  artistName: string;
  greeting: string;
  suggestions: string[];
  replyTime: string | null;
  budgetCents: number;
  answers: NonNullable<z.infer<typeof SiteAssistant>["answers"]>;
}

/** The assistant's settings with defaults filled in. Answers have no defaults: an unset topic goes to the artist. */
export function assistantSettings(site: z.infer<typeof SiteProfile>): AssistantSettings {
  const a = site.assistant ?? {};
  return {
    enabled: a.enabled !== false,
    artistName: a.artistName ?? "the artist",
    greeting: a.greeting ?? "I'm the studio's assistant, an AI. Ask about any piece, size, colour or commission.",
    suggestions: a.suggestions ?? ["What's available now?", "Something blue for a living room", "How do commissions work?"],
    replyTime: a.replyTime ?? null,
    budgetCents: a.budgetCents ?? DEFAULT_BUDGET_CENTS,
    answers: a.answers ?? {},
  };
}

/** Where the studio's mail goes: the site's email, else its owners' sign-in emails. */
export async function studioInbox(env: Env, studioId: string, site?: z.infer<typeof SiteProfile>): Promise<string[]> {
  const s = site ?? (await siteFor(env, studioId)).site;
  if (s.email) return [s.email];
  const { results } = await env.DB.prepare(
    `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.studio_id = ? AND m.role = 'owner' AND m.deleted_at IS NULL LIMIT 5`,
  ).bind(studioId).all<{ email: string }>();
  return results.map((r) => r.email).filter(Boolean);
}

export const money = (cents: number | null | undefined, currency: string | null | undefined) =>
  cents === null || cents === undefined ? "price on request"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

const size = (w: Row) => {
  const dims = [w.width, w.height, w.depth].filter((x) => x !== null && x !== undefined);
  return dims.length ? `${dims.join(" × ")} ${w.size_unit ?? "in"}` : "";
};

export interface LeadMailInput {
  kind: "inquiry" | "hold";
  name: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
  works: Row[];
  origin: string;
  chat: { role: string; text: string }[];
  pictures: { filename: string; content: string }[];
  morePictures: number;
  studioName: string;
}

/** One email per lead, at once (D-129). Reply goes to the visitor. */
export function leadMail(to: string[], l: LeadMailInput): Mail {
  // The visitor's own words: one line, never a header break.
  const who = (l.name || l.email || l.phone || "A visitor").replace(/[\r\n\t]+/g, " ").slice(0, 120);
  const subject = l.kind === "hold"
    ? `Hold request: ${String(l.works[0]?.title ?? "a piece").replace(/[\r\n]+/g, " ")} — ${who}`
    : `New inquiry from your site — ${who}${l.works.length ? ` (${l.works.length} piece${l.works.length === 1 ? "" : "s"})` : ""}`;
  const lines = [
    l.kind === "hold"
      ? `${who} asks you to hold this piece for 48 hours. Nothing is reserved until you tap Approve hold on the Leads screen.`
      : `${who} sent an inquiry from your site.`,
    "",
    [l.name && `Name: ${l.name}`, l.email && `Email: ${l.email}`, l.phone && `Phone: ${l.phone}`].filter(Boolean).join("\n"),
  ];
  if (l.works.length) {
    lines.push("", `Pieces (${l.works.length}):`);
    for (const w of l.works) {
      const priced = w.status === "available" ? money(w.price_cents as number | null, w.currency as string | null) : String(w.status).replace(/_/g, " ");
      lines.push(`- ${w.title}${size(w) ? ` — ${size(w)}` : ""} — ${priced} — ${l.origin}/works/${w.slug}`);
    }
  }
  if (l.note) lines.push("", "Their note:", l.note);
  if (l.pictures.length || l.morePictures) {
    lines.push("", `Pictures: ${l.pictures.length} attached${l.morePictures ? `, ${l.morePictures} more on the Leads screen` : ""} (hidden data removed).`);
  }
  if (l.chat.length) {
    lines.push("", "From their chat with the assistant:");
    for (const m of l.chat.slice(-10)) lines.push(`${m.role === "user" ? "Them" : "Assistant"}: ${m.text}`);
  }
  lines.push("", `${l.email ? "Reply to this email to answer them. " : ""}Leads screen: ${l.origin}/studio/leads`);
  return { to, subject, text: lines.join("\n"), replyTo: l.email ?? undefined, attachments: l.pictures };
}

export async function sendLeadMail(env: Env, studioId: string, l: LeadMailInput) {
  return sendMail(env, leadMail(await studioInbox(env, studioId), l));
}

/** Once a month, when the chat reaches the budget (D-130). */
export async function sendCapMail(env: Env, studioId: string, budgetCents: number, origin: string | null) {
  const { site, name } = await siteFor(env, studioId);
  return sendMail(env, {
    to: await studioInbox(env, studioId, site),
    subject: `${name}: the site's assistant reached this month's budget`,
    text: [
      `The site's AI assistant has used this month's budget of ${money(budgetCents, "USD")}.`,
      "Until the month ends, the chat shows plain search of your works and the Text, Email and Call buttons instead of answers.",
      `To raise the budget: your studio → Site → Assistant → Monthly budget${origin ? ` (${origin}/studio/site)` : ""}.`,
    ].join("\n\n"),
  });
}
