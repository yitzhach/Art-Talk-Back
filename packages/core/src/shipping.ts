// Shipping for the site's cart (Site 3.0 stage 4 revision, D-146…D-153). Pure: no I/O, no clock (`today` is passed
// in). studio-api is its only caller, so the cart, the quote and the order always agree.
//
// Tiers: 1 free, 2 a flat rate, 3 large (an estimate for the buyer's ZIP, or a price the owner pins), 4 quote.
// A tier 3 piece whose packed box is oversize for UPS is a quote too: the owner sends his own estimate (D-153).
// Rules: R1 waives a tier 2 piece's rate when the order holds another piece; R2 takes a share of a qualifying
// piece's price off one large piece's shipping (one qualifier per large piece; D-148, D-149).
import { z } from "zod";
import { ZIP3 } from "./zip3";

const Id = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "A ULID");
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const Cents = z.number().int().min(0).max(1_000_000);

export const ShipTier = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type ShipTier = z.infer<typeof ShipTier>;

/** A work's own shipping (artworks.shipping, migration 0014). Every field optional; null tier = not set yet. */
export const ArtworkShipping = z.object({
  /** Set only by the owner's tap (D-150: never guessed). */
  tier: ShipTier.nullable().optional(),
  /** A fixed shipping price for a tier 3 piece, in cents; unset → the ZIP estimate. */
  cents: Cents.nullable().optional(),
  /** The piece's own weight, pounds; packing is added. Unset → the box's size weight alone. */
  weightLb: z.number().min(0).max(500).nullable().optional(),
  /** Off: the piece neither qualifies for nor gets an offer. Default on. */
  promo: z.boolean().optional(),
  crated: z.boolean().optional(),
  customQuote: z.boolean().optional(),
  fragile: z.boolean().optional(),
  /** Up to three works the owner pairs with this one (shown first as suggestions). */
  pairsWith: z.array(Id).max(3).optional(),
}).strict();
export type ArtworkShipping = z.infer<typeof ArtworkShipping>;

const Rule = z.object({ on: z.boolean().optional(), starts: Day.nullable().optional(), ends: Day.nullable().optional() }).strict();
const Words = z.string().trim().min(1).max(200);

/** The studio's shipping settings (settings.meta.site.shipping). Everything optional; defaults below. */
export const ShippingSettings = z.object({
  tier1MaxSqIn: z.number().min(1).max(10_000).optional(),
  tier1MaxLongIn: z.number().min(1).max(200).optional(),
  /** Tier 2 is under this area (24×24 = 576 is large, D-146). */
  tier2MaxSqIn: z.number().min(1).max(10_000).optional(),
  tier2MaxLongIn: z.number().min(1).max(200).optional(),
  tier2Cents: Cents.optional(),
  originZip: z.string().regex(/^\d{5}$/, "A 5-digit ZIP").optional(),
  /** Packing on every side of the piece, inches (D-153: 2). */
  paddingIn: z.number().min(0).max(12).optional(),
  /** Box and packing weight added to the piece's own, pounds. */
  packingLb: z.number().min(0).max(100).optional(),
  /** Added to every estimate: shipments go to homes. */
  residentialCents: Cents.optional(),
  /** Added to every estimate so it's never low, basis points (1000 = 10%). */
  cushionBps: z.number().int().min(0).max(10_000).optional(),
  /** What a box costs to ship by zone and billable pound, from the carrier's own calculator. */
  rates: z.object({
    asOf: Day,
    weights: z.array(z.number().int().min(1).max(150)).min(2).max(30),
    /** Zone ("2"…"8") → cents at each weight, same length as weights. */
    zones: z.record(z.enum(["2", "3", "4", "5", "6", "7", "8"]), z.array(Cents).min(2).max(30)),
  }).strict().optional(),
  r1: Rule.optional(),
  r2: Rule.extend({
    /** A qualifying piece costs at least this (D-148: $500). */
    minCents: Cents.optional(),
    /** The share of the qualifier's price that comes off, basis points (2000 = 20%). */
    bps: z.number().int().min(0).max(10_000).optional(),
    /** At most this off one large piece; null = no cap (D-149). */
    capCents: Cents.nullable().optional(),
  }).strict().optional(),
  pickup: z.object({ on: z.boolean().optional(), words: Words.optional() }).strict().optional(),
  words: z.object({
    free: Words.optional(), tier2Alone: Words.optional(), largeAlone: Words.optional(), covered: Words.optional(), quote: Words.optional(),
  }).strict().optional(),
}).strict();
export type ShippingSettingsInput = z.infer<typeof ShippingSettings>;

