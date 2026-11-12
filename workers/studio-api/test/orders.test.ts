// Buying from the site (Site 3.0 stage 4, card A; D-144): checkout settings, a card order through Square's (mocked)
// payment link and signed webhook, Venmo/Zelle orders sold by the owner's Mark paid, no double sale, holds, expiry.
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expireOrders } from "../src/routes/orders";
import { makeWork, studioSlug } from "./catalogue-helpers";
import { call, makeStudio, type Studio } from "./helpers";

const P = (slug: string) => `/v1/public/studios/${slug}`;
const key = (n: string) => `visitor-${n}`.padEnd(32, "k");
const vh = (n: string) => ({ "x-visitor-key": key(n) });
const HOOK = "https://studio-api.example.test/v1/square/webhook";
const SIG_KEY = "test-square-signature-key";
const squareEnv = (slug: string) => ({
  ...env, SQUARE_ENV: "sandbox", SQUARE_STUDIO_SLUG: slug, SQUARE_ACCESS_TOKEN: "sq-test", SQUARE_LOCATION_ID: "LOC1",
  SQUARE_WEBHOOK_SIGNATURE_KEY: SIG_KEY, SQUARE_WEBHOOK_URL: HOOK,
}) as typeof env;

// ---- every outside call: Resend mail, Square links
interface Mail { to: string[]; subject: string; text: string }
let mails: Mail[] = [];
let links: any[] = [];
let deleted: string[] = [];
let squareDown = false;
let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  mails = []; links = []; deleted = []; squareDown = false;
  spy = vi.spyOn(globalThis, "fetch").mockImplementation((async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://api.resend.com/emails") {
      mails.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "x" });
    }
    if (url.startsWith("https://connect.squareupsandbox.com/v2/online-checkout/payment-links")) {
      if (squareDown) return Response.json({ errors: [{ code: "INTERNAL_SERVER_ERROR" }] }, { status: 500 });
      if (init?.method === "DELETE") { deleted.push(url.split("/").pop()!); return Response.json({}); }
      const b = JSON.parse(String(init?.body));
      links.push(b);
      const n = links.length;
      return Response.json({ payment_link: { id: `LINK${n}`, url: `https://sandbox.square.link/u/${n}`, order_id: `SQORDER-${b.idempotency_key}` } });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as any);
});
afterEach(() => spy.mockRestore());

const settings = async (s: Studio) => (await call("/v1/settings", { cookie: s.cookie })).data;
async function patchSite(s: Studio, patch: Record<string, unknown>) {
  const cur = await settings(s);
  const r = await call("/v1/settings", {
    method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(cur.version) },
    json: { meta: { ...cur.meta, site: { ...(cur.meta?.site ?? {}), ...patch } } },
  });
  if (r.status !== 200) throw new Error(`settings ${r.status} ${r.raw}`);
}
const checkout = { enabled: true, venmo: "@Test-Artist", zelle: "pay@artist.test", shippingCents: 4000, returns: "Returns within 7 days.", taxBps: 600 };
async function setup(withCheckout: Record<string, unknown> | null = checkout) {
  const s = await makeStudio("Shop");
  const slug = await studioSlug(s.studioId);
  // Tier 2 at $40 keeps these orders' sums as they were before shipping tiers (D-146).
  if (withCheckout) await patchSite(s, { checkout: withCheckout, shipping: { tier2Cents: 4000 } });
  return { s, slug, senv: squareEnv(slug) };
}
const work = async (s: Studio, fields: Record<string, unknown> = {}) =>
  (await makeWork(s, { title: "Heron", priceCents: 50_000, width: 12, height: 16, sizeUnit: "in", shipping: { tier: 2 }, ...fields }, { publish: true })).work;
const art = async (s: Studio, id: string) => (await call(`/v1/artworks/${id}`, { cookie: s.cookie })).data;
const address = { line1: "1 Main St", city: "Springfield", state: "IL", postalCode: "62701" };
const buy = (slug: string, who: string, json: Record<string, unknown>, e?: typeof env) =>
  call(`${P(slug)}/visitor/orders`, { method: "POST", headers: vh(who), json, ...(e ? { env: e } : {}) });
