// Collectors (Site 3.0 stage 6, D-163…D-168): what decides who sees a work during first look, the certificate
// number, and the emails a collector or follower gets. Staging never emails a real collector or follower (D-167).
import type { SiteProfile } from "@studio/core";
import type { z } from "zod";
import { type Mail, sendMail } from "../auth/mail";
import type { Env } from "../env";
import { studioInbox } from "./site-mail";

type Row = Record<string, unknown>;

/** SQLite's now, in the same ISO form the app writes, so text comparison orders by time. */
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
/**
 * The public site shows a work only once its first look is over (D-165). Every public query adds this; `alias` is the
 * artworks table's alias in that query, when it has one.
 */
export const live = (alias = "") => `(${alias}public_from IS NULL OR ${alias}public_from <= ${NOW_SQL})`;
/** A public work still in first look. */
export const inFirstLook = (alias = "") => `(${alias}public_from IS NOT NULL AND ${alias}public_from > ${NOW_SQL})`;

export const DEFAULT_FIRST_LOOK_DAYS = 7;
export const collectorSettings = (site: z.infer<typeof SiteProfile>) => ({
  care: site.collectors?.care ?? null,
  firstLookDays: site.collectors?.firstLookDays ?? DEFAULT_FIRST_LOOK_DAYS,
});

/**
 * A work's certificate number (D-166): the studio's initials, the work's year (or the year it was recorded) and six
 * characters of its id. Made from the record, so it never changes and needs no storage.
 */
export function certificateNumber(studioName: string, work: { id: string; year?: number | null; createdAt?: string | null }): string {
  const initials = studioName.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]!.toUpperCase()).join("").slice(0, 4) || "ART";
  const year = work.year ?? (work.createdAt ? Number(work.createdAt.slice(0, 4)) : new Date().getUTCFullYear());
  return `${initials}-${year}-${work.id.slice(-6).toUpperCase()}`;
}

/** First names only on a collector's page: it may be forwarded. */
export const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0]?.slice(0, 60) || "there";

/**
 * Where a collector's or follower's email goes. Production: them. Anywhere else: the studio's own inbox, marked TEST,
 * so a test never reaches a real person (D-167).
 */
async function recipients(env: Env, studioId: string, to: string): Promise<{ to: string[]; test: boolean }> {
  if (env.ENVIRONMENT === "production") return { to: [to], test: false };
  return { to: await studioInbox(env, studioId), test: true };
}

const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, " ").trim();

export async function sendCollectorInvite(env: Env, studioId: string, i: { to: string; name: string; studioName: string; url: string; note?: string | null }) {
  const r = await recipients(env, studioId, i.to);
  const lines = [
    ...(r.test ? [`TEST: on the live site this goes to ${i.to}.`, ""] : []),
    `Hello ${firstName(i.name)},`,
    "",
    `${i.studioName} made you a page of your own: the works you own, their certificates, how to care for them, and a first look at new work before it reaches the public site.`,
    "",
    i.url,
    "",
    ...(i.note ? [i.note, ""] : []),
    "The link is yours alone. Keep it, and don't share it.",
  ];
  const mail: Mail = { to: r.to, subject: `${r.test ? "TEST: " : ""}${oneLine(i.studioName)}: your collection`, text: lines.join("\n") };
  return sendMail(env, mail);
}

export async function sendFirstLook(env: Env, studioId: string, i: { to: string; studioName: string; works: Row[]; url: string; stopUrl: string | null }) {
  const r = await recipients(env, studioId, i.to);
  const lines = [
    ...(r.test ? [`TEST: on the live site this goes to ${i.to}.`, ""] : []),
    `New work from ${i.studioName}, before it reaches the public site:`,
    "",
    ...i.works.map((w) => `- ${oneLine(String(w.title))}`),
    "",
    `See them: ${i.url}`,
    ...(i.stopUrl ? ["", `Stop these emails: ${i.stopUrl}`] : []),
  ];
  return sendMail(env, { to: r.to, subject: `${r.test ? "TEST: " : ""}First look: new work from ${oneLine(i.studioName)}`, text: lines.join("\n") });
}

/** The code a would-be follower types; on staging it goes to the studio's inbox like every follower email (D-167). */
export async function sendFollowCode(env: Env, studioId: string, i: { to: string; studioName: string; code: string }) {
  if (!env.RESEND_API_KEY && env.ENVIRONMENT === "dev") {
    console.log(`[dev] follow code for ${i.to}: ${i.code}`);
    return true;
  }
  const r = await recipients(env, studioId, i.to);
  return sendMail(env, {
    to: r.to,
    subject: `${r.test ? "TEST: " : ""}Your code to follow ${oneLine(i.studioName)}`,
    text: [
      ...(r.test ? [`TEST: on the live site this goes to ${i.to}.`, ""] : []),
      `Your code is ${i.code}`,
      "",
      "It expires in 15 minutes. If you didn't ask for it, ignore this email.",
    ].join("\n"),
  });
}
