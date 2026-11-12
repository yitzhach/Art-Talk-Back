// Buying from the site (Site 3.0 stage 4, D-144). A visitor's order reserves one piece: by card it waits 30 minutes for
// Square's checkout, by Venmo or Zelle it waits (48 hours by default) for the owner's Mark paid. Only two things sell:
// Square's signed webhook (order.paid, run by routes/orders.ts) and the owner's tap (order.mark_paid). Both take the
// same path: the order paid, the piece sold, a sales row, the client matched or made, a held piece's lead done.
import { Id, MarkPaidInput, OrderMethod, ShipInput, ShippingAddress, SiteCheckout, SiteProfile, Slug, db as schema, newId } from "@studio/core";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { HttpError } from "../lib/errors";
import {
  type EntityDef, artworkEntity, bumpCatalogue, checkVersion, clientEntity, defineEntity, findRecord, getRecord, insertWrite, saleEntity,
  updateWrite,
} from "./records";
import { type ActionCtx, type Snapshot, type Write, defineAction, rawSql } from "./runner";
import { leadEntity, publicWorksBySlug } from "./visitors";

type Row = Record<string, unknown>;
const recordDefaults = { createdBy: null, deletedAt: null, meta: {}, version: 1, actorType: "user" };

export const orderEntity: EntityDef = defineEntity({
  type: "order", table: schema.orders, key: schema.orders.id, studio: schema.orders.studioId,
  version: schema.orders.version, deletedAt: schema.orders.deletedAt, perm: "sales",
  defaults: {
    ...recordDefaults, kind: "piece", status: "pending", artworkId: null, leadId: null, clientId: null, visitorId: null,
    shippingCents: 0, taxCents: 0, paidCents: null, currency: "USD", squareLinkId: null, squareOrderId: null,
    squarePaymentId: null, checkoutUrl: null, buyerName: null, buyerEmail: null, buyerPhone: null, shippingAddress: null,
    expiresAt: null, paidAt: null, shippedAt: null, carrier: null, tracking: null,
  },
});

/** A card order waits this long for Square's checkout (D-144). */
export const CARD_MINUTES = 30;
export const ORDERS_PER_VISITOR_PER_DAY = 6;

export interface Checkout {
  enabled: boolean;
  card: boolean;
  venmo: string | null;
  zelle: string | null;
  shippingCents: number;
  smallMaxInches: number;
  returns: string | null;
  taxBps: number;
  manualHoldHours: number;
}

/** The studio's checkout settings with defaults filled in. Off unless the owner turned it on. */
export function checkoutSettings(site: z.infer<typeof SiteProfile>): Checkout {
  const c: z.infer<typeof SiteCheckout> = site.checkout ?? {};
  return {
    enabled: c.enabled === true, card: c.card !== false, venmo: c.venmo ?? null, zelle: c.zelle ?? null,
    shippingCents: c.shippingCents ?? 0, smallMaxInches: c.smallMaxInches ?? 36, returns: c.returns ?? null,
    taxBps: c.taxBps ?? 0, manualHoldHours: c.manualHoldHours ?? 48,
  };
}

/** The ways to pay this studio offers now. Card also needs the platform's Square credentials for this studio. */
export function methodsOf(c: Checkout, cardReady: boolean): z.infer<typeof OrderMethod>[] {
  if (!c.enabled) return [];
  return [...(c.card && cardReady ? ["card" as const] : []), ...(c.venmo ? ["venmo" as const] : []), ...(c.zelle ? ["zelle" as const] : [])];
}

/** The piece's longest side in inches, or null when its size isn't recorded. */
export function longestInches(w: Row): number | null {
  const dims = [w.width, w.height, w.depth].map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!dims.length) return null;
  const max = Math.max(...dims);
  return (w.size_unit ?? w.sizeUnit) === "cm" ? max / 2.54 : max;
}

/** Why this public work can't be bought online, or null when it can. Large and unsized works ship by quote (D-102). */
export function notBuyable(w: Row, c: Checkout): string | null {
  const price = (w.price_cents ?? w.priceCents) as number | null;
  if (price === null || price === undefined || price <= 0) return "This piece has no listed price. Send an inquiry instead.";
  const long = longestInches(w);
  if (long === null || long > c.smallMaxInches) return "This piece ships by quote. Send an inquiry and the artist will reply with shipping.";
  return null;
}

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const orderCode = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
const later = (now: string, ms: number) => new Date(Date.parse(now) + ms).toISOString();