const manual = (slug: string, who: string, w: any, method = "venmo") =>
  buy(slug, who, { work: w.slug, method, name: "Pat Buyer", email: "Pat@Buyer.test", address });
/** Its time ran out (as if the clock moved on). */
const runOut = (id: string) => env.DB.prepare("UPDATE orders SET expires_at = ? WHERE id = ?").bind(new Date(Date.now() - 1000).toISOString(), id).run();
const ownerOrder = async (s: Studio, id: string) => (await call(`/v1/orders/${id}`, { cookie: s.cookie })).data;
const act = (s: Studio, id: string, what: string, version: number, json?: unknown) =>
  call(`/v1/orders/${id}/${what}`, { method: "POST", cookie: s.cookie, headers: { "If-Match": String(version) }, ...(json ? { json } : {}) });

async function sign(body: string, url = HOOK, k = SIG_KEY) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(k), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(url + body)))));
}
async function hook(e: typeof env, event: Record<string, unknown>, signature?: string) {
  const body = JSON.stringify(event);
  return call("/v1/square/webhook", {
    method: "POST", env: e, body,
    headers: { "content-type": "application/json", "x-square-hmacsha256-signature": signature ?? (await sign(body)) },
  });
}
const paidEvent = (squareOrderId: string, eventId = crypto.randomUUID(), amount = 57_000) => ({
  type: "payment.updated", event_id: eventId,
  data: { type: "payment", object: { payment: {
    id: `PAY-${eventId}`, status: "COMPLETED", order_id: squareOrderId, total_money: { amount, currency: "USD" },
    buyer_email_address: "card@buyer.test",
    shipping_address: { first_name: "Card", last_name: "Buyer", address_line_1: "2 Oak Ave", locality: "Austin", administrative_district_level_1: "TX", postal_code: "73301", country: "US" },
  } } },
});

describe("checkout settings", () => {
  it("is off until the owner turns it on; card only with this studio's Square credentials", async () => {
    const { s, slug, senv } = await setup(null);
    expect((await call(`${P(slug)}/checkout`)).data).toMatchObject({ enabled: false, methods: [] });
    await patchSite(s, { checkout });
    expect((await call(`${P(slug)}/checkout`)).data).toMatchObject({ enabled: true, methods: ["venmo", "zelle"], shippingCents: 4000, taxBps: 600, smallMaxInches: 36 });
    expect((await call(`${P(slug)}/checkout`, { env: senv })).data.methods).toEqual(["card", "venmo", "zelle"]);
    // Another studio's credentials never take its cards.
    const other = await setup();
    expect((await call(`${P(other.slug)}/checkout`, { env: senv })).data.methods).toEqual(["venmo", "zelle"]);
    expect((await buy(other.slug, "x", { work: "nope", method: "card" }, senv)).status).toBe(400);
  });
});

