// The studio side of shipping (D-146…D-154): reads the studio's settings and works, and calls the one calculator in
// @studio/core. The site never works shipping out itself.
import {
  type ArtworkShipping, type PublicArtwork, type PublicShipping, type ShipWork, type Shipping, type SiteProfile, ArtworkShipping as ShippingSchema,
  boxOf, isOversize, shippingSettings,
} from "@studio/core";
import type { z } from "zod";

type Row = Record<string, unknown>;

/** The studio's shipping with defaults filled in. */
export const shippingOf = (site: z.infer<typeof SiteProfile>): Shipping => shippingSettings(site.shipping);

const parse = (v: unknown): ArtworkShipping | null => {
  const raw = typeof v === "string" ? (() => { try { return JSON.parse(v) as unknown; } catch { return null; } })() : v;
  if (!raw) return null;
  const ok = ShippingSchema.safeParse(raw);
  return ok.success ? ok.data : null;
};

/** A work row (snake_case from SQL or camelCase from a record) as the calculator wants it. */
export function shipWorkOf(r: Row, heldForBuyer = false): ShipWork {
  const g = (snake: string, camel: string) => (r[snake] ?? r[camel]) as never;
  return {
    id: r.id as string, slug: (r.slug as string | null) ?? null, title: (r.title as string) ?? "A piece",
    priceCents: (g("price_cents", "priceCents") as number | null) ?? null, status: r.status as string,
    width: (r.width as number | null) ?? null, height: (r.height as number | null) ?? null, depth: (r.depth as number | null) ?? null,
    sizeUnit: (g("size_unit", "sizeUnit") as "in" | "cm" | undefined) ?? "in", shipping: parse(r.shipping), heldForBuyer,
  };
}

/** What a piece page shows of its shipping (PublicArtwork.shipping). */
export function publicWorkShipping(r: Row, s: Shipping = shippingSettings(undefined)): z.infer<typeof PublicArtwork>["shipping"] {
  const w = shipWorkOf(r);
  const sh = w.shipping;
  if (!sh?.tier) return null;
  const pinned = sh.cents ?? null;
  const quoted = sh.tier === 4 || !!sh.customQuote || !!sh.crated;
  if (quoted) return { tier: sh.tier, cents: pinned, estimate: false, quote: pinned === null };
  if (sh.tier === 1) return { tier: 1, cents: 0, estimate: false, quote: false };
  if (sh.tier === 2) return { tier: 2, cents: s.tier2Cents, estimate: false, quote: false };
  const box = boxOf(w, s);
  const oversize = !box || isOversize(box);
  return { tier: 3, cents: pinned, estimate: pinned === null && !oversize, quote: pinned === null && oversize };
}

const today = (now: string) => now.slice(0, 10);
const running = (r: { on: boolean; starts: string | null; ends: string | null }, now: string) =>
  r.on && (!r.starts || r.starts <= today(now)) && (!r.ends || today(now) <= r.ends);

/** The studio's shipping as the public site shows it: lines, rates, and the rules only while they run. */
export function publicShippingOf(site: z.infer<typeof SiteProfile>, now: string): z.infer<typeof PublicShipping> {
  const s = shippingOf(site);
  return {
    tier1: { maxSqIn: s.tier1MaxSqIn, maxLongIn: s.tier1MaxLongIn },
    tier2: { maxSqIn: s.tier2MaxSqIn, maxLongIn: s.tier2MaxLongIn, cents: s.tier2Cents },
    pairsFree: running(s.r1, now),
    largeOffer: running(s.r2, now) ? { minCents: s.r2.minCents, bps: s.r2.bps, capCents: s.r2.capCents } : null,
    pickup: s.pickup.on ? { words: s.pickup.words } : null,
    countries: ["US"],
    words: { ...s.words },
  };
}