async function artworkOf(ctx: ActionCtx, id: string | null): Promise<Snapshot | null> {
  return id ? findRecord(ctx.db, artworkEntity, ctx.actor.studioId, id) : null;
}

/** The piece goes back to what it was before this order: on hold if its hold still runs, else on sale. */
async function release(ctx: ActionCtx, order: Snapshot): Promise<Write[]> {
  const work = await artworkOf(ctx, order.artworkId as string | null);
  const meta = (work?.meta ?? {}) as Row;
  if (!work || work.status !== "reserved" || (meta.order as Row | undefined)?.orderId !== order.id) return [];
  const { order: _o, ...rest } = meta;
  const hold = rest.hold as { until?: string } | undefined;
  const status = hold?.until && hold.until > ctx.now ? "reserved" : "available";
  if (status === "available") delete rest.hold;
  return [updateWrite(ctx, artworkEntity, work, { status, meta: rest }), bumpCatalogue(ctx)];
}

/** The same client a lead would match (D-138): same email; else a new one. */
async function clientFor(ctx: ActionCtx, name: string | null, email: string | null, phone: string | null): Promise<{ id: string | null; writes: Write[] }> {
  if (!email) return { id: null, writes: [] };
  const match = await ctx.env.DB.prepare("SELECT id FROM clients WHERE studio_id = ? AND deleted_at IS NULL AND lower(email) = ? ORDER BY created_at LIMIT 1")
    .bind(ctx.actor.studioId, email.toLowerCase()).first<{ id: string }>();
  if (match) return { id: match.id, writes: [] };
  const id = newId();
  return {
    id,
    writes: [insertWrite(ctx, clientEntity, {
      id, name: name || email, email: email.toLowerCase(), phone, notes: "Bought from the website", meta: { from: "site" },
    })],
  };
}

interface Payment { paidCents: number; paymentId: string | null; buyerName?: string | null; buyerEmail?: string | null; buyerPhone?: string | null; address?: Row | null; note?: string | null }

/**
 * Sells the order's piece. If the piece already sold another way (or is held for someone else), nothing sells twice:
 * the order is marked paid with a conflict for the owner to refund.
 */
async function sell(ctx: ActionCtx, order: Snapshot, p: Payment): Promise<Write[]> {
  const buyerName = (order.buyerName as string | null) ?? p.buyerName ?? null;
  const buyerEmail = ((order.buyerEmail as string | null) ?? p.buyerEmail ?? null)?.toLowerCase() ?? null;
  const buyerPhone = (order.buyerPhone as string | null) ?? p.buyerPhone ?? null;
  const paid = {
    status: "paid", paidCents: p.paidCents, paidAt: ctx.now, squarePaymentId: p.paymentId ?? order.squarePaymentId ?? null,
    buyerName, buyerEmail, buyerPhone, shippingAddress: (order.shippingAddress as Row | null) ?? p.address ?? null,
  };
  const work = await artworkOf(ctx, order.artworkId as string | null);
  const meta = (work?.meta ?? {}) as Row;
  const mine = work && (
    work.status === "available"
    || (work.status === "reserved" && (meta.order as Row | undefined)?.orderId === order.id)
    || (work.status === "reserved" && !meta.order && !!order.leadId && (meta.hold as Row | undefined)?.leadId === order.leadId)
  );
  if (!work || !mine) {
    return [updateWrite(ctx, orderEntity, order, { ...paid, meta: { ...(order.meta as Row), conflict: true, ...(p.note ? { note: p.note } : {}) } })];
  }
  const client = await clientFor(ctx, buyerName, buyerEmail, buyerPhone);
  const { order: _o, hold, ...rest } = meta;
  const writes: Write[] = [...client.writes];
  writes.push(updateWrite(ctx, artworkEntity, work, {
    status: "sold",
    meta: { ...rest, sale: { priceCents: order.amountCents, currency: order.currency, clientId: client.id, showId: null, soldAt: ctx.now, orderId: order.id } },
  }));
  writes.push(bumpCatalogue(ctx));
  const how = order.method === "card" ? "card" : order.method === "venmo" ? "Venmo" : "Zelle";
  writes.push(insertWrite(ctx, saleEntity, {
    id: newId(), artworkId: work.id, title: work.title, priceCents: order.amountCents, currency: order.currency,
    soldOn: ctx.now.slice(0, 10), paymentMethod: order.method === "card" ? "card" : "other",
    source: order.method === "card" ? "square" : "manual", externalId: p.paymentId ?? null,
    notes: `Website order ${order.code} (${how})${p.note ? `: ${p.note}` : ""}`, medium: work.medium ?? null,
    meta: { orderId: order.id },
  }));
  const leadId = (order.leadId as string | null) ?? ((hold as Row | undefined)?.leadId as string | undefined) ?? null;
  if (leadId) {
    const lead = await findRecord(ctx.db, leadEntity, ctx.actor.studioId, leadId);
    if (lead && lead.status !== "closed") writes.push(updateWrite(ctx, leadEntity, lead, { status: "closed" }));
  }
  writes.push(updateWrite(ctx, orderEntity, order, { ...paid, clientId: client.id, ...(p.note ? { meta: { ...(order.meta as Row), note: p.note } } : {}) }));
  return writes;
}

