// Buying from the site (Site 3.0 stage 4, D-144). A visitor's order reserves its pieces (one, or a cart of up to 10;
// shipping from the one calculator, D-151): by card it waits 30 minutes for
// Square's checkout, by Venmo or Zelle it waits (48 hours by default) for the owner's Mark paid. Only two things sell:
// Square's signed webhook (order.paid, run by routes/orders.ts) and the owner's tap (order.mark_paid). Both take the
// same path: the order paid, the piece sold, a sales row, the client matched or made, a held piece's lead done.
import { Id, MarkPaidInput, OrderMethod, ShipInput, ShippingAddress, SiteCheckout, SiteProfile, Slug, db as schema, dollars, newId, shippingFor } from "@studio/core";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { HttpError } from "../lib/errors";
import {
  type EntityDef, artworkEntity, bumpCatalogue, checkVersion, clientEntity, defineEntity, findRecord, getRecord, insertWrite, saleEntity,
  updateWrite,
} from "./records";
import { type ActionCtx, type Snapshot, type Write, defineAction, rawSql } from "./runner";
import { shipWorkOf, shippingOf } from "../lib/shipping";
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
    expiresAt: null, paidAt: null, shippedAt: null, carrier: null, tracking: null, items: [], coveredCents: 0, shipZip: null,
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

/** Why this public work can't be bought online, or null when it can. Shipping is the calculator's (D-151). */
export function notBuyable(w: Row): string | null {
  const price = (w.price_cents ?? w.priceCents) as number | null;
  if (price === null || price === undefined || price <= 0) return "This piece has no listed price. Send an inquiry instead.";
  return null;
}

/** An order's pieces: its items, or its one artwork for an order made before carts. */
export function itemsOf(order: Snapshot): schema.OrderItemRow[] {
  const items = (order.items as schema.OrderItemRow[] | undefined) ?? [];
  if (items.length) return items;
  return order.artworkId ? [{ artworkId: order.artworkId as string, priceCents: order.amountCents as number, shippingCents: order.shippingCents as number, coveredCents: 0, rule: null }] : [];
}

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const orderCode = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
const later = (now: string, ms: number) => new Date(Date.parse(now) + ms).toISOString();

async function artworkOf(ctx: ActionCtx, id: string | null): Promise<Snapshot | null> {
  return id ? findRecord(ctx.db, artworkEntity, ctx.actor.studioId, id) : null;
}