/**
 * Starting rates: UPS Ground's published 2026 daily rates, zones 2–8 (a third-party copy, checked 2026-11-12). Pirate
 * Ship's prices are usually lower, so these estimate high until the owner enters his own (D-153).
 */
export const DEFAULT_RATES = {
  asOf: "2026-11-12",
  weights: [1, 2, 3, 5, 10, 15, 20, 30, 50],
  zones: {
    "2": [1199, 1285, 1338, 1419, 1591, 1796, 1920, 2320, 2953],
    "3": [1238, 1415, 1491, 1571, 1698, 1911, 2147, 2734, 3660],
    "4": [1351, 1546, 1608, 1715, 1875, 2007, 2188, 2994, 4361],
    "5": [1410, 1579, 1693, 1865, 2046, 2268, 2697, 3595, 5302],
    "6": [1460, 1649, 1765, 1945, 2119, 2620, 3147, 4495, 6673],
    "7": [1483, 1718, 1828, 2054, 2383, 3160, 3835, 5232, 8062],
    "8": [1503, 1740, 1914, 2172, 2629, 3525, 4333, 6208, 9026],
  },
} as const;

export const SHIPPING_WORDS = {
  free: "Ships free",
  tier2Alone: "Add any other work and the {amount} shipping is on us.",
  largeAlone: "Add another original from {min} and {share} of its price comes off this piece's {amount} shipping.",
  covered: "Isaac is covering {amount} of shipping on this order.",
  quote: "This work needs a shipping quote. Isaac usually replies within a day.",
} as const;

export interface Shipping {
  tier1MaxSqIn: number; tier1MaxLongIn: number; tier2MaxSqIn: number; tier2MaxLongIn: number; tier2Cents: number;
  originZip: string; paddingIn: number; packingLb: number; residentialCents: number; cushionBps: number;
  rates: { asOf: string; weights: readonly number[]; zones: Readonly<Record<string, readonly number[]>> };
  r1: { on: boolean; starts: string | null; ends: string | null };
  r2: { on: boolean; starts: string | null; ends: string | null; minCents: number; bps: number; capCents: number | null };
  pickup: { on: boolean; words: string | null };
  words: Record<keyof typeof SHIPPING_WORDS, string>;
}

/** The studio's settings with every default filled in (Isaac's answers, 2026-11-12). */
export function shippingSettings(s: ShippingSettingsInput | undefined): Shipping {
  const v = s ?? {};
  return {
    tier1MaxSqIn: v.tier1MaxSqIn ?? 300, tier1MaxLongIn: v.tier1MaxLongIn ?? 24,
    tier2MaxSqIn: v.tier2MaxSqIn ?? 576, tier2MaxLongIn: v.tier2MaxLongIn ?? 30, tier2Cents: v.tier2Cents ?? 2200,
    originZip: v.originZip ?? "42503", paddingIn: v.paddingIn ?? 2, packingLb: v.packingLb ?? 3,
    residentialCents: v.residentialCents ?? 600, cushionBps: v.cushionBps ?? 1000,
    rates: v.rates ?? DEFAULT_RATES,
    r1: { on: v.r1?.on ?? true, starts: v.r1?.starts ?? null, ends: v.r1?.ends ?? null },
    r2: {
      on: v.r2?.on ?? true, starts: v.r2?.starts ?? null, ends: v.r2?.ends ?? null, minCents: v.r2?.minCents ?? 50_000,
      bps: v.r2?.bps ?? 2000, capCents: v.r2?.capCents ?? null,
    },
    pickup: { on: v.pickup?.on ?? false, words: v.pickup?.words ?? null },
    words: Object.fromEntries(Object.entries(SHIPPING_WORDS).map(([k, d]) => [k, v.words?.[k as keyof typeof SHIPPING_WORDS] ?? d])) as Shipping["words"],
  };
}

