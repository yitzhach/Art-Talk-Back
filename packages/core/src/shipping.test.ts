import { describe, expect, it } from "vitest";
import { newId } from "./ids";
import {
  type ArtworkShipping, type ShipWork, boxOf, estimateCents, isOversize, shippingFor, shippingSettings, suggestTier, wouldUnlock, zoneFor,
} from "./shipping";

const s = shippingSettings(undefined);
const today = "2026-11-12";
let n = 0;
/** A work: width × height inches, a price in dollars, a tier and its shipping. */
function w(width: number, height: number, price: number, sh: ArtworkShipping | null, extra: Partial<ShipWork> = {}): ShipWork {
  n++;
  return { id: newId(), slug: `w${n}`, title: `Work ${n}`, priceCents: price * 100, status: "available", width, height, depth: 1.5, sizeUnit: "in", shipping: sh, ...extra };
}
const large = (price = 2400, cents = 12000) => w(30, 40, price, { tier: 3, cents });
const ask = (works: ShipWork[], more: Partial<Parameters<typeof shippingFor>[0]> = {}) => shippingFor({ works, settings: s, today, ...more });

describe("shipping: the worked examples (a large piece's shipping $120)", () => {
  it("tier 1 ships free, alone or two together", () => {
    expect(ask([w(16, 16, 450, { tier: 1 })])).toMatchObject({ ok: true, shippingCents: 0, nudge: { kind: "free" } });
    expect(ask([w(16, 16, 450, { tier: 1 }), w(12, 24, 400, { tier: 1 })]).shippingCents).toBe(0);
  });
  it("tier 2 alone is $22, with the nudge", () => {
    const r = ask([w(18, 20, 650, { tier: 2 })]);
    expect(r.shippingCents).toBe(2200);
    expect(r.nudge).toMatchObject({ kind: "tier2Alone", text: "Add any other work and the $22 shipping is on us." });
  });
  it("R1: tier 2 plus anything ships free", () => {
    const r = ask([w(18, 20, 650, { tier: 2 }), w(12, 12, 200, { tier: 1 })]);
    expect(r).toMatchObject({ shippingCents: 0, coveredCents: 2200, ruleIds: ["r1"], nudge: { kind: "covered" } });
  });
  it("one large piece pays its own price, with the nudge", () => {
    const r = ask([large()]);
    expect(r.shippingCents).toBe(12000);
    expect(r.nudge?.kind).toBe("largeAlone");
    expect(r.nudge?.text).toContain("$500");
  });
  it("R2: a $600 tier 1 piece takes 20% ($120) off: free", () => {
    expect(ask([large(), w(16, 16, 600, { tier: 1 })])).toMatchObject({ shippingCents: 0, coveredCents: 12000, ruleIds: ["r2"] });
  });
  it("R2: a $500 piece takes $100 off: $20", () => {
    expect(ask([large(), w(16, 16, 500, { tier: 1 })]).shippingCents).toBe(2000);
  });
  it("R2: under the $500 minimum, nothing comes off", () => {
    expect(ask([large(), w(16, 16, 300, { tier: 1 })]).shippingCents).toBe(12000);
    expect(ask([large(), w(16, 16, 499.99, { tier: 1 })]).shippingCents).toBe(12000);
  });
  it("R1 and R2 together: large + 18×20 ($550) → $10", () => {
    const r = ask([large(), w(18, 20, 550, { tier: 2 })]);
    expect(r.shippingCents).toBe(1000);
    expect(r.ruleIds.sort()).toEqual(["r1", "r2"]);
  });
  it("one qualifier covers one large piece", () => {
    expect(ask([large(), large(), w(16, 16, 600, { tier: 1 })]).shippingCents).toBe(12000);
    expect(ask([large(), large(), w(16, 16, 600, { tier: 1 }), w(16, 16, 700, { tier: 1 })]).shippingCents).toBe(0);
  });
  it("the saving stops at the piece's own shipping, with no cap (D-149)", () => {
    expect(ask([large(2400, 21000), w(16, 16, 600, { tier: 1 })]).shippingCents).toBe(9000);
    expect(ask([large(2400, 21000), w(16, 16, 1000, { tier: 1 })]).shippingCents).toBe(1000);
    expect(ask([large(2400, 12000), w(16, 16, 1000, { tier: 1 })]).shippingCents).toBe(0);
  });
  it("an optional cap holds when set", () => {
    const capped = shippingSettings({ r2: { capCents: 15000 } });
    expect(shippingFor({ works: [large(2400, 21000), w(16, 16, 1000, { tier: 1 })], settings: capped, today }).shippingCents).toBe(6000);
  });
  it("the biggest saving goes to the biggest shipping", () => {
    const r = ask([large(2400, 20000), large(2400, 5000), w(16, 16, 1000, { tier: 1 }), w(16, 16, 500, { tier: 1 })]);
    // $200 off the $200 piece, $50 (of a $100 share) off the $50 piece.
    expect(r.shippingCents).toBe(0);
  });
  it("anything with a tier 4 piece needs a quote", () => {
    expect(ask([w(16, 16, 450, { tier: 1 }), w(40, 60, 5000, { tier: 4 })])).toMatchObject({ ok: false, nudge: { kind: "quote" } });
    expect(ask([w(40, 60, 5000, { tier: 4 })]).quote).toHaveLength(1);
    expect(ask([w(16, 16, 450, { tier: 1, customQuote: true })]).quote).toHaveLength(1);
  });
});