/** Square's event, recorded once (a repeat delivery is a no-op anyway: the order is already paid). */
const seen = (ctx: ActionCtx, eventId: string, orderId: string, type: string): Write => ({
  query: rawSql("INSERT OR IGNORE INTO payment_events (id, studio_id, order_id, type, received_at) VALUES (?, ?, ?, ?, ?)",
    eventId, ctx.actor.studioId, orderId, type, ctx.now),
  expectOne: false,
});

const lastOrder = (_c: ActionCtx, a: (Snapshot | null)[]) => ([...a].reverse().find((s) => !!s && "code" in s && "method" in s) ?? null) as Snapshot | null;

// ------------------------------------------------------------------ the visitor (internal: run by the public routes)

export const orderStart = defineAction({
  name: "order.start",
  description: "A site visitor starts buying a piece: it is set aside while they pay",
  input: z.object({
    visitorId: Id,
    work: Slug,
    method: OrderMethod,
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: ShippingAddress.nullable(),
    cardReady: z.boolean(),
    /** The site the visitor is on, for the links in later emails. */
    origin: z.string().max(200),
  }),
  permission: "site:visitor",
  risk: "auto",
  internal: true,
  plan: async (ctx, input) => {
    const { site } = await (await import("../lib/site-mail")).siteFor(ctx.env, ctx.actor.studioId);
    const c = checkoutSettings(site);
    if (!methodsOf(c, input.cardReady).includes(input.method)) throw new HttpError("bad_request", "That way to pay isn't offered here.");
    const o = schema.orders;
    const [mine] = await ctx.db.select({ n: sql<number>`count(*)` }).from(o).where(and(
      eq(o.studioId, ctx.actor.studioId), eq(o.visitorId, input.visitorId), gt(o.createdAt, later(ctx.now, -86_400_000))));
    if ((mine?.n ?? 0) >= ORDERS_PER_VISITOR_PER_DAY) throw new HttpError("rate_limited", "That's the limit for today. Please text or call instead.");

    const [found] = await publicWorksBySlug(ctx.env, ctx.actor.studioId, [input.work]);
    if (!found) throw new HttpError("not_found", "That piece is no longer on the site.");
    const why = notBuyable(found, c);
    if (why) throw new HttpError("bad_request", why);
    const work = await getRecord(ctx.db, artworkEntity, ctx.actor.studioId, found.id as string);
    const meta = (work.meta ?? {}) as Row;
    let leadId: string | null = null;
    if (work.status === "reserved") {
      const hold = meta.hold as { leadId?: string; until?: string } | undefined;
      const lead = hold?.leadId && !meta.order ? await findRecord(ctx.db, leadEntity, ctx.actor.studioId, hold.leadId) : null;
      if (!lead || lead.visitorId !== input.visitorId || (hold?.until ?? "") <= ctx.now) {
        throw new HttpError("version_conflict", meta.order ? "Someone is buying this piece right now. Please check back soon." : "This piece is on hold for someone.");
      }
      leadId = lead.id as string;
    } else if (work.status !== "available") {
      throw new HttpError("version_conflict", "This piece isn't available any more.");
    }

    const id = newId();
    const manual = input.method !== "card";
    const expiresAt = later(ctx.now, manual ? c.manualHoldHours * 3_600_000 : CARD_MINUTES * 60_000);
    const amountCents = work.priceCents as number;
    return {
      writes: [
        updateWrite(ctx, artworkEntity, work, { status: "reserved", meta: { ...meta, order: { orderId: id, until: expiresAt } } }),
        bumpCatalogue(ctx),
        insertWrite(ctx, orderEntity, {
          id, kind: "piece", method: input.method, status: manual ? "awaiting_payment" : "pending", code: orderCode(),
          artworkId: work.id, leadId, visitorId: input.visitorId, amountCents, shippingCents: c.shippingCents,
          taxCents: Math.round((amountCents * c.taxBps) / 10_000), currency: work.currency ?? "USD",
          buyerName: input.name, buyerEmail: input.email?.toLowerCase() ?? null, buyerPhone: input.phone,
          shippingAddress: input.address, expiresAt, meta: { origin: input.origin },
        }),
      ],
    };
  },
  respond: lastOrder,
});