describe("card orders", () => {
  it("sets the piece aside, makes Square's page, and the signed webhook sells it once", async () => {
    const { s, slug, senv } = await setup();
    const w = await work(s);
    const r = await buy(slug, "c", { work: w.slug, method: "card" }, senv);
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ method: "card", status: "pending", amountCents: 50_000, shippingCents: 4000, taxCents: 3000, totalCents: 57_000, checkoutUrl: "https://sandbox.square.link/u/1", payTo: null });
    expect(links[0]).toMatchObject({
      idempotency_key: r.data.id,
      order: { location_id: "LOC1", line_items: [{ base_price_money: { amount: 50_000, currency: "USD" } }], taxes: [{ percentage: "6.00" }] },
      checkout_options: { ask_for_shipping_address: true, shipping_fee: { charge: { amount: 4000 } } },
    });
    expect(links[0].checkout_options.redirect_url).toMatch(new RegExp(`/thanks/${r.data.id}$`));
    expect(await art(s, w.id)).toMatchObject({ status: "reserved" });
    // Another visitor can't buy it meanwhile.
    expect((await buy(slug, "d", { work: w.slug, method: "card" }, senv)).status).toBe(409);

    // A forged or unsigned event is refused and sells nothing.
    const ev = paidEvent(`SQORDER-${r.data.id}`);
    expect((await hook(senv, ev, "bad")).status).toBe(401);
    expect((await hook(senv, ev, await sign(JSON.stringify(ev), HOOK, "wrong-key"))).status).toBe(401);
    expect((await art(s, w.id)).status).toBe("reserved");

    expect((await hook(senv, ev)).status).toBe(200);
    expect((await hook(senv, ev)).status).toBe(200); // Square repeats deliveries
    const o = await ownerOrder(s, r.data.id);
    expect(o).toMatchObject({ status: "paid", paidCents: 57_000, buyerEmail: "card@buyer.test", buyerName: "Card Buyer", conflict: false, shippingAddress: { city: "Austin" } });
    const sold = await art(s, w.id);
    expect(sold.status).toBe("sold");
    expect(sold.meta.sale).toMatchObject({ priceCents: 50_000, orderId: r.data.id });
    const { results: sales } = await env.DB.prepare("SELECT * FROM sales WHERE studio_id = ?").bind(s.studioId).all<any>();
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ source: "square", payment_method: "card", price_cents: 50_000, artwork_id: w.id });
    const client = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(o.clientId).first<any>();
    expect(client.email).toBe("card@buyer.test");
    expect(mails.map((m) => m.subject).filter((x) => x.startsWith("Sold on your site"))).toHaveLength(1);
    expect(mails.some((m) => m.to.includes("card@buyer.test") && m.subject.startsWith("Paid:"))).toBe(true);
    expect((await env.DB.prepare("SELECT count(*) n FROM payment_events WHERE order_id = ?").bind(r.data.id).first<number>("n"))).toBe(1);

    // The buyer's thanks page sees it paid; another browser can't read it.
    expect((await call(`${P(slug)}/visitor/orders/${r.data.id}`, { headers: vh("c") })).data.status).toBe("paid");
    expect((await call(`${P(slug)}/visitor/orders/${r.data.id}`, { headers: vh("d") })).status).toBe(404);

    // A refund marks the order; the piece stays sold for the owner to decide.
    const refund = { type: "refund.updated", event_id: crypto.randomUUID(), data: { object: { refund: { id: "R1", status: "COMPLETED", order_id: `SQORDER-${r.data.id}` } } } };
    expect((await hook(senv, refund)).status).toBe(200);
    expect((await ownerOrder(s, r.data.id)).status).toBe("refunded");
  });

  it("Square down: the order ends at once and the piece is back on sale", async () => {
    const { s, slug, senv } = await setup();
    const w = await work(s);
    squareDown = true;
    expect((await buy(slug, "c", { work: w.slug, method: "card" }, senv)).status).toBe(500);
    expect((await art(s, w.id)).status).toBe("available");
  });

  it("an expired card order releases the piece; a late payment still sells it if free, else is flagged to refund", async () => {
    const { s, slug, senv } = await setup();
    const w = await work(s);
    const r = await buy(slug, "c", { work: w.slug, method: "card" }, senv);
    await runOut(r.data.id);
    expect(await expireOrders(senv, undefined, s.studioId)).toBe(1);
    expect(deleted).toEqual(["LINK1"]);
    expect((await art(s, w.id)).status).toBe("available");
    expect((await ownerOrder(s, r.data.id)).status).toBe("expired");

    // Someone else buys it by Venmo and it's marked paid; then the first card payment lands late.
    const v = await manual(slug, "v", w);
    expect(v.status).toBe(201);
    const ov = await ownerOrder(s, v.data.id);
    expect((await act(s, v.data.id, "mark-paid", ov.version, {})).status).toBe(200);
    mails = [];
    expect((await hook(senv, paidEvent(`SQORDER-${r.data.id}`))).status).toBe(200);
    expect(await ownerOrder(s, r.data.id)).toMatchObject({ status: "paid", conflict: true });
    expect((await env.DB.prepare("SELECT count(*) n FROM sales WHERE studio_id = ?").bind(s.studioId).first<number>("n"))).toBe(1);
    expect(mails.map((m) => m.subject)).toEqual([expect.stringMatching(/^Check order /)]);
  });

  it("never guesses: no tier, no ZIP for a large piece, an unpriced quote piece, or no price can't check out", async () => {
    const { s, slug, senv } = await setup();
    const big = await work(s, { width: 40, height: 30, shipping: { tier: 3 } });
    const unset = await work(s, { shipping: null });
    const quote = await work(s, { shipping: { tier: 4 } });
    const unpriced = await work(s, { priceCents: null });
    const cases = [[big, "needsZip"], [unset, null], [quote, null], [unpriced, null]] as const;
    for (const [w] of cases) expect((await buy(slug, "c", { work: w.slug, method: "card" }, senv)).status).toBe(400);
    expect(links).toHaveLength(0);
  });
});

