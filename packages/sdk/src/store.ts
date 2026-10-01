// The device's copy of the studio, in IndexedDB (not localStorage: bigger,
// and it doesn't block the page). Three stores: records, outbox, meta.
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { z } from "zod";
import type { SyncOp } from "@studio/core";

export type RecordType = "artwork" | "client" | "show" | "show_artwork" | "settings" | "file";
export type LocalRecord = Record<string, unknown> & { id?: string; studioId?: string; version?: number; deletedAt?: string | null };
export type OutboxOp = z.infer<typeof SyncOp> & { entityType: RecordType };

interface Schema extends DBSchema {
  records: { key: [string, string]; value: { type: string; id: string; data: LocalRecord }; indexes: { byType: string } };
  outbox: { key: string; value: OutboxOp };
  meta: { key: string; value: unknown };
}

export class LocalStore {
  private constructor(private readonly db: IDBPDatabase<Schema>) {}

  static async open(name: string): Promise<LocalStore> {
    const db = await openDB<Schema>(name, 1, {
      upgrade(db) {
        db.createObjectStore("records", { keyPath: ["type", "id"] }).createIndex("byType", "type");
        db.createObjectStore("outbox", { keyPath: "opId" });
        db.createObjectStore("meta");
      },
    });
    return new LocalStore(db);
  }

  async get(type: RecordType, id: string) {
    return (await this.db.get("records", [type, id]))?.data ?? null;
  }
  async list(type: RecordType) {
    return (await this.db.getAllFromIndex("records", "byType", type)).map((r) => r.data).filter((r) => !r.deletedAt);
  }
  async put(type: RecordType, id: string, data: LocalRecord) {
    await this.db.put("records", { type, id, data });
  }
  async remove(type: RecordType, id: string) {
    await this.db.delete("records", [type, id]);
  }

  /** Oldest first: op ids are ULIDs, so key order is creation order. */
  outbox() {
    return this.db.getAll("outbox");
  }
  async enqueue(op: OutboxOp) {
    await this.db.put("outbox", op);
  }
  async dequeue(opId: string) {
    await this.db.delete("outbox", opId);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.get("meta", key)) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    await this.db.put("meta", value, key);
  }

  close() {
    this.db.close();
  }
}