// ------------------------------------------------------------------ sizes, boxes, zones

/** What the calculator needs of a work. */
export interface ShipWork {
  id: string;
  slug: string | null;
  title: string;
  priceCents: number | null;
  status: string;
  width: number | null;
  height: number | null;
  depth: number | null;
  sizeUnit: "in" | "cm";
  shipping: ArtworkShipping | null;
  /** Set aside for this buyer (their approved hold), so reserved is fine. */
  heldForBuyer?: boolean;
}

const inches = (n: number | null, unit: "in" | "cm") => (n === null || !Number.isFinite(n) || n <= 0 ? null : unit === "cm" ? n / 2.54 : n);
/** Most paintings are about this deep when the depth isn't recorded. */
export const DEFAULT_DEPTH_IN = 1.5;

export interface Box { l: number; w: number; h: number }

/** The packed box, longest side first, or null without a width and height. */
export function boxOf(w: Pick<ShipWork, "width" | "height" | "depth" | "sizeUnit">, s: Shipping): Box | null {
  const a = inches(w.width, w.sizeUnit), b = inches(w.height, w.sizeUnit);
  if (a === null || b === null) return null;
  const d = inches(w.depth, w.sizeUnit) ?? DEFAULT_DEPTH_IN;
  const [l, wd, h] = [a, b, d].map((x) => x + 2 * s.paddingIn).sort((x, y) => y - x) as [number, number, number];
  return { l, w: wd, h };
}

/** Over UPS's additional-handling or large-package lines (D-153): the owner quotes it himself. */
export function isOversize(b: Box): boolean {
  return b.l > 48 || b.w > 30 || b.l + 2 * (b.w + b.h) > 105;
}

/** UPS bills the larger of the weight and the size weight (L × W × H ÷ 139), in whole pounds. */
export function billableLb(b: Box, weightLb: number | null | undefined, s: Shipping): number {
  const size = Math.ceil((b.l * b.w * b.h) / 139);
  const real = weightLb ? Math.ceil(weightLb + s.packingLb) : 0;
  return Math.max(1, size, real);
}

/** Places a ZIP code can't get a ground estimate to: Alaska, Hawaii, territories, military mail. */
const FAR = /^(00[6-9]|09\d|340|96[2-9]|99[5-9])/;

const miles = (a: readonly [number, number], b: readonly [number, number]) => {
  const r = Math.PI / 180, [la1, lo1] = a, [la2, lo2] = b;
  const h = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
};

/** UPS Ground's zone (2–8) by the distance between ZIP prefixes, or null when there's no ground estimate. */
export function zoneFor(originZip: string, destZip: string): number | null {
  if (!/^\d{5}$/.test(destZip) || FAR.test(destZip)) return null;
  const a = ZIP3[originZip.slice(0, 3)], b = ZIP3[destZip.slice(0, 3)];
  if (!a || !b) return null;
  const m = miles(a, b);
  return m <= 150 ? 2 : m <= 300 ? 3 : m <= 600 ? 4 : m <= 1000 ? 5 : m <= 1400 ? 6 : m <= 1800 ? 7 : 8;
}

