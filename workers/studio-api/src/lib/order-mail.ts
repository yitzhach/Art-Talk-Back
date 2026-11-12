// Order emails (Site 3.0 stage 4, D-144): to the buyer and to the studio. Card buyers also get Square's own receipt.
import { type Mail, sendMail } from "../auth/mail";
import type { Env } from "../env";
import { money, siteFor, studioInbox } from "./site-mail";

type Row = Record<string, unknown>;
const line = (s: unknown) => String(s ?? "").replace(/[\r\n\t]+/g, " ").slice(0, 200);
const how = (m: unknown) => (m === "card" ? "card" : m === "venmo" ? "Venmo" : "Zelle");
const total = (o: Row) => Number(o.amountCents) + Number(o.shippingCents ?? 0) + Number(o.taxCents ?? 0);
const until = (iso: unknown, tz: string) =>
  new Date(String(iso)).toLocaleString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
const address = (a: unknown) => {
  const x = (a ?? null) as Row | null;
  return x ? [x.line1, x.line2, `${x.city ?? ""}, ${x.state ?? ""} ${x.postalCode ?? ""}`.trim()].filter(Boolean).map(line).join("\n") : "";
};

export type OrderEvent = "placed" | "paid" | "conflict" | "shipped";

/** The emails one order event sends: the buyer's and the studio's (either may be absent). */
export function orderMails(e: OrderEvent, o: Row, ctx: { title: string; studioName: string; origin: string; tz: string; venmo: string | null; zelle: string | null; studio: string[] }): Mail[] {
  const mails: Mail[] = [];
  const title = line(ctx.title);
  const sum = `${title}: ${money(total(o), o.currency as string)} (${money(o.amountCents as number, o.currency as string)}${Number(o.shippingCents) ? ` + ${money(o.shippingCents as number, o.currency as string)} shipping` : ""}${Number(o.taxCents) ? ` + ${money(o.taxCents as number, o.currency as string)} tax` : ""})`;
  const buyer = o.buyerEmail ? [o.buyerEmail as string] : [];
  const who = line(o.buyerName || o.buyerEmail || "A buyer");
  const ordersScreen = `${ctx.origin}/studio/orders`;
  const thanks = `${ctx.origin}/thanks/${o.id}`;

  if (e === "placed" && o.method !== "card") {
    const to = o.method === "venmo" ? `Venmo ${ctx.venmo}` : `Zelle ${ctx.zelle}`;
    if (buyer.length) mails.push({
      to: buyer, replyTo: ctx.studio[0],
      subject: `Your order ${o.code} from ${line(ctx.studioName)}: how to pay`,
      text: [
        `Thank you. ${title} is set aside for you until ${until(o.expiresAt, ctx.tz)}.`,
        `To pay, send ${money(total(o), o.currency as string)} by ${to}, with ${o.code} in the note.`,
        `${line(ctx.studioName)} will email you when the payment arrives, and again when the piece ships.`,
        `Your order: ${thanks}`,
      ].join("\n\n"),
    });
    mails.push({
      to: ctx.studio, replyTo: (o.buyerEmail as string | null) ?? undefined,
      subject: `New ${how(o.method)} order ${o.code}: ${title} — ${who}`,
      text: [
        `${who} is buying ${sum} by ${how(o.method)}. The piece is set aside until ${until(o.expiresAt, ctx.tz)}.`,
        `When ${money(total(o), o.currency as string)} with ${o.code} in the note arrives, tap Mark paid on the Orders screen. Nothing sells until you do.`,
        [o.buyerName && `Name: ${line(o.buyerName)}`, o.buyerEmail && `Email: ${line(o.buyerEmail)}`, o.buyerPhone && `Phone: ${line(o.buyerPhone)}`].filter(Boolean).join("\n"),
        `Ship to:\n${address(o.shippingAddress)}`,
        `Orders screen: ${ordersScreen}`,
      ].join("\n\n"),
    });
  }
  if (e === "paid") {
    if (buyer.length) mails.push({
      to: buyer, replyTo: ctx.studio[0],
      subject: `Paid: your order ${o.code} from ${line(ctx.studioName)}`,
      text: [`Thank you. Your payment for ${sum} arrived, and the piece is yours.`, `${line(ctx.studioName)} will email you when it ships.`, `Your order: ${thanks}`].join("\n\n"),
    });
    mails.push({
      to: ctx.studio, replyTo: (o.buyerEmail as string | null) ?? undefined,
      subject: `Sold on your site: ${title} — order ${o.code}`,
      text: [
        `${who} paid ${money(Number(o.paidCents ?? total(o)), o.currency as string)} by ${how(o.method)} for ${title}. It's marked sold, with a sale and the client recorded.`,
        o.shippingAddress ? `Ship to:\n${line(o.buyerName)}\n${address(o.shippingAddress)}` : "",
        `When it ships, add the tracking number on the Orders screen: ${ordersScreen}`,
      ].filter(Boolean).join("\n\n"),
    });
  }
  if (e === "conflict") {
    mails.push({
      to: ctx.studio, replyTo: (o.buyerEmail as string | null) ?? undefined,
      subject: `Check order ${o.code}: paid for a piece that's no longer available`,
      text: [
        `${who} paid by ${how(o.method)} for ${title}, but it had already sold or was set aside for someone else, so nothing was sold twice.`,
        "Refund them, or offer them another piece. The order is on the Orders screen, marked to check.",
        `Orders screen: ${ordersScreen}`,
      ].join("\n\n"),
    });
  }
  if (e === "shipped" && buyer.length) {
    mails.push({
      to: buyer, replyTo: ctx.studio[0],
      subject: `Shipped: your order ${o.code} from ${line(ctx.studioName)}`,
      text: [`${title} is on its way.`, `Carrier: ${line(o.carrier)}\nTracking: ${line(o.tracking)}`, `Your order: ${thanks}`].join("\n\n"),
    });
  }
  return mails;
}

export async function sendOrderMail(env: Env, e: OrderEvent, o: Row, title: string, origin: string) {
  const { site, name, timezone } = await siteFor(env, o.studioId as string);
  const studio = await studioInbox(env, o.studioId as string, site);
  const c = site.checkout ?? {};
  const mails = orderMails(e, o, { title, studioName: name, origin, tz: timezone, venmo: c.venmo ?? null, zelle: c.zelle ?? null, studio });
  await Promise.all(mails.filter((m) => m.to.length).map((m) => sendMail(env, m)));
}
