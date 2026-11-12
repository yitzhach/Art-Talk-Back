// Buying from the site (Site 3.0 stage 4, D-144).
//
// Public, under /public/studios/{slug}: the checkout's settings; a visitor's own orders (x-visitor-key, as leads).
// Square: its signed webhook, the only way a card order is paid. No session; the signature is the proof.
// Owner: the orders, and Mark paid (Venmo, Zelle), Ship, Cancel, More time.
import { firstLookAccess } from "../actions/collectors";
import { live } from "../lib/collectors";
import {
  OrderInput, OrderStatus, Order, PublicCheckout, PublicOrder, PublicShipping, MarkPaidInput, ShipInput, ShippingQuote, ShippingQuoteInput,
  db as schema, shippingFor, wouldUnlock, type ShipWork,
} from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { artworkEntity, findRecord } from "../actions/records";
import { getAction, runAction, type Snapshot } from "../actions/runner";
import { orderEntity, checkoutSettings, itemsOf, methodsOf } from "../actions/orders";
import { publicShippingOf, shipWorkOf, shippingOf } from "../lib/shipping";
import { visitorActor, visitorFor } from "../actions/visitors";
import { requirePermission } from "../auth/permissions";
import { requireActor } from "../auth/session";
import type { Actor, AppEnv, Env } from "../env";
import { HttpError, notFound } from "../lib/errors";
import { sendOrderMail } from "../lib/order-mail";
import { siteFor } from "../lib/site-mail";
import { createPaymentLink, deletePaymentLink, squareReady, squareSignatureOk } from "../lib/square";
import { nowIso } from "../lib/time";
import { filesOf, publicWork, studioOf } from "./public";
import { IfMatchHeader, PathId, body, errors, ifMatch, json, newApp, run, send } from "./common";

export const orderRoutes = newApp();

type Row = Record<string, unknown>;
const P = "/public/studios/{slug}";
const SlugParam = z.object({ slug: z.string().meta({ param: { name: "slug", in: "path" } }) });
const KeyHeader = z.object({ "x-visitor-key": z.string().optional().meta({ description: "The site's per-browser key (D-134)" }) });
const noStore = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }) as never;

export const systemActor = (studioId: string): Actor => ({
  userId: "system", email: "", name: null, sessionId: null, studioId, role: "owner", clientId: null,
});
const asSystem = <R>(env: Env, studioId: string, name: string, input: unknown) =>
  runAction<R>(getAction(name) as never, input, { env, actor: systemActor(studioId), origin: "https://studio-api", source: "system" });

const totalOf = (o: Row) => Number(o.amountCents) + Number(o.shippingCents ?? 0) + Number(o.taxCents ?? 0);

interface ItemOut { slug: string | null; title: string; priceCents: number; shippingCents: number; coveredCents: number }

/** The order's pieces with their titles, and one title for the whole order ("Heron and 2 more"). */
async function titleOf(env: Env, o: Row): Promise<{ title: string; slug: string | null; items: ItemOut[] }> {
  const items: ItemOut[] = [];
  for (const i of itemsOf(o)) {
    const w = await findRecord(drizzle(env.DB), artworkEntity, o.studioId as string, i.artworkId, { withDeleted: true });
    items.push({ slug: (w?.slug as string | null | undefined) ?? null, title: (w?.title as string | undefined) ?? "A piece", priceCents: i.priceCents, shippingCents: i.shippingCents, coveredCents: i.coveredCents });
  }
  const first = items[0];
  const title = !first ? "A piece" : items.length === 1 ? first.title : `${first.title} and ${items.length - 1} more`;
  return { title, slug: first?.slug ?? null, items };
}

