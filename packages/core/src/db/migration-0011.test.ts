// Migration 0011 (D-118): the site photos the stage 1 import brought in become `site_photo`, from the
// record the import left on each (meta.importedFrom.page = 'site-photo'); every other work stays a work.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const dir = new URL("../../../../workers/studio-api/migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = (pick: (f: string) => boolean) => files.filter(pick).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");

describe("migration 0011", () => {
  it("marks the imported site photos, bumps their version and the studio's catalogue version", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(sql((f) => f < "0011"));
    const now = "2026-11-11T00:00:00.000Z";
    for (const s of ["S1", "S2"]) {
      db.prepare("INSERT INTO studios (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(s, s, s.toLowerCase(), now, now);
    }
    const add = (id: string, studio: string, meta: unknown) =>
      db.prepare("INSERT INTO artworks (id, studio_id, title, created_at, updated_at, meta) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, studio, id, now, now, JSON.stringify(meta));
    add("photo", "S1", { importedFrom: { key: "hero-macro-2", page: "site-photo", slot: "hero-macro-2" } });
    add("work", "S1", { importedFrom: { key: "abstract-1", page: "collection-abstract", slot: "abstract-1" } });
    add("plain", "S2", {});
    db.exec(sql((f) => f.startsWith("0011")));
    const rows = db.prepare("SELECT id, kind, version, updated_at FROM artworks ORDER BY id").all() as any[];
    expect(rows.map((r) => [r.id, r.kind, r.version])).toEqual([["photo", "site_photo", 2], ["plain", "work", 1], ["work", "work", 1]]);
    expect(rows.find((r) => r.id === "photo").updated_at > now).toBe(true);
    const v = db.prepare("SELECT id, catalogue_version FROM studios ORDER BY id").all() as any[];
    expect(v.map((r) => [r.id, r.catalogue_version])).toEqual([["S1", 1], ["S2", 0]]);
    expect(() => db.prepare("UPDATE artworks SET kind = 'banner' WHERE id = 'work'").run()).toThrow();
  });
});