export const orderAttachLink = defineAction({
  name: "order.attach_link",
  description: "Square made the card order's checkout page",
  input: z.object({ id: Id, linkId: z.string().max(200), squareOrderId: z.string().max(200), url: z.url().max(2000) }),
  permission: "site:visitor",
  risk: "auto",
  internal: true,
  plan: async (ctx, { id, linkId, squareOrderId, url }) => {
    const order = await getRecord(ctx.db, orderEntity, ctx.actor.studioId, id);
    return { writes: [updateWrite(ctx, orderEntity, order, { squareLinkId: linkId, squareOrderId, checkoutUrl: url })] };
  },
  respond: lastOrder,
});

/** Square couldn't make the page: the order ends and the piece goes back at once. */
export const orderAbandon = defineAction({
  name: "order.abandon",
  description: "A card order whose checkout page couldn't be made ends at once",
  input: z.object({ id: Id }),
  permission: "site:visitor",
  risk: "auto",
  internal: true,
  plan: async (ctx, { id }) => {
    const order = await getRecord(ctx.db, orderEntity, ctx.actor.studioId, id);
    if (order.status !== "pending") return { writes: [] };
    return { writes: [...(await release(ctx, order)), updateWrite(ctx, orderEntity, order, { status: "cancelled" })] };
  },
  respond: lastOrder,
});

// ------------------------------------------------------------------ Square (internal: run by the webhook as the system)

export const orderPaid = defineAction({
  name: "order.paid",
  description: "Square says a card order is paid: the piece is sold",
  input: z.object({
    id: Id, eventId: z.string().min(1).max(200), paymentId: z.string().max(200), paidCents: z.number().int().min(0),
    buyerName: z.string().max(200).nullable(), buyerEmail: z.string().max(200).nullable(), buyerPhone: z.string().max(40).nullable(),
    address: z.record(z.string(), z.unknown()).nullable(),
  }),
  permission: "sales:write",
  risk: "auto",
  internal: true,
  plan: async (ctx, input) => {
    const order = await getRecord(ctx.db, orderEntity, ctx.actor.studioId, input.id);
    if (order.status === "paid" || order.status === "refunded") return { writes: [] };
    return { writes: [seen(ctx, input.eventId, order.id as string, "payment"), ...(await sell(ctx, order, input))] };
  },
  respond: lastOrder,
});

export const orderRefunded = defineAction({
  name: "order.refunded",
  description: "Square says a card order was refunded (the piece stays sold until the owner puts it back)",
  input: z.object({ id: Id, eventId: z.string().min(1).max(200) }),
  permission: "sales:write",
  risk: "auto",
  internal: true,
  plan: async (ctx, { id, eventId }) => {
    const order = await getRecord(ctx.db, orderEntity, ctx.actor.studioId, id);
    if (order.status !== "paid") return { writes: [] };
    return { writes: [seen(ctx, eventId, id, "refund"), updateWrite(ctx, orderEntity, order, { status: "refunded" })] };
  },
  respond: lastOrder,
});

export const orderExpire = defineAction({
  name: "order.expire",
  description: "An unpaid order's time ended: the piece goes back",
  input: z.object({ id: Id }),
  permission: "sales:write",
  risk: "auto",
  internal: true,
  plan: async (ctx, { id }) => {
    const order = await getRecord(ctx.db, orderEntity, ctx.actor.studioId, id);
    if ((order.status !== "pending" && order.status !== "awaiting_payment") || !order.expiresAt || (order.expiresAt as string) > ctx.now) return { writes: [] };
    return { writes: [...(await release(ctx, order)), updateWrite(ctx, orderEntity, order, { status: "expired" })] };
  },
  respond: lastOrder,
});

