// Visitor numbers (card G, D-177). A count per studio, UTC day, kind and piece: nothing about the
// person, no cookie, no IP. Each row stops at DAILY_CAP, so a script hammering the public route
// can't run a number up past it, and only public pieces get a row, so it can't fill the table either.
import type { SiteCountKind } from "@studio/core";
import type { z } from "zod";

export const DAILY_CAP = 2000;

export const utcDay = (at: Date = new Date()) => at.toISOString().slice(0, 10);

/** Add one to a count, unless it has reached the day's cap. */
export function bump(db: D1Database, studioId: string, kind: z.infer<typeof SiteCountKind>, artworkId = "", day = utcDay()) {
  return db.prepare(
    `INSERT INTO site_counts (studio_id, day, kind, artwork_id, n) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(studio_id, day, kind, artwork_id) DO UPDATE SET n = n + 1 WHERE n < ?`,
  ).bind(studioId, day, kind, artworkId, DAILY_CAP).run();
}