/** The rate grid's price for a zone and weight, straight-line between the weights it lists (and past the last). */
export function rateCents(zone: number, lb: number, s: Shipping): number {
  const { weights } = s.rates;
  const row = s.rates.zones[String(zone)] ?? s.rates.zones["8"]!;
  let i = weights.findIndex((x) => x >= lb);
  if (i === 0) return row[0]!;
  if (i < 0) i = weights.length - 1;
  const [w0, w1, c0, c1] = [weights[i - 1]!, weights[i]!, row[i - 1]!, row[i]!];
  return Math.round(c0 + ((c1 - c0) * (lb - w0)) / (w1 - w0));
}

/** What a box costs the buyer to ship to a ZIP: the rate, the home-delivery surcharge and the cushion, up to the dollar. */
export function estimateCents(b: Box, weightLb: number | null | undefined, zone: number, s: Shipping): number {
  const base = rateCents(zone, billableLb(b, weightLb, s), s) + s.residentialCents;
  return Math.ceil((base * (10_000 + s.cushionBps)) / 10_000 / 100) * 100;
}

// ------------------------------------------------------------------ tiers

export interface TierSuggestion { tier: ShipTier | null; check: boolean; reason: string }

/** A tier to offer the owner (he taps to accept; D-150). "Check size" when it's close to a line or unknown. */
export function suggestTier(w: Pick<ShipWork, "width" | "height" | "depth" | "sizeUnit" | "shipping">, s: Shipping): TierSuggestion {
  const a = inches(w.width, w.sizeUnit), b = inches(w.height, w.sizeUnit);
  if (a === null || b === null) return { tier: null, check: true, reason: "No size recorded" };
  const d = inches(w.depth, w.sizeUnit);
  const box = boxOf(w, s)!;
  if (w.shipping?.crated || w.shipping?.customQuote) return { tier: 4, check: false, reason: "Crated or quoted" };
  if ((d ?? 0) > 6) return { tier: 4, check: false, reason: "Deeper than 6 in" };
  if (isOversize(box)) return { tier: 4, check: false, reason: "Oversize box for UPS" };
  const area = a * b, long = Math.max(a, b);
  const near = (x: number, line: number) => Math.abs(x - line) <= line * 0.1;
  const check = near(area, s.tier1MaxSqIn) || near(area, s.tier2MaxSqIn) || near(long, s.tier1MaxLongIn) || near(long, s.tier2MaxLongIn);
  if (area <= s.tier1MaxSqIn && long <= s.tier1MaxLongIn) return { tier: 1, check, reason: "Small" };
  if (area < s.tier2MaxSqIn && long <= s.tier2MaxLongIn) return { tier: 2, check, reason: "Medium" };
  return { tier: 3, check, reason: "Large" };
}

// ------------------------------------------------------------------ the calculation

export interface ShipLine {
  id: string;
  slug: string | null;
  tier: ShipTier;
  /** Before any rule. */
  baseCents: number;
  /** What the buyer pays for this piece's shipping. */
  chargedCents: number;
  coveredCents: number;
  rule: "r1" | "r2" | null;
  /** True when the base is an estimate for the buyer's ZIP. */
  estimate: boolean;
}

export interface ShipNudge { kind: "free" | "tier2Alone" | "largeAlone" | "covered" | "quote"; text: string; amountCents: number }

export interface ShipResult {
  /** Checkout can go ahead. */
  ok: boolean;
  /** Pieces that need the owner's quote first (tier 4, oversize, custom, outside the US). */
  quote: string[];
  /** Pieces that can't be bought now, with why. */
  blocked: { id: string; why: string }[];
  /** A large piece needs the buyer's ZIP before its shipping is known. */
  needsZip: boolean;
  lines: ShipLine[];
  /** What the buyer pays for shipping. */
  shippingCents: number;
  /** What the studio gives away. */
  coveredCents: number;
  ruleIds: ("r1" | "r2")[];
  reason: string;
  nudge: ShipNudge | null;
}