describe("shipping: never guess (D-150)", () => {
  it("a piece with no tier blocks checkout", () => {
    const r = ask([w(16, 16, 450, null)]);
    expect(r.ok).toBe(false);
    expect(r.blocked[0]?.why).toMatch(/isn't set/);
  });
  it("sold or reserved blocks it; the buyer's own hold doesn't", () => {
    expect(ask([w(16, 16, 450, { tier: 1 }, { status: "sold" })]).blocked).toHaveLength(1);
    expect(ask([w(16, 16, 450, { tier: 1 }, { status: "reserved" })]).blocked).toHaveLength(1);
    expect(ask([w(16, 16, 450, { tier: 1 }, { status: "reserved", heldForBuyer: true })]).ok).toBe(true);
  });
  it("an empty cart isn't ok", () => {
    expect(ask([]).ok).toBe(false);
  });
});

describe("shipping: rules on, off and dated", () => {
  const pair = () => [w(18, 20, 650, { tier: 2 }), w(12, 12, 200, { tier: 1 })];
  const at = (r1: object, day = today) => shippingFor({ works: pair(), settings: shippingSettings({ r1 }), today: day }).shippingCents;
  it("R1 off charges the $22", () => expect(at({ on: false })).toBe(2200));
  it("R1 before its start, on its first and last day, after its end", () => {
    expect(at({ starts: "2026-12-01" })).toBe(2200);
    expect(at({ starts: "2026-11-12" })).toBe(0);
    expect(at({ ends: "2026-11-12" })).toBe(0);
    expect(at({ ends: "2026-11-11" })).toBe(2200);
  });
  it("R2 off leaves the large piece's shipping", () => {
    expect(shippingFor({ works: [large(), w(16, 16, 600, { tier: 1 })], settings: shippingSettings({ r2: { on: false } }), today }).shippingCents).toBe(12000);
  });
  it("a piece out of the promotion neither qualifies nor is covered", () => {
    expect(ask([large(), w(16, 16, 600, { tier: 1, promo: false })]).shippingCents).toBe(12000);
    expect(ask([w(30, 40, 2400, { tier: 3, cents: 12000, promo: false }), w(16, 16, 600, { tier: 1 })]).shippingCents).toBe(12000);
  });
});

describe("shipping: the ZIP estimate (D-153)", () => {
  const big = () => w(24, 24, 1800, { tier: 3 });
  it("a large piece without a price needs the buyer's ZIP", () => {
    const r = ask([big()]);
    expect(r).toMatchObject({ ok: false, needsZip: true });
  });
  it("near costs less than far, and both include the surcharge and cushion", () => {
    const near = ask([big()], { zip: "40502" }), far = ask([big()], { zip: "94110" });
    expect(near.ok && far.ok).toBe(true);
    expect(near.shippingCents).toBeLessThan(far.shippingCents);
    expect(near.shippingCents % 100).toBe(0);
    expect(near.lines[0]?.estimate).toBe(true);
  });
  it("the 20% comes off the estimate", () => {
    const alone = ask([big()], { zip: "94110" }).shippingCents;
    expect(ask([big(), w(16, 16, 600, { tier: 1 })], { zip: "94110" }).shippingCents).toBe(Math.max(0, alone - 12000));
  });
  it("an oversize box is a quote", () => {
    expect(ask([w(24, 36, 3000, { tier: 3 })], { zip: "94110" }).quote).toHaveLength(1);
  });
  it("Alaska, Hawaii and other countries are a quote; local pickup is free when offered", () => {
    expect(ask([big()], { zip: "99501" }).nudge?.kind).toBe("quote");
    expect(ask([w(16, 16, 450, { tier: 1 })], { country: "CA" }).nudge?.kind).toBe("quote");
    expect(ask([big()], { pickup: true }).ok).toBe(false);
    const pickup = shippingFor({ works: [big()], settings: shippingSettings({ pickup: { on: true } }), today, pickup: true });
    expect(pickup).toMatchObject({ ok: true, shippingCents: 0 });
  });
  it("boxes add 2 in of packing a side; 20×26 and 24×30 aren't oversize, 24×36 is", () => {
    expect(boxOf({ width: 20, height: 26, depth: 1.5, sizeUnit: "in" }, s)).toEqual({ l: 30, w: 24, h: 5.5 });
    expect(isOversize(boxOf({ width: 20, height: 26, depth: 1.5, sizeUnit: "in" }, s)!)).toBe(false);
    expect(isOversize(boxOf({ width: 24, height: 30, depth: 1.5, sizeUnit: "in" }, s)!)).toBe(false);
    expect(isOversize(boxOf({ width: 24, height: 36, depth: 1.5, sizeUnit: "in" }, s)!)).toBe(true);
  });
  it("zones go up with distance from 42503", () => {
    expect(zoneFor("42503", "42501")).toBe(2);
    expect(zoneFor("42503", "10001")).toBeGreaterThanOrEqual(4);
    expect(zoneFor("42503", "94110")).toBe(8);
    expect(zoneFor("42503", "96813")).toBeNull();
  });
  it("a heavy piece bills its weight", () => {
    const b = boxOf({ width: 20, height: 20, depth: 1.5, sizeUnit: "in" }, s)!;
    expect(estimateCents(b, 40, 5, s)).toBeGreaterThan(estimateCents(b, null, 5, s));
  });
});

describe("shipping: tier suggestions", () => {
  const t = (width: number, height: number, depth = 1.5, sh: ArtworkShipping | null = null) => suggestTier({ width, height, depth, sizeUnit: "in", shipping: sh }, s);
  it("by area and longest side, 24×24 and up large", () => {
    expect(t(16, 16).tier).toBe(1);
    expect(t(12, 24).tier).toBe(1);
    expect(t(18, 20).tier).toBe(2);
    expect(t(20, 26).tier).toBe(2);
    expect(t(24, 24).tier).toBe(3);
    expect(t(24, 36).tier).toBe(4);
    expect(t(16, 16, 8).tier).toBe(4);
  });
  it("Check size near a line or with no size", () => {
    expect(t(16, 18).check).toBe(true); // 288 sq in, near 300
    expect(t(10, 10).check).toBe(false);
    expect(suggestTier({ width: null, height: null, depth: null, sizeUnit: "in", shipping: null }, s)).toMatchObject({ tier: null, check: true });
  });
  it("converts centimetres", () => expect(suggestTier({ width: 40, height: 40, depth: 3, sizeUnit: "cm", shipping: null }, s).tier).toBe(1));
});

describe("shipping: suggestions only where they unlock something", () => {
  it("for a large piece, only a tier 1 or 2 piece at the minimum", () => {
    const r = ask([large()]);
    expect(wouldUnlock(r, { priceCents: 60000, shipping: { tier: 1 } }, s)).toBe(true);
    expect(wouldUnlock(r, { priceCents: 40000, shipping: { tier: 1 } }, s)).toBe(false);
    expect(wouldUnlock(r, { priceCents: 60000, shipping: { tier: 1, promo: false } }, s)).toBe(false);
  });
  it("nothing for a cart that already ships free", () => {
    expect(wouldUnlock(ask([w(16, 16, 450, { tier: 1 })]), { priceCents: 60000, shipping: { tier: 1 } }, s)).toBe(false);
  });
});

describe("shipping: a quoted piece with the owner's price (D-154)", () => {
  it("becomes buyable at that price, and the offer still applies", () => {
    expect(ask([w(40, 60, 5000, { tier: 4, cents: 30000 })]).shippingCents).toBe(30000);
    expect(ask([w(40, 60, 5000, { tier: 4, cents: 30000 }), w(16, 16, 1000, { tier: 1 })]).shippingCents).toBe(10000);
  });
});