describe("Venmo and Zelle orders", () => {
  it("hold the piece 48 hours, email instructions, and sell only on the owner's Mark paid", async () => {
    const { s, slug } = await setup();
    const w = await work(s);
    expect((await buy(slug, "m", { work: w.slug, method: "venmo" })).status).toBe(400); // needs name, email, address
    const r = await manual(slug, "m", w);
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ status: "awaiting_payment", totalCents: 57_000, payTo: { venmo: "@Test-Artist", zelle: null }, checkoutUrl: null, returns: "Returns within 7 days." });
    expect(Math.abs(Date.parse(r.data.expiresAt) - (Date.now() + 48 * 3_600_000))).toBeLessThan(60_000);
    expect((await art(s, w.id)).status).toBe("reserved");
    const toBuyer = mails.find((m) => m.to.includes("pat@buyer.test"))!;
    expect(toBuyer.text).toContain("Venmo @Test-Artist");
    expect(toBuyer.text).toContain(r.data.code);
    expect(mails.find((m) => m.subject.startsWith("New Venmo order"))!.text).toContain("1 Main St");

    // Owner: more time, then Mark paid (stale version refused).
    let o = await ownerOrder(s, r.data.id);
    const ext = await act(s, r.data.id, "extend", o.version);
    expect(ext.status).toBe(200);
    expect(Date.parse(ext.data.expiresAt)).toBeGreaterThan(Date.parse(r.data.expiresAt));
    expect((await act(s, r.data.id, "mark-paid", o.version, {})).status).toBe(409);
    o = await ownerOrder(s, r.data.id);
    const paid = await act(s, r.data.id, "mark-paid", o.version, { note: "Venmo 11/12" });
    expect(paid.status).toBe(200);
    expect(paid.data).toMatchObject({ status: "paid", paidCents: 57_000 });
    expect((await art(s, w.id)).status).toBe("sold");
    const sale = await env.DB.prepare("SELECT * FROM sales WHERE studio_id = ?").bind(s.studioId).first<any>();
    expect(sale).toMatchObject({ source: "manual", payment_method: "other" });
    expect(sale.notes).toContain(`Website order ${r.data.code} (Venmo): Venmo 11/12`);
    expect((await act(s, r.data.id, "mark-paid", paid.data.version, {})).status).toBe(400);

    // Ship: one email with the tracking number.
    mails = [];
    const shipped = await act(s, r.data.id, "ship", paid.data.version, { carrier: "USPS", tracking: "9400 1234" });
    expect(shipped.status).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain("9400 1234");
  });

  it("cancel and expiry put the piece back; card orders can't be marked paid by hand", async () => {
    const { s, slug, senv } = await setup();
    const w = await work(s);
    const r = await manual(slug, "m", w, "zelle");
    const o = await ownerOrder(s, r.data.id);
    expect((await act(s, r.data.id, "cancel", o.version)).status).toBe(200);
    expect((await art(s, w.id)).status).toBe("available");

    const r2 = await manual(slug, "m", w, "zelle");
    await runOut(r2.data.id);
    expect(await expireOrders(env, undefined, s.studioId)).toBe(1);
    expect((await art(s, w.id)).status).toBe("available");
    expect((await ownerOrder(s, r2.data.id)).status).toBe("expired");

    const c = await buy(slug, "c", { work: w.slug, method: "card" }, senv);
    expect((await act(s, c.data.id, "mark-paid", (await ownerOrder(s, c.data.id)).version, {})).status).toBe(400);
  });

  it("a visitor whose hold was approved can buy their held piece; others can't; six orders a day", async () => {
    const { s, slug } = await setup();
    const w = await work(s);
    const h = await call(`${P(slug)}/visitor/leads`, { method: "POST", headers: vh("h"), json: { kind: "hold", source: "form", works: [w.slug], email: "h@buyer.test" } });
    const lead = (await call(`/v1/leads/${h.data.id}`, { cookie: s.cookie })).data;
    expect((await call(`/v1/leads/${h.data.id}/approve-hold`, { method: "POST", cookie: s.cookie, headers: { "If-Match": String(lead.version) } })).status).toBe(200);
    expect((await manual(slug, "other", w)).status).toBe(409);
    const r = await manual(slug, "h", w);
    expect(r.status).toBe(201);
    const o = await ownerOrder(s, r.data.id);
    expect(o.leadId).toBe(h.data.id);
    // Cancelling keeps the hold; paying closes the lead.
    expect((await act(s, r.data.id, "cancel", o.version)).status).toBe(200);
    expect((await art(s, w.id)).status).toBe("reserved");
    const r2 = await manual(slug, "h", w);
    expect((await act(s, r2.data.id, "mark-paid", (await ownerOrder(s, r2.data.id)).version, {})).status).toBe(200);
    expect((await call(`/v1/leads/${h.data.id}`, { cookie: s.cookie })).data.status).toBe("closed");

    const many = await work(s, { title: "Many" });
    let codes = 0;
    for (let i = 0; i < 6; i++) {
      const x = await manual(slug, "r", many);
      if (x.status === 201) { codes++; await act(s, x.data.id, "cancel", (await ownerOrder(s, x.data.id)).version); }
    }
    expect(codes).toBe(6);
    expect((await manual(slug, "r", many)).status).toBe(429);
  });
});