export interface ShipQuestion {
  works: ShipWork[];
  settings: Shipping;
  /** The buyer's 5-digit ZIP, when known. */
  zip?: string | null;
  /** Anything but "US" is a quote (D-102, Isaac 2026-11-12). */
  country?: string | null;
  pickup?: boolean;
  /** YYYY-MM-DD, for the rules' dates. */
  today: string;
}

const active = (r: { on: boolean; starts: string | null; ends: string | null }, today: string) =>
  r.on && (!r.starts || r.starts <= today) && (!r.ends || today <= r.ends);
export const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);
const promo = (w: ShipWork) => w.shipping?.promo !== false;

/** Shipping for a cart: one function for the cart line, the quote route and the order (D-151). */
export function shippingFor(q: ShipQuestion): ShipResult {
  const s = q.settings;
  const out: ShipResult = { ok: false, quote: [], blocked: [], needsZip: false, lines: [], shippingCents: 0, coveredCents: 0, ruleIds: [], reason: "", nudge: null };
  if (!q.works.length) return { ...out, reason: "The cart is empty" };

  const sellable = (w: ShipWork) => (w.status === "available" || (w.status === "reserved" && w.heldForBuyer)) && (w.priceCents ?? 0) > 0;
  const zone = q.zip ? zoneFor(s.originZip, q.zip) : null;

  // 1–2. Quotes, then anything that can't be bought. Never guess a tier.
  for (const w of q.works) {
    const sh = w.shipping ?? {};
    const box = boxOf(w, s);
    if (!sellable(w)) { out.blocked.push({ id: w.id, why: w.status === "sold" ? "Already sold" : w.status === "reserved" ? "Set aside for someone" : "Not for sale online" }); continue; }
    // A quoted piece becomes buyable once the owner pins its shipping price (his reply to the inquiry; D-154).
    if ((sh.tier === 4 || sh.customQuote || sh.crated) && sh.cents == null) { out.quote.push(w.id); continue; }
    if (!sh.tier) { out.blocked.push({ id: w.id, why: "Shipping isn't set for this piece yet" }); continue; }
    if (sh.tier === 3 && sh.cents == null && (!box || isOversize(box))) { out.quote.push(w.id); continue; }
  }
  if (out.blocked.length || out.quote.length) {
    out.reason = out.quote.length ? "Needs a shipping quote" : "Something in the cart can't be bought";
    if (out.quote.length) out.nudge = { kind: "quote", text: s.words.quote, amountCents: 0 };
    return out;
  }

  // 3. Local pickup.
  if (q.pickup && s.pickup.on) {
    out.lines = q.works.map((w) => ({ id: w.id, slug: w.slug, tier: w.shipping!.tier!, baseCents: 0, chargedCents: 0, coveredCents: 0, rule: null, estimate: false }));
    return { ...out, ok: true, reason: "Picked up at the studio" };
  }

  // 4. Outside the US, or no ground estimate to this ZIP.
  if ((q.country && q.country !== "US") || (q.zip && zone === null && q.works.some((w) => w.shipping!.tier === 3 && w.shipping!.cents == null))) {
    return { ...out, quote: q.works.map((w) => w.id), reason: "Needs a shipping quote", nudge: { kind: "quote", text: s.words.quote, amountCents: 0 } };
  }

  // 5. Each piece's own shipping.
  for (const w of q.works) {
    const sh = w.shipping!;
    let base = 0, estimate = false;
    if (sh.tier === 4 || ((sh.customQuote || sh.crated) && sh.cents != null)) base = sh.cents!;
    else if (sh.tier === 2) base = s.tier2Cents;
    else if (sh.tier === 3) {
      if (sh.cents != null) base = sh.cents;
      else if (zone === null) out.needsZip = true;
      else { base = estimateCents(boxOf(w, s)!, sh.weightLb, zone, s); estimate = true; }
    }
    out.lines.push({ id: w.id, slug: w.slug, tier: sh.tier!, baseCents: base, chargedCents: base, coveredCents: 0, rule: null, estimate });
  }

  // 6. The rules.
  const today = q.today;
  const byId = new Map(q.works.map((w) => [w.id, w]));
  if (active(s.r1, today) && q.works.length > 1) {
    for (const l of out.lines) {
      if (l.tier === 2 && l.chargedCents > 0 && promo(byId.get(l.id)!)) {
        l.coveredCents = l.chargedCents; l.chargedCents = 0; l.rule = "r1";
      }
    }
  }
  if (active(s.r2, today)) {
    const qualifiers = q.works.filter((w) => (w.shipping!.tier === 1 || w.shipping!.tier === 2) && promo(w) && (w.priceCents ?? 0) >= s.r2.minCents)
      .map((w) => Math.floor(((w.priceCents ?? 0) * s.r2.bps) / 10_000)).sort((a, b) => b - a);
    const large = out.lines.filter((l) => l.tier >= 3 && l.chargedCents > 0 && promo(byId.get(l.id)!)).sort((a, b) => b.chargedCents - a.chargedCents);
    large.forEach((l, i) => {
      const share = qualifiers[i];
      if (share === undefined) return;
      const off = Math.min(l.chargedCents, share, s.r2.capCents ?? Infinity);
      if (off <= 0) return;
      l.chargedCents -= off; l.coveredCents += off; l.rule = "r2";
    });
  }

  out.shippingCents = out.lines.reduce((n, l) => n + l.chargedCents, 0);
  out.coveredCents = out.lines.reduce((n, l) => n + l.coveredCents, 0);
  out.ruleIds = [...new Set(out.lines.flatMap((l) => (l.rule ? [l.rule] : [])))];
  out.ok = !out.needsZip;
  out.reason = out.needsZip ? "Enter your ZIP for the large piece's shipping"
    : out.shippingCents === 0 ? (out.coveredCents ? "Shipping covered" : "Ships free")
    : out.coveredCents ? "Part of the shipping covered" : "Shipping charged";
  out.nudge = nudgeFor(out, q.works, s, today);
  return out;
}