/** The pieces go back to what they were before this order: on hold if a hold still runs, else on sale. */
async function release(ctx: ActionCtx, order: Snapshot): Promise<Write[]> {
  const writes: Write[] = [];
  for (const item of itemsOf(order)) {
    const work = await artworkOf(ctx, item.artworkId);
    const meta = (work?.meta ?? {}) as Row;
    if (!work || work.status !== "reserved" || (meta.order as Row | undefined)?.orderId !== order.id) continue;
    const { order: _o, ...rest } = meta;
    const hold = rest.hold as { until?: string } | undefined;
    const status = hold?.until && hold.until > ctx.now ? "reserved" : "available";
    if (status === "available") delete rest.hold;
    writes.push(updateWrite(ctx, artworkEntity, work, { status, meta: rest }));
  }
  return writes.length ? [...writes, bumpCatalogue(ctx)] : [];
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
 * Sells the order's pieces. A piece that already sold another way (or is held for someone else) never sells twice:
 * the order is marked paid with a conflict for the owner to refund it; the order's other pieces still sell.
 */
async function sell(ctx: ActionCtx, order: Snapshot, p: Payment): Promise<Write[]> {
  const buyerName = (order.buyerName as string | null) ?? p.buyerName ?? null;
  const buyerEmail = ((order.buyerEmail as string | null) ?? p.buyerEmail ?? null)?.toLowerCase() ?? null;
  const buyerPhone = (order.buyerPhone as string | null) ?? p.buyerPhone ?? null;
  const paid = {
    status: "paid", paidCents: p.paidCents, paidAt: ctx.now, squarePaymentId: p.paymentId ?? order.squarePaymentId ?? null,
    buyerName, buyerEmail, buyerPhone, shippingAddress: (order.shippingAddress as Row | null) ?? p.address ?? null,
  };
  const pieces: { work: Snapshot; item: schema.OrderItemRow; meta: Row }[] = [];
  const unsold: string[] = [];
  for (const item of itemsOf(order)) {
    const work = await artworkOf(ctx, item.artworkId);
    const meta = (work?.meta ?? {}) as Row;
    const mine = work && (
      work.status === "available"
      || (work.status === "reserved" && (meta.order as Row | undefined)?.orderId === order.id)
      || (work.status === "reserved" && !meta.order && !!order.leadId && (meta.hold as Row | undefined)?.leadId === order.leadId)
    );
    if (work && mine) pieces.push({ work, item, meta });
    else unsold.push(item.artworkId);
  }
  const note = p.note ? { note: p.note } : {};
  const conflict = unsold.length ? { conflict: true, unsold } : {};
  if (!pieces.length) return [updateWrite(ctx, orderEntity, order, { ...paid, meta: { ...(order.meta as Row), ...conflict, ...note } })];

  const client = await clientFor(ctx, buyerName, buyerEmail, buyerPhone);
  const writes: Write[] = [...client.writes];
  const how = order.method === "card" ? "card" : order.method === "venmo" ? "Venmo" : "Zelle";
  let leadId = (order.leadId as string | null) ?? null;
  for (const { work, item, meta } of pieces) {
    const { order: _o, hold, ...rest } = meta;
    leadId ??= ((hold as Row | undefined)?.leadId as string | undefined) ?? null;
    writes.push(updateWrite(ctx, artworkEntity, work, {
      status: "sold",
      meta: { ...rest, sale: { priceCents: item.priceCents, currency: order.currency, clientId: client.id, showId: null, soldAt: ctx.now, orderId: order.id } },
    }));
    writes.push(insertWrite(ctx, saleEntity, {
      id: newId(), artworkId: work.id, title: work.title, priceCents: item.priceCents, currency: order.currency,
      soldOn: ctx.now.slice(0, 10), paymentMethod: order.method === "card" ? "card" : "other",
      source: order.method === "card" ? "square" : "manual", externalId: p.paymentId ?? null,
      notes: `Website order ${order.code} (${how})${p.note ? `: ${p.note}` : ""}`, medium: work.medium ?? null,
      meta: { orderId: order.id },
    }));
  }
  writes.push(bumpCatalogue(ctx));
  if (leadId) {
    const lead = await findRecord(ctx.db, leadEntity, ctx.actor.studioId, leadId);
    if (lead && lead.status !== "closed") writes.push(updateWrite(ctx, leadEntity, lead, { status: "closed" }));
  }
  const meta = unsold.length || p.note ? { meta: { ...(order.meta as Row), ...conflict, ...note } } : {};
  writes.push(updateWrite(ctx, orderEntity, order, { ...paid, clientId: client.id, ...meta }));
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
  description: "A site visitor starts buying a piece or a cart: the pieces are set aside while they pay",
  input: z.object({
    visitorId: Id,
    works: z.array(Slug).min(1).max(10),
    method: OrderMethod,
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: ShippingAddress.nullable(),
    zip: z.string().regex(/^\d{5}$/).nullable(),
    /** What the cart showed for shipping; when it changed, nothing is reserved (the buyer confirms the new total). */
    shownShippingCents: z.number().int().nullable(),
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

    const slugs = [...new Set(input.works)];
    const firstLook = await (await import("./collectors")).firstLookAccess(ctx.env, ctx.actor.studioId, input.visitorId);
    const found = await publicWorksBySlug(ctx.env, ctx.actor.studioId, slugs, { firstLook });
    if (found.length !== slugs.length) {
      const missing = slugs.filter((x) => !found.some((f) => f.slug === x));
      throw new HttpError("not_found", "A piece in your cart is no longer on the site.", { works: missing });
    }
    const works: Snapshot[] = [];
    const held: Snapshot[] = [];
    let leadId: string | null = null;
    for (const f of found) {
      const why = notBuyable(f);
      if (why) throw new HttpError("bad_request", why, { works: [f.slug] });
      const work = await getRecord(ctx.db, artworkEntity, ctx.actor.studioId, f.id as string);
      const meta = (work.meta ?? {}) as Row;
      if (work.status === "reserved") {
        const hold = meta.hold as { leadId?: string; until?: string } | undefined;
        const lead = hold?.leadId && !meta.order ? await findRecord(ctx.db, leadEntity, ctx.actor.studioId, hold.leadId) : null;
        if (!lead || lead.visitorId !== input.visitorId || (hold?.until ?? "") <= ctx.now || (leadId && leadId !== lead.id)) {
          throw new HttpError("version_conflict", meta.order
            ? `Someone is buying ${work.title as string} right now. Please check back soon.`
            : `${work.title as string} is on hold for someone.`, { works: [work.slug] });
        }
        leadId = lead.id as string;
        held.push(work);
      } else if (work.status !== "available") {
        throw new HttpError("version_conflict", `${work.title as string} isn't available any more.`, { works: [work.slug] });
      }
      works.push(work);
    }

    // The one calculator (D-151): the same answer the cart showed, or the buyer sees the new one first.
    const ship = shippingFor({
      works: works.map((w) => shipWorkOf(w, held.includes(w))), settings: shippingOf(site), zip: input.zip ?? input.address?.postalCode?.slice(0, 5) ?? null,
      country: input.address?.country ?? "US", today: ctx.now.slice(0, 10),
    });
    if (!ship.ok) {
      const slugOf = (id: string) => works.find((w) => w.id === id)?.slug ?? null;
      if (ship.needsZip) throw new HttpError("bad_request", "Enter your ZIP code for the shipping.", { needsZip: true });
      if (ship.quote.length) throw new HttpError("bad_request", "This needs a shipping quote first. Send an inquiry and the artist will reply.", { works: ship.quote.map(slugOf) });
      throw new HttpError("bad_request", ship.blocked[0]?.why ?? "This can't be bought online.", { works: ship.blocked.map((b) => slugOf(b.id)) });
    }
    if (input.shownShippingCents !== null && input.shownShippingCents !== ship.shippingCents) {
      throw new HttpError("version_conflict", `Shipping is now ${dollars(ship.shippingCents)}. Check the new total and confirm again.`, {
        shippingCents: ship.shippingCents, coveredCents: ship.coveredCents,
      });
    }

    const id = newId();
    const manual = input.method !== "card";
    const expiresAt = later(ctx.now, manual ? c.manualHoldHours * 3_600_000 : CARD_MINUTES * 60_000);
    const items: schema.OrderItemRow[] = works.map((w) => {
      const l = ship.lines.find((x) => x.id === w.id)!;
      return { artworkId: w.id as string, priceCents: w.priceCents as number, shippingCents: l.chargedCents, coveredCents: l.coveredCents, rule: l.rule };
    });
    const amountCents = items.reduce((n, i) => n + i.priceCents, 0);
    return {
      writes: [
        ...works.map((w) => updateWrite(ctx, artworkEntity, w, { status: "reserved", meta: { ...((w.meta ?? {}) as Row), order: { orderId: id, until: expiresAt } } })),
        bumpCatalogue(ctx),
        insertWrite(ctx, orderEntity, {
          id, kind: "piece", method: input.method, status: manual ? "awaiting_payment" : "pending", code: orderCode(),
          artworkId: works[0]!.id, leadId, visitorId: input.visitorId, amountCents, shippingCents: ship.shippingCents,
          coveredCents: ship.coveredCents, items, shipZip: input.zip ?? null,
          taxCents: Math.round((amountCents * c.taxBps) / 10_000), currency: works[0]!.currency ?? "USD",
          buyerName: input.name, buyerEmail: input.email?.toLowerCase() ?? null, buyerPhone: input.phone,
          shippingAddress: input.address, expiresAt, meta: { origin: input.origin, rules: ship.ruleIds },
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
    for (const item of itemsOf(order)) {
      const work = await artworkOf(ctx, item.artworkId);
      const meta = (work?.meta ?? {}) as Row;
      if (work && (meta.order as Row | undefined)?.orderId === order.id) {
        writes.push(updateWrite(ctx, artworkEntity, work, { meta: { ...meta, order: { orderId: order.id, until } } }));
      }
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