// ------------------------------------------------------------------ the owner

const Versioned = z.object({ id: Id, version: z.number().int().min(1) });

export const orderMarkPaid = defineAction({
  name: "order.mark_paid",
  description: "The Venmo or Zelle payment arrived: the piece is sold",
  input: Versioned.extend(MarkPaidInput.shape),
  permission: "sales:write",
  risk: "always_confirm",
  // Selling a piece on money arriving outside the platform is the artist's own tap (D-144).
  assistant: "never",
  plan: async (ctx, { id, version, paidCents, note }) => {
    const order = await getRecord(ctx.db, orderEntity, ctx.actor.studioId, id);
    checkVersion(order, version);
    if (order.method === "card") throw new HttpError("bad_request", "Card orders are marked paid by Square.");
    if (order.status !== "awaiting_payment" && order.status !== "expired" && order.status !== "cancelled") {
      throw new HttpError("bad_request", order.status === "paid" ? "This order is already paid." : "This order can't be marked paid.");
    }
    const total = (order.amountCents as number) + (order.shippingCents as number) + (order.taxCents as number);
    return { writes: await sell(ctx, order, { paidCents: paidCents ?? total, paymentId: null, note: note ?? null }) };
  },
  respond: lastOrder,
});

export const orderCancel = defineAction({
  name: "order.cancel",
  description: "Cancel an unpaid order: the piece goes back",
  input: Versioned,
  permission: "sales:write",
  risk: "confirm",
  plan: async (ctx, { id, version }) => {
    const order = await getRecord(ctx.db, orderEntity, ctx.actor.studioId, id);
    checkVersion(order, version);
    if (order.status !== "pending" && order.status !== "awaiting_payment") throw new HttpError("bad_request", "Only an unpaid order can be cancelled.");
    return { writes: [...(await release(ctx, order)), updateWrite(ctx, orderEntity, order, { status: "cancelled" })] };
  },
  respond: lastOrder,
});

export const orderExtend = defineAction({
  name: "order.extend",
  description: "Give a Venmo or Zelle order more time: the piece stays set aside",
  input: Versioned,
  permission: "sales:write",
  risk: "confirm",
  plan: async (ctx, { id, version }) => {
    const order = await getRecord(ctx.db, orderEntity, ctx.actor.studioId, id);
    checkVersion(order, version);
    if (order.status !== "awaiting_payment") throw new HttpError("bad_request", "Only a Venmo or Zelle order waiting for payment can get more time.");
    const { site } = await (await import("../lib/site-mail")).siteFor(ctx.env, ctx.actor.studioId);
    const from = (order.expiresAt as string) > ctx.now ? (order.expiresAt as string) : ctx.now;
    const until = later(from, checkoutSettings(site).manualHoldHours * 3_600_000);
    const writes: Write[] = [];
    const work = await artworkOf(ctx, order.artworkId as string | null);
    const meta = (work?.meta ?? {}) as Row;
    if (work && (meta.order as Row | undefined)?.orderId === order.id) {
      writes.push(updateWrite(ctx, artworkEntity, work, { meta: { ...meta, order: { orderId: order.id, until } } }));
    }
    writes.push(updateWrite(ctx, orderEntity, order, { expiresAt: until }));
    return { writes };
  },
  respond: lastOrder,
});

export const orderShip = defineAction({
  name: "order.ship",
  description: "Mark a paid order shipped, with its carrier and tracking number: the buyer gets one email",
  input: Versioned.extend(ShipInput.shape),
  permission: "sales:write",
  risk: "confirm",
  plan: async (ctx, { id, version, carrier, tracking }) => {
    const order = await getRecord(ctx.db, orderEntity, ctx.actor.studioId, id);
    checkVersion(order, version);
    if (order.status !== "paid") throw new HttpError("bad_request", "Only a paid order can be shipped.");
    return { writes: [updateWrite(ctx, orderEntity, order, { shippedAt: ctx.now, carrier, tracking })] };
  },
  respond: lastOrder,
});
