// D-012: the hand-written migration and the Drizzle schema must describe the
// same database. Loads both into SQLite and compares tables, columns and indexes.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

const migration = readFileSync(
  new URL("../../../../workers/studio-api/migrations/0001_foundation.sql", import.meta.url),
  "utf8",
);

function shape(db: DatabaseSync) {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  return Object.fromEntries(
    tables.map((t) => [
      t,
      {
        columns: db.prepare(`PRAGMA table_info(${t})`).all().map((c: any) => ({
          // A primary key is never null in practice; Drizzle spells NOT NULL out, SQL here doesn't.
          name: c.name, type: String(c.type).toUpperCase(), notnull: c.pk ? 1 : c.notnull, pk: c.pk,
          // SQLite stores DEFAULT true/false as 1/0; Drizzle writes the keywords.
          dflt: c.dflt_value == null ? null
            : String(c.dflt_value).replace(/^\((.*)\)$/, "$1").replace(/^true$/, "1").replace(/^false$/, "0"),
        })),
        // Compare by what an index does, not its name: an inline UNIQUE in the SQL
        // and Drizzle's .unique() get different auto-generated names.
        indexes: (db.prepare(`PRAGMA index_list(${t})`).all() as any[])
          .filter((i) => i.origin !== "pk")
          .map((i) => {
            const cols = (db.prepare(`PRAGMA index_xinfo("${i.name}")`).all() as any[])
              .filter((c) => c.key)
              .map((c) => `${c.name ?? "<expr>"}${c.coll !== "BINARY" ? ` ${c.coll}` : ""}`)
              .join(",");
            // Drizzle turns .unique() into a CREATE UNIQUE INDEX named <table>_<col>_unique.
            const named = i.origin === "c" && !String(i.name).endsWith("_unique");
            return `${named ? i.name : "(constraint)"} ${i.unique ? "UNIQUE " : ""}${i.partial ? "PARTIAL " : ""}(${cols})`;
          })
          .sort(),
        foreignKeys: (db.prepare(`PRAGMA foreign_key_list(${t})`).all() as any[])
          .map((f) => `${f.from}->${f.table}.${f.to}`).sort(),
      },
    ]),
  );
}

describe("migration 0001 vs Drizzle schema", () => {
  it("define the same tables, columns, indexes and foreign keys", async () => {
    const fromMigration = new DatabaseSync(":memory:");
    fromMigration.exec(migration);

    const empty = await generateSQLiteDrizzleJson({});
    const target = await generateSQLiteDrizzleJson(schema);
    const statements = await generateSQLiteMigration(empty, target);
    const fromDrizzle = new DatabaseSync(":memory:");
    fromDrizzle.exec(statements.join(";\n"));

    expect(shape(fromDrizzle)).toEqual(shape(fromMigration));
  });
});
