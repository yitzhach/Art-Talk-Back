// Square, by fetch (no SDK; D-144). The studio's own Square account takes card payments on Square's hosted checkout
// page; studio-api makes a payment link per order and learns of payments only from Square's signed webhook.
// Sandbox on staging (connect.squareupsandbox.com), production on production: SQUARE_ENV says which.
import type { Env } from "../env";
import { HttpError } from "./errors";

const VERSION = "2025-01-23";
const base = (env: Env) => (env.SQUARE_ENV === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com");

/** Square takes cards for this studio only when every credential is set and the studio is the one they belong to. */
export const squareReady = (env: Env, studioSlug: string) =>
  !!env.SQUARE_ACCESS_TOKEN && !!env.SQUARE_LOCATION_ID && !!env.SQUARE_WEBHOOK_SIGNATURE_KEY && !!env.SQUARE_STUDIO_SLUG
  && env.SQUARE_STUDIO_SLUG === studioSlug;

async function square<T>(env: Env, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base(env)}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`, "square-version": VERSION, "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    console.error("Square unreachable", e);
    throw new HttpError("internal", "Card payments can't be reached just now. Please try again in a minute.");
  }
  const data = (await res.json().catch(() => ({}))) as T & { errors?: { code?: string; detail?: string }[] };
  if (!res.ok) {
    console.error("Square refused", method, path, res.status, JSON.stringify(data.errors ?? []).slice(0, 500));
    throw new HttpError("internal", "Card payments can't be reached just now. Please try again in a minute.");
  }
  return data;
}

export interface LinkInput {
  orderId: string;
  code: string;
  title: string;
  amountCents: number;
  shippingCents: number;
  taxBps: number;
  currency: string;
  redirectUrl: string;
  email?: string | null;
}

/** One payment link for one order: the piece at its catalogue price, flat shipping, the studio's fixed tax if any. */
export async function createPaymentLink(env: Env, l: LinkInput): Promise<{ linkId: string; url: string; squareOrderId: string }> {
  const money = (amount: number) => ({ amount, currency: l.currency });
  const body = {
    idempotency_key: l.orderId,
    order: {
      location_id: env.SQUARE_LOCATION_ID,
      reference_id: l.orderId,
      line_items: [{
        name: l.title.slice(0, 500), quantity: "1", base_price_money: money(l.amountCents),
        ...(l.taxBps ? { applied_taxes: [{ tax_uid: "sales-tax" }] } : {}),
      }],
      ...(l.taxBps ? { taxes: [{ uid: "sales-tax", name: "Sales tax", percentage: (l.taxBps / 100).toFixed(2), scope: "LINE_ITEM" }] } : {}),
      metadata: { orderId: l.orderId, code: l.code },
    },
    checkout_options: {
      redirect_url: l.redirectUrl,
      ask_for_shipping_address: true,
      allow_tipping: false,
      ...(l.shippingCents ? { shipping_fee: { name: "Shipping", charge: money(l.shippingCents) } } : {}),
    },
    ...(l.email ? { pre_populated_data: { buyer_email: l.email } } : {}),
    payment_note: `Order ${l.code}`,
  };
  const r = await square<{ payment_link?: { id: string; url: string; order_id: string } }>(env, "POST", "/v2/online-checkout/payment-links", body);
  if (!r.payment_link?.id || !r.payment_link.url || !r.payment_link.order_id) {
    throw new HttpError("internal", "Card payments can't be reached just now. Please try again in a minute.");
  }
  return { linkId: r.payment_link.id, url: r.payment_link.url, squareOrderId: r.payment_link.order_id };
}

/** An unused link stops working (the order expired or was cancelled). Never throws: the order is already closed. */
export async function deletePaymentLink(env: Env, linkId: string): Promise<void> {
  try {
    await square(env, "DELETE", `/v2/online-checkout/payment-links/${encodeURIComponent(linkId)}`);
  } catch {
    /* logged by square() */
  }
}

/**
 * Square signs each webhook: base64(HMAC-SHA256(signature key, notification URL + raw body)) in
 * `x-square-hmacsha256-signature`. The URL is the one registered in Square (SQUARE_WEBHOOK_URL), else this request's.
 */
export async function squareSignatureOk(key: string, url: string, rawBody: string, signature: string | undefined): Promise<boolean> {
  if (!signature || !key) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(url + rawBody)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