async function publicOrder(env: Env, o: Row): Promise<z.infer<typeof PublicOrder>> {
  const { site } = await siteFor(env, o.studioId as string);
  const c = checkoutSettings(site);
  const { title, slug, items } = await titleOf(env, o);
  const waiting = o.status === "awaiting_payment";
  return {
    id: o.id as string, code: o.code as string, kind: o.kind as "piece", method: o.method as "card", status: o.status as "paid", title, slug,
    amountCents: o.amountCents as number, shippingCents: o.shippingCents as number, taxCents: o.taxCents as number, totalCents: totalOf(o),
    currency: o.currency as string, coveredCents: Number(o.coveredCents ?? 0), items, checkoutUrl: o.status === "pending" ? ((o.checkoutUrl as string | null) ?? null) : null,
    payTo: waiting ? { venmo: o.method === "venmo" ? c.venmo : null, zelle: o.method === "zelle" ? c.zelle : null } : null,
    expiresAt: (o.expiresAt as string | null) ?? null, paidAt: (o.paidAt as string | null) ?? null, shippedAt: (o.shippedAt as string | null) ?? null,
    returns: c.returns,
  };
}

async function ownerOrder(env: Env, o: Row): Promise<z.infer<typeof Order>> {
  const { payTo: _p, returns: _r, ...pub } = await publicOrder(env, o);
  return {
    ...pub, checkoutUrl: (o.checkoutUrl as string | null) ?? null, version: o.version as number,
    artworkId: (o.artworkId as string | null) ?? null, leadId: (o.leadId as string | null) ?? null, clientId: (o.clientId as string | null) ?? null,
    paidCents: (o.paidCents as number | null) ?? null, buyerName: (o.buyerName as string | null) ?? null, buyerEmail: (o.buyerEmail as string | null) ?? null,
    buyerPhone: (o.buyerPhone as string | null) ?? null, shippingAddress: (o.shippingAddress as Row | null) ?? null,
    carrier: (o.carrier as string | null) ?? null, tracking: (o.tracking as string | null) ?? null, squarePaymentId: (o.squarePaymentId as string | null) ?? null,
    conflict: (o.meta as Row | null)?.conflict === true, createdAt: o.createdAt as string, updatedAt: o.updatedAt as string,
  };
}

const orderById = (env: Env, studioId: string, id: string) => findRecord(drizzle(env.DB), orderEntity, studioId, id);
const originOf = (o: Row, fallback: string) => ((o.meta as Row | null)?.origin as string | undefined) ?? fallback;

/** Sends an order's emails after the response, never failing the request. */
function mailLater(c: Context<AppEnv>, p: Promise<unknown>) {
  const safe = p.catch((e) => console.error("order mail failed", e));
  try { c.executionCtx.waitUntil(safe); } catch { return safe; }
  return undefined;
}

/** Ends this studio's unpaid orders whose time is up (the hourly job does the rest). Returns how many ended. */
export async function expireOrders(env: Env, now = nowIso(), studioId?: string, artworkId?: string): Promise<number> {
  const o = schema.orders;
  const where = [inArray(o.status, ["pending", "awaiting_payment"]), lte(o.expiresAt, now), isNull(o.deletedAt)];
  if (studioId) where.push(eq(o.studioId, studioId));
  if (artworkId) {
    where.push(or(eq(o.artworkId, artworkId), sql`EXISTS (SELECT 1 FROM json_each(${o.items}) j WHERE json_extract(j.value, '$.artworkId') = ${artworkId})`)!);
  }
  const rows = await drizzle(env.DB).select({ id: o.id, studioId: o.studioId, link: o.squareLinkId }).from(o).where(and(...where)).limit(200);
  let n = 0;
  for (const r of rows) {
    try {
      const res = await asSystem(env, r.studioId, "order.expire", { id: r.id });
      if (res.activityIds.length) n++;
      if (r.link) await deletePaymentLink(env, r.link);
    } catch (e) {
      console.error("order expiry failed", r.id, e);
    }
  }
  return n;
}

// ------------------------------------------------------------------ public

orderRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/checkout`, tags: ["orders"], security: [],
    summary: "What the site's checkout offers: ways to pay, flat shipping for small works, tax, returns (D-144)",
    request: { params: SlugParam },
    responses: { 200: json(PublicCheckout), 404: errors[404] },
  }),
  async (c) => {
    const { slug } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    const { site } = await siteFor(c.env, studio.id);
    const s = checkoutSettings(site);
    const methods = methodsOf(s, squareReady(c.env, slug));
    return noStore({
      enabled: methods.length > 0, methods, shippingCents: s.shippingCents, smallMaxInches: s.smallMaxInches, taxBps: s.taxBps,
      returns: s.returns, manualHoldHours: s.manualHoldHours, shipping: publicShippingOf(site, nowIso()),
    } satisfies z.infer<typeof PublicCheckout>);
  },
);

orderRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/visitor/orders`, tags: ["orders"], security: [],
    summary: "Buy one piece or a cart: the pieces are set aside while the visitor pays. Card → Square's checkout page; Venmo or Zelle → instructions by email. 409 when a piece isn't available or the shipping changed (details say which)",
    request: { params: SlugParam, headers: KeyHeader, body: body(OrderInput) },
    responses: { 201: json(PublicOrder), 400: errors[400], 404: errors[404], 409: errors[409], 429: { ...errors[400], description: "Over today's limit" } },
  }),
  async (c) => {
    const { slug } = c.req.valid("param");
    const input = c.req.valid("json");
    const studio = await studioOf(c, slug);
    // The hidden trap (D-133): a person never fills it.
    if (input.website) throw new HttpError("bad_request", "Reload the page and try again.");
    const v = await visitorFor(c.env, studio.id, c.req.header("x-visitor-key") ?? "", true);
    if (!v) throw new HttpError("bad_request", "Reload the page and try again.");
    const origin = new URL(c.req.url).origin;
    const cardReady = squareReady(c.env, slug);

    const works = input.works ?? [input.work!];

    // An order that ran out still holds its pieces until the hourly job: end these pieces' now.
    for (const w of works) {
      const work = await c.env.DB.prepare("SELECT id FROM artworks WHERE studio_id = ? AND slug = ? AND deleted_at IS NULL").bind(studio.id, w).first<{ id: string }>();
      if (work) await expireOrders(c.env, nowIso(), studio.id, work.id);
    }

    const actor = visitorActor(studio.id, v.id);
    const { result } = await runAction<Snapshot>(getAction("order.start") as never, {
      visitorId: v.id, works, method: input.method, name: input.name ?? null, email: input.email ?? null,
      phone: input.phone ?? null, address: input.address ?? null, zip: input.zip ?? null, shownShippingCents: input.shippingCents ?? null, cardReady, origin,
    }, { env: c.env, actor, origin, source: "app" });
    let order = result;

    if (input.method === "card") {
      try {
        const { items } = await titleOf(c.env, order);
        const link = await createPaymentLink(c.env, {
          orderId: order.id as string, code: order.code as string, lines: items.map((i) => ({ title: i.title, amountCents: i.priceCents })),
          shippingCents: order.shippingCents as number, taxBps: checkoutSettings((await siteFor(c.env, studio.id)).site).taxBps,
          currency: order.currency as string, redirectUrl: `${origin}/thanks/${order.id}`, email: (order.buyerEmail as string | null) ?? null,
        });
        order = (await runAction<Snapshot>(getAction("order.attach_link") as never,
          { id: order.id, linkId: link.linkId, squareOrderId: link.squareOrderId, url: link.url }, { env: c.env, actor, origin, source: "app" })).result;
      } catch (e) {
        await runAction(getAction("order.abandon") as never, { id: order.id }, { env: c.env, actor, origin, source: "app" }).catch(() => {});
        throw e;
      }
    } else {
      const { title } = await titleOf(c.env, order);
      await mailLater(c, sendOrderMail(c.env, "placed", order, title, origin));
    }
    return noStore(await publicOrder(c.env, order), 201);
  },
);

orderRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/visitor/orders/{id}`, tags: ["orders"], security: [],
    summary: "The visitor's own order (the thanks page reads it until Square's webhook marks it paid)",
    request: { params: SlugParam.extend(PathId.shape), headers: KeyHeader },
    responses: { 200: json(PublicOrder), 404: errors[404] },
  }),
  async (c) => {
    const { slug, id } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    const v = await visitorFor(c.env, studio.id, c.req.header("x-visitor-key") ?? "", false);
    const o = v ? await orderById(c.env, studio.id, id) : null;
    if (!o || o.visitorId !== v!.id) throw notFound("Order");
    return noStore(await publicOrder(c.env, o));
  },
);

orderRoutes.openapi(
  createRoute({
    method: "get", path: `${P}/shipping`, tags: ["orders"], security: [],
    summary: "The studio's shipping: tiers, rates and the offers running now (D-146…D-153)",
    request: { params: SlugParam },
    responses: { 200: json(PublicShipping), 404: errors[404] },
  }),
  async (c) => {
    const { slug } = c.req.valid("param");
    const studio = await studioOf(c, slug);
    const { site } = await siteFor(c.env, studio.id);
    return send(c, publicShippingOf(site, nowIso()));
  },
);

orderRoutes.openapi(
  createRoute({
    method: "post", path: `${P}/shipping/quote`, tags: ["orders"], security: [],
    summary: "A cart's shipping, worked out by the one calculator (prices and status from the catalogue, never the request), with up to three suggestions",
    request: { params: SlugParam, headers: KeyHeader, body: body(ShippingQuoteInput) },
    responses: { 200: json(ShippingQuote), 400: errors[400], 404: errors[404] },
  }),
  async (c) => {
    const { slug } = c.req.valid("param");
    const input = c.req.valid("json");
    const studio = await studioOf(c, slug);
    const { site } = await siteFor(c.env, studio.id);
    const settings = shippingOf(site);
    const v = await visitorFor(c.env, studio.id, c.req.header("x-visitor-key") ?? "", false);
    const slugs = [...new Set(input.works)];
    const firstLook = await firstLookAccess(c.env, studio.id, v?.id);
    const { results: rows } = await c.env.DB.prepare(
      `SELECT * FROM artworks WHERE studio_id = ? AND public = 1 AND deleted_at IS NULL AND kind = 'work'${firstLook ? "" : ` AND ${live()}`} AND slug IN (${slugs.map(() => "?").join(",")})`,
    ).bind(studio.id, ...slugs).all<Row>();
    const now = nowIso();
    // A piece on hold for this visitor (their approved hold, D-127) is theirs to buy.
    const heldForMe = async (r: Row) => {
      if (!v || r.status !== "reserved") return false;
      const meta = JSON.parse((r.meta as string) || "{}") as Row;
      const hold = meta.hold as { leadId?: string; until?: string } | undefined;
      if (meta.order || !hold?.leadId || (hold.until ?? "") <= now) return false;
      const lead = await c.env.DB.prepare("SELECT visitor_id FROM leads WHERE id = ? AND studio_id = ?").bind(hold.leadId, studio.id).first<{ visitor_id: string }>();
      return lead?.visitor_id === v.id;
    };
    const works: ShipWork[] = [];
    for (const r of rows) works.push(shipWorkOf(r, await heldForMe(r)));
    const r = shippingFor({ works, settings, zip: input.zip ?? null, pickup: input.pickup ?? false, today: now.slice(0, 10) });
    const slugOf = (id: string) => works.find((w) => w.id === id)?.slug ?? "";
    const missing = slugs.filter((x) => !rows.some((row) => row.slug === x)).map((x) => ({ slug: x, why: "No longer on the site" }));

    // Suggestions: only when they would unlock the offer; the artist's pairings first, then price nearest the minimum.
    let suggestions: z.infer<typeof ShippingQuote>["suggestions"] = [];
    if (r.ok && (r.nudge?.kind === "tier2Alone" || r.nudge?.kind === "largeAlone")) {
      const pairs = new Set(works.flatMap((w) => w.shipping?.pairsWith ?? []));
      const { results: cand } = await c.env.DB.prepare(
        `SELECT * FROM artworks WHERE studio_id = ? AND public = 1 AND deleted_at IS NULL AND kind = 'work' AND status = 'available' AND ${live()}
         AND price_cents > 0 AND shipping IS NOT NULL ORDER BY published_at DESC LIMIT 200`,
      ).bind(studio.id).all<Row>();
      const target = settings.r2.minCents;
      const picks = cand.filter((x) => !slugs.includes(x.slug as string) && wouldUnlock(r, shipWorkOf(x), settings))
        .sort((a, b) => Number(pairs.has(b.id as string)) - Number(pairs.has(a.id as string))
          || Math.abs(Number(a.price_cents) - target) - Math.abs(Number(b.price_cents) - target))
        .slice(0, 3);
      const files = await filesOf(c, studio.id, picks.map((x) => x.id as string));
      suggestions = picks.map((x) => {
        const pub = publicWork(slug, x, files.get(x.id as string) ?? []);
        const img = pub.images[0]?.sizes.find((z2) => z2.width === 480) ?? pub.images[0]?.sizes[0];
        return { slug: pub.slug, title: pub.title, priceCents: x.price_cents as number, image: img?.url ?? null };
      });
    }
    const subtotalCents = works.reduce((n, w) => n + (w.priceCents ?? 0), 0);
    return noStore({
      ok: r.ok && !missing.length, needsZip: r.needsZip, quote: r.quote.map(slugOf),
      blocked: [...missing, ...r.blocked.map((b) => ({ slug: slugOf(b.id), why: b.why }))],
      lines: r.lines.map((l) => ({ slug: l.slug ?? "", tier: l.tier, baseCents: l.baseCents, chargedCents: l.chargedCents, coveredCents: l.coveredCents, rule: l.rule, estimate: l.estimate })),
      subtotalCents, shippingCents: r.shippingCents, coveredCents: r.coveredCents, totalCents: subtotalCents + r.shippingCents,
      reason: r.reason, nudge: r.nudge, suggestions,
    } satisfies z.infer<typeof ShippingQuote>);
  },
);

// ------------------------------------------------------------------ Square's webhook

type SquareAddress = { address_line_1?: string; address_line_2?: string; locality?: string; administrative_district_level_1?: string; postal_code?: string; country?: string; first_name?: string; last_name?: string };
interface SquareEvent {
  type?: string;
  event_id?: string;
  data?: { object?: {
    payment?: { id?: string; status?: string; order_id?: string; total_money?: { amount?: number }; buyer_email_address?: string; shipping_address?: SquareAddress };
    refund?: { id?: string; status?: string; order_id?: string; payment_id?: string };
  } };
}

orderRoutes.openapi(
  createRoute({
    method: "post", path: "/square/webhook", tags: ["orders"], security: [],
    summary: "Square's signed payment and refund events (D-144): a completed payment sells the order's piece",
    responses: { 200: json(z.object({ ok: z.boolean() })), 401: errors[401] },
  }),
  async (c) => {
    const raw = await c.req.text();
    const url = c.env.SQUARE_WEBHOOK_URL || c.req.url;
    if (!(await squareSignatureOk(c.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? "", url, raw, c.req.header("x-square-hmacsha256-signature")))) {
      throw new HttpError("unauthenticated", "Bad signature");
    }
    const ok = () => send(c, { ok: true });
    let ev: SquareEvent;
    try { ev = JSON.parse(raw) as SquareEvent; } catch { return ok(); }
    const payment = ev.data?.object?.payment;
    const refund = ev.data?.object?.refund;
    const squareOrderId = payment?.order_id ?? refund?.order_id;
    if (!ev.event_id || !squareOrderId) return ok();
    const done = (payment && payment.status === "COMPLETED") || (refund && refund.status === "COMPLETED");
    if (!done) return ok();

    const [row] = await drizzle(c.env.DB).select({ id: schema.orders.id, studioId: schema.orders.studioId }).from(schema.orders)
      .where(eq(schema.orders.squareOrderId, squareOrderId)).limit(1);
    if (!row) return ok(); // Not one of ours (a sale at the booth, another app): Square only needs a 200.

    if (payment) {
      const a = payment.shipping_address;
      const name = [a?.first_name, a?.last_name].filter(Boolean).join(" ") || null;
      const r = await asSystem<Snapshot | null>(c.env, row.studioId, "order.paid", {
        id: row.id, eventId: ev.event_id, paymentId: payment.id ?? "", paidCents: payment.total_money?.amount ?? 0,
        buyerName: name, buyerEmail: payment.buyer_email_address ?? null, buyerPhone: null,
        address: a ? { line1: a.address_line_1 ?? "", line2: a.address_line_2, city: a.locality ?? "", state: a.administrative_district_level_1 ?? "", postalCode: a.postal_code ?? "", country: a.country ?? "US" } : null,
      });
      if (r.activityIds.length) {
        const o = (await orderById(c.env, row.studioId, row.id))!;
        const { title } = await titleOf(c.env, o);
        await mailLater(c, sendOrderMail(c.env, (o.meta as Row | null)?.conflict ? "conflict" : "paid", o, title, originOf(o, new URL(c.req.url).origin)));
      }
    } else {
      await asSystem(c.env, row.studioId, "order.refunded", { id: row.id, eventId: ev.event_id });
    }
    return ok();
  },
);

// ------------------------------------------------------------------ the owner

orderRoutes.openapi(
  createRoute({
    method: "get", path: "/orders", tags: ["orders"], summary: "Orders from the site, newest first: open ones (unpaid, paid but not shipped, or to check) by default",
    request: { query: z.object({ status: z.union([OrderStatus, z.enum(["open", "all"])]).default("open") }) },
    responses: { 200: json(z.object({ items: z.array(Order) })), 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "sales:read");
    const { status } = c.req.valid("query");
    const o = schema.orders;
    const rows = (await drizzle(c.env.DB).select().from(o).where(and(
      eq(o.studioId, actor.studioId), isNull(o.deletedAt), ...(status === "all" || status === "open" ? [] : [eq(o.status, status)]),
    )).orderBy(desc(o.createdAt)).limit(200)) as Row[];
    const keep = status !== "open" ? rows : rows.filter((r) =>
      r.status === "pending" || r.status === "awaiting_payment" || (r.status === "paid" && (!r.shippedAt || (r.meta as Row | null)?.conflict)));
    return send(c, { items: await Promise.all(keep.map((r) => ownerOrder(c.env, r))) });
  },
);

orderRoutes.openapi(
  createRoute({
    method: "get", path: "/orders/{id}", tags: ["orders"], summary: "One order",
    request: { params: PathId },
    responses: { 200: json(Order), 401: errors[401], 403: errors[403], 404: errors[404] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "sales:read");
    const o = await orderById(c.env, actor.studioId, c.req.valid("param").id);
    if (!o) throw notFound("Order");
    return send(c, await ownerOrder(c.env, o));
  },
);

const ownerAction = (path: string, action: string, summary: string, input?: z.ZodType) =>
  orderRoutes.openapi(
    createRoute({
      method: "post", path: `/orders/{id}/${path}`, tags: ["orders"], summary,
      request: { params: PathId, headers: IfMatchHeader, ...(input ? { body: body(input) } : {}) },
      responses: { 200: json(Order), 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404], 409: errors[409] },
    }),
    async (c) => {
      const actor = requireActor(c);
      const extra = input ? ((await c.req.json().catch(() => ({}))) as Row) : {};
      const before = await orderById(c.env, actor.studioId, c.req.valid("param").id);
      const { result } = await run<Snapshot>(c, action, { ...extra, id: c.req.valid("param").id, version: ifMatch(c) });
      const o = (await orderById(c.env, actor.studioId, result.id as string))!;
      const origin = originOf(o, new URL(c.req.url).origin);
      if (action === "order.mark_paid") {
        const { title } = await titleOf(c.env, o);
        await mailLater(c, sendOrderMail(c.env, (o.meta as Row | null)?.conflict ? "conflict" : "paid", o, title, origin));
      } else if (action === "order.ship") {
        const { title } = await titleOf(c.env, o);
        await mailLater(c, sendOrderMail(c.env, "shipped", o, title, origin));
      } else if (action === "order.cancel" && before?.squareLinkId) {
        await deletePaymentLink(c.env, before.squareLinkId as string);
      }
      return send(c, await ownerOrder(c.env, o));
    },
  );

ownerAction("mark-paid", "order.mark_paid", "The Venmo or Zelle payment arrived: the piece is sold, with a sale and the client recorded", MarkPaidInput);
ownerAction("ship", "order.ship", "Mark a paid order shipped: the buyer gets the tracking number by email", ShipInput);
ownerAction("cancel", "order.cancel", "Cancel an unpaid order: the piece goes back on sale (or back on its hold)");
ownerAction("extend", "order.extend", "Give a Venmo or Zelle order more time");