describe("tenancy", () => {
  it("another studio's owner can't see or act on an order", async () => {
    const { s, slug } = await setup();
    const w = await work(s);
    const r = await manual(slug, "m", w);
    const b = await makeStudio("B");
    expect((await call(`/v1/orders/${r.data.id}`, { cookie: b.cookie })).status).toBe(404);
    expect((await call("/v1/orders", { cookie: b.cookie })).data.items).toHaveLength(0);
    expect((await act(b, r.data.id, "mark-paid", 1, {})).status).toBe(404);
    expect((await call("/v1/orders", { cookie: s.cookie })).data.items).toHaveLength(1);
  });
});

describe("cart and shipping (D-146…D-154)", () => {
  const quote = (slug: string, who: string, json: Record<string, unknown>) =>
    call(`${P(slug)}/shipping/quote`, { method: "POST", headers: vh(who), json });

  it("a $500 piece takes 20% of its price off a large piece's shipping; both sell on one Mark paid", async () => {
    const { s, slug } = await setup();
    const large = await work(s, { title: "Marsh", priceCents: 120_000, width: 30, height: 24, shipping: { tier: 3 } });
    const q = await work(s, { title: "Egret", priceCents: 50_000 });
    expect((await call(`${P(slug)}/artworks/${large.slug}`)).data.shipping).toEqual({ tier: 3, cents: null, estimate: true, quote: false });
    expect((await call(`${P(slug)}/shipping`)).data.largeOffer).toEqual({ minCents: 50_000, bps: 2000, capCents: null });

    expect((await quote(slug, "cart", { works: [large.slug] })).data).toMatchObject({ ok: false, needsZip: true });
    const alone = (await quote(slug, "cart", { works: [large.slug], zip: "62701" })).data;
    expect(alone).toMatchObject({ ok: true, coveredCents: 0, subtotalCents: 120_000 });
    expect(alone.shippingCents).toBeGreaterThan(0);

    const both = (await quote(slug, "cart", { works: [large.slug, q.slug], zip: "62701" })).data;
    // R2 takes up to $100 off the large piece; R1 drops the $40 tier-2 charge when paired.
    expect(both).toMatchObject({ ok: true, subtotalCents: 170_000, coveredCents: Math.min(10_000, alone.shippingCents) + 4000 });
    expect(both.shippingCents).toBe(alone.shippingCents + 4000 - both.coveredCents);
    expect(both.totalCents).toBe(170_000 + both.shippingCents);

    const order = { works: [large.slug, q.slug], method: "venmo", name: "Pat Buyer", email: "pat@buyer.test", address, zip: "62701" };
    const stale = await buy(slug, "cart", { ...order, shippingCents: both.shippingCents + 100 });
    expect(stale.status).toBe(409);
    expect(stale.data.error.details).toMatchObject({ shippingCents: both.shippingCents });
    expect((await art(s, large.id)).status).toBe("available");

    const r = await buy(slug, "cart", { ...order, shippingCents: both.shippingCents });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ amountCents: 170_000, shippingCents: both.shippingCents, coveredCents: both.coveredCents, title: "Marsh and 1 more" });
    expect(r.data.items.map((i: any) => i.slug)).toEqual([large.slug, q.slug]);
    for (const w of [large, q]) expect((await art(s, w.id)).status).toBe("reserved");

    const o = await ownerOrder(s, r.data.id);
    expect((await act(s, r.data.id, "mark-paid", o.version, {})).status).toBe(200);
    for (const w of [large, q]) expect((await art(s, w.id)).status).toBe("sold");
    const { results } = await env.DB.prepare("SELECT price_cents FROM sales WHERE studio_id = ? ORDER BY price_cents").bind(s.studioId).all<any>();
    expect(results.map((x) => x.price_cents)).toEqual([50_000, 120_000]);
  });

  it("a card cart gets one Square line per piece and the calculator's shipping as a fixed fee", async () => {
    const { s, slug, senv } = await setup();
    const a = await work(s, { title: "One", shipping: { tier: 1 } });
    const b = await work(s, { title: "Two", shipping: { tier: 1 } });
    const r = await buy(slug, "card", { works: [a.slug, b.slug], method: "card" }, senv);
    expect(r.status).toBe(201);
    expect(links[0].quick_pay).toBeUndefined();
    expect(links[0].order.line_items.map((l: any) => l.name)).toEqual(["One", "Two"]);
    expect(links[0].checkout_options.shipping_fee).toBeUndefined(); // two small pieces ship free
  });

  it("two buyers, one piece: the second cart is refused whole and its other piece stays on sale", async () => {
    const { s, slug } = await setup();
    const x = await work(s, { title: "Shared" });
    const y = await work(s, { title: "Other" });
    expect((await manual(slug, "first", x)).status).toBe(201);
    const r = await buy(slug, "second", { works: [x.slug, y.slug], method: "venmo", name: "Sam", email: "sam@buyer.test", address });
    expect(r.status).toBe(409);
    expect((await art(s, y.id)).status).toBe("available");
  });

  it("never quotes from what the visitor sends: prices come from the catalogue", async () => {
    const { s, slug } = await setup();
    const w = await work(s, { priceCents: 80_000 });
    const r = await quote(slug, "p", { works: [w.slug] });
    expect(r.data).toMatchObject({ ok: true, subtotalCents: 80_000, shippingCents: 4000 });
  });

  it("Studio lists each work's tier with a suggestion that never sets it", async () => {
    const { s } = await setup();
    await work(s, { title: "A small", width: 8, height: 10, shipping: null });
    await work(s, { title: "B large", width: 30, height: 24, shipping: null });
    await work(s, { title: "C set", shipping: { tier: 2 } });
    const items = (await call("/v1/artworks/shipping", { cookie: s.cookie })).data.items;
    expect(items.map((x: any) => [x.title, x.shipping?.tier ?? null, x.suggestion.tier])).toEqual([
      ["A small", null, 1], ["B large", null, 3], ["C set", 2, 1], // 12×16 suggests 1; the set tier stands
    ]);
  });
});