/** The one quiet line under the cart (Part 4). Amounts always come from the calculation. */
function nudgeFor(r: ShipResult, works: ShipWork[], s: Shipping, today: string): ShipNudge | null {
  if (r.needsZip) return null;
  if (r.coveredCents > 0) return { kind: "covered", text: fill(s.words.covered, { amount: dollars(r.coveredCents) }), amountCents: r.coveredCents };
  if (r.shippingCents === 0) return { kind: "free", text: s.words.free, amountCents: 0 };
  const only = r.lines.length === 1 ? r.lines[0]! : null;
  if (only && only.tier === 2 && active(s.r1, today) && promo(works[0]!)) {
    return { kind: "tier2Alone", text: fill(s.words.tier2Alone, { amount: dollars(only.chargedCents) }), amountCents: only.chargedCents };
  }
  const large = r.lines.find((l) => l.tier >= 3 && l.chargedCents > 0 && promo(works.find((w) => w.id === l.id)!));
  if (large && active(s.r2, today)) {
    return {
      kind: "largeAlone", amountCents: large.chargedCents,
      text: fill(s.words.largeAlone, { amount: dollars(large.chargedCents), min: dollars(s.r2.minCents), share: `${s.r2.bps / 100}%` }),
    };
  }
  return null;
}

/** What a suggestion card would unlock, or null when it wouldn't help this cart. */
export function wouldUnlock(r: ShipResult, candidate: Pick<ShipWork, "priceCents" | "shipping">, s: Shipping): boolean {
  if (!r.nudge || candidate.shipping?.promo === false) return false;
  const t = candidate.shipping?.tier;
  if (r.nudge.kind === "tier2Alone") return t === 1 || t === 2 || t === 3;
  if (r.nudge.kind === "largeAlone") return (t === 1 || t === 2) && (candidate.priceCents ?? 0) >= s.r2.minCents;
  return false;
}
