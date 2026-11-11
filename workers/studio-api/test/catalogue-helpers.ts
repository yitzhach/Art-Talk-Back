// Works with pictures for the catalogue's tests (Site 3.0 stage 1), made only
// through the owner's routes, as the studio app makes them.
import { BASE, call, type Studio } from "./helpers";

/** The smallest bytes studio-api accepts as WebP (it checks the RIFF/WEBP header, D-106). */
export function webpBytes(n = 32): Uint8Array {
  const b = new Uint8Array(Math.max(n, 16));
  b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  b.set([0x56, 0x50, 0x38, 0x4c], 12); // VP8L
  return b;
}

const put = (url: string, body: Uint8Array) =>
  call(url.replace(BASE, ""), { method: "PUT", body: body as unknown as BodyInit, headers: { "Content-Length": String(body.length) } });

/** Uploads a picture with its three WebP sizes and attaches it to the work. Returns the file record. */
export async function addPicture(s: Studio, artworkId: string, opts: { widths?: number[]; name?: string } = {}) {
  const widths = opts.widths ?? [480, 960, 1600];
  const original = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]);
  const sizes = widths.map((width, i) => ({ width, bytes: webpBytes(20 + i) }));
  const up = await call("/v1/files/upload-url", {
    method: "POST", cookie: s.cookie,
    json: { name: opts.name ?? "work.jpg", contentType: "image/jpeg", size: original.length, kind: "photo",
      sizes: sizes.map((x) => ({ width: x.width, size: x.bytes.length })), pixels: { width: 3000, height: 4000 } },
  });
  if (up.status !== 200) throw new Error(`upload-url ${up.status} ${up.raw}`);
  if ((await put(up.data.uploadUrl, original)).status !== 204) throw new Error("original PUT failed");
  for (const x of sizes) {
    const link = up.data.sizeUrls.find((l: any) => l.width === x.width);
    const r = await put(link.uploadUrl, x.bytes);
    if (r.status !== 204) throw new Error(`size PUT ${r.status} ${r.raw}`);
  }
  const att = await call(`/v1/files/${up.data.file.id}/attach`, { method: "POST", cookie: s.cookie, json: { entityType: "artwork", entityId: artworkId } });
  if (att.status !== 200) throw new Error(`attach ${att.status} ${att.raw}`);
  return att.data;
}

/** A work with a cover; `publish` makes it public (D-104). Returns the work as it is after the last step. */
export async function makeWork(s: Studio, fields: Record<string, unknown> = {}, opts: { publish?: boolean } = {}) {
  const made = await call("/v1/artworks", { method: "POST", cookie: s.cookie, json: { title: "Untitled", ...fields } });
  if (made.status !== 201) throw new Error(`create ${made.status} ${made.raw}`);
  const file = await addPicture(s, made.data.id);
  let work = (await call(`/v1/artworks/${made.data.id}`, { method: "PATCH", cookie: s.cookie, headers: { "If-Match": String(made.data.version) }, json: { primaryFileId: file.id } })).data;
  if (opts.publish) {
    const pub = await call(`/v1/artworks/${work.id}/publish`, { method: "POST", cookie: s.cookie, headers: { "If-Match": String(work.version) } });
    if (pub.status !== 200) throw new Error(`publish ${pub.status} ${pub.raw}`);
    work = pub.data;
  }
  return { work, file };
}

/** The studio's slug, for the public routes. */
export async function studioSlug(studioId: string): Promise<string> {
  const { env } = await import("cloudflare:test");
  return (await env.DB.prepare("SELECT slug FROM studios WHERE id = ?").bind(studioId).first<{ slug: string }>("slug"))!;
}
