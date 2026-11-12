// Sample works for a new studio (Site 3.0 stage 7, D-174): six made-up pieces with generated pictures, so a new
// artist's site is never empty on day one. They are ordinary works of that studio; the artist edits or deletes them.
import { newId } from "@studio/core";
import { sizeKey } from "../actions/files";
import type { Env } from "../env";
import { SAMPLE_PICTURES } from "./sample-pictures";

const WORKS = [
  { title: "Harbour Light", medium: "Acrylic on canvas", w: 24, h: 30, price: 120000, status: "available" },
  { title: "Field Notes", medium: "Oil on panel", w: 16, h: 20, price: 68000, status: "available" },
  { title: "Late Bloom", medium: "Acrylic on canvas", w: 30, h: 36, price: 185000, status: "available" },
  { title: "Tidewater", medium: "Mixed media on paper", w: 12, h: 15, price: 42000, status: "sold" },
  { title: "Quiet Orchard", medium: "Oil on canvas", w: 36, h: 48, price: null, status: "not_for_sale" },
  { title: "Signal", medium: "Acrylic on panel", w: 20, h: 24, price: 95000, status: "available" },
] as const;

const slugOf = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

export interface SampleRow { table: "artworks" | "files"; sql: string; params: unknown[]; id: string; after: Record<string, unknown> }

/**
 * Puts the sample pictures in the studio's own place in R2 (as an upload would), then returns the rows that make the
 * works, for the caller's one batch. Pictures that land but whose rows never do are harmless: nothing points at them.
 */
export async function sampleWorks(env: Env, studioId: string, actorId: string | null, now: string): Promise<SampleRow[]> {
  const year = Number(now.slice(0, 4));
  const rows: SampleRow[] = [];
  for (const [i, w] of WORKS.entries()) {
    const pic = SAMPLE_PICTURES[i]!;
    const workId = newId();
    const fileId = newId();
    const r2Key = `studios/${studioId}/${fileId}-sample-${i + 1}.webp`;
    const small = bytes(pic.webp[480]);
    const large = bytes(pic.webp[960]);
    await Promise.all([
      env.FILES.put(r2Key, large, { httpMetadata: { contentType: "image/webp" } }),
      env.FILES.put(sizeKey(r2Key, 480), small, { httpMetadata: { contentType: "image/webp" } }),
      env.FILES.put(sizeKey(r2Key, 960), large, { httpMetadata: { contentType: "image/webp" } }),
    ]);
    const meta = { sizes: [{ width: 480, size: small.length }, { width: 960, size: large.length }], pixels: { width: pic.width, height: pic.height }, sample: true };
    const fileAfter = { id: fileId, name: `sample-${i + 1}.webp`, kind: "photo", entityType: "artwork", entityId: workId };
    rows.push({
      table: "files", id: fileId, after: fileAfter,
      sql: `INSERT INTO files (id, studio_id, r2_key, name, content_type, size, kind, status, entity_type, entity_id, position, alt_text,
              created_at, updated_at, created_by, actor_type, meta)
            VALUES (?, ?, ?, ?, 'image/webp', ?, 'photo', 'ready', 'artwork', ?, 0, ?, ?, ?, ?, 'system', ?)`,
      params: [fileId, studioId, r2Key, fileAfter.name, large.length, workId, `${w.title}, a sample abstract of overlapping shapes`, now, now, actorId, JSON.stringify(meta)],
    });
    const palette = pic.palette.map((hex) => ({ hex, share: 2500 }));
    const workAfter = { id: workId, title: w.title, status: w.status, public: true, sample: true };
    rows.push({
      table: "artworks", id: workId, after: workAfter,
      sql: `INSERT INTO artworks (id, studio_id, title, medium, year, width, height, size_unit, price_cents, currency, status, description,
              primary_file_id, public, published_at, slug, collection, tags, palette, kind, created_at, updated_at, created_by, actor_type, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'in', ?, 'USD', ?, ?, ?, 1, ?, ?, 'Samples', ?, ?, 'work', ?, ?, ?, 'system', ?)`,
      params: [
        workId, studioId, w.title, w.medium, year, w.w, w.h, w.price, w.status,
        "A sample work, here so the site isn't empty on day one. Replace it with your own, or delete it in Studio.",
        fileId, now, slugOf(w.title), JSON.stringify(["sample", "abstract"]), JSON.stringify(palette), now, now, actorId,
        JSON.stringify({ sample: true }),
      ],
    });
  }
  return rows;
}
