// Local-first studio data for any app (spec → Online and offline).
//
// Writes land in IndexedDB and on screen at once, and go into an outbox. sync()
// pushes the outbox (in order, retry-safe by opId), then pulls everything that
// changed since the last cursor. Triggers: start(), focus, reconnect, after
// each write, and every 60 s while running.
import { newId } from "@studio/core";
import { ApiClient, type ClientOptions, NetworkError } from "./client";
import { type LocalRecord, LocalStore, type OutboxOp, type RecordType } from "./store";

export interface Conflict {
  field: string;
  serverValue: unknown;
  deviceValue: unknown;
}

export interface StudioEvents {
  /** A "review change" card: the server kept its values for these fields. */
  conflict: { entityType: RecordType; entityId: string; conflicts: Conflict[]; record: LocalRecord | null };
  /** The server refused a queued change outright (e.g. the record was deleted elsewhere). */
  rejected: { entityType: RecordType; entityId: string; action: string; message: string };
  /** Local data changed (a write here, or a pull); re-render. */
  change: { types: RecordType[] };
  /** Online/offline as last seen by a sync attempt. */
  status: { online: boolean; pending: number };
}

type Listener<K extends keyof StudioEvents> = (e: StudioEvents[K]) => void;

export interface StudioOptions extends ClientOptions {
  /** IndexedDB database name; one per signed-in studio on a device. */
  dbName?: string;
  /** Background sync interval while started. */
  intervalMs?: number;
}

const PUSH_BATCH = 200;

export class Studio {
  readonly api: ApiClient;
  private store!: LocalStore;
  private listeners: { [K in keyof StudioEvents]?: Set<Listener<K>> } = {};
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private detach: (() => void) | null = null;
  online = true;

  private constructor(opts: StudioOptions) {
    this.api = new ApiClient(opts);
  }

  static async open(opts: StudioOptions): Promise<Studio> {
    const s = new Studio(opts);
    s.store = await LocalStore.open(opts.dbName ?? "studio");
    return s;
  }

  // ---------------------------------------------------------------- reads

  get(type: RecordType, id: string) {
    return this.store.get(type, id);
  }
  list(type: RecordType) {
    return this.store.list(type);
  }
  async pendingCount() {
    return (await this.store.outbox()).length;
  }

  // --------------------------------------------------------------- writes

  /** Create a record locally with a device-made id; it keeps that id on the server. */
  async create(type: RecordType, fields: LocalRecord): Promise<LocalRecord> {
    const id = newId();
    const record: LocalRecord = { ...fields, id, version: 0, deletedAt: null };
    await this.store.put(type, id, record);
    await this.queue(type, id, `${type}.create`, null, fields);
    return record;
  }

  /** Change fields locally; the server applies them, or merges them if another device got there first. */
  async update(type: RecordType, id: string, patch: LocalRecord): Promise<LocalRecord> {
    const current = await this.store.get(type, id);
    if (!current) throw new Error(`No local ${type} ${id}`);
    const next = { ...current, ...patch };
    await this.store.put(type, id, next);

    // Fold into a change that hasn't been sent yet, so one edit session = one op.
    const pending = (await this.store.outbox()).filter((o) => o.entityType === type && o.entityId === id);
    const last = pending.at(-1);
    if (last?.action === `${type}.create`) {
      await this.store.enqueue({ ...last, input: { ...last.input, ...patch } });
    } else if (last?.action === `${type}.update`) {
      await this.store.enqueue({ ...last, input: { patch: { ...(last.input.patch as LocalRecord), ...patch } } });
    } else {
      await this.queue(type, id, `${type}.update`, current.version ?? null, { patch });
    }
    this.afterWrite([type]);
    return next;
  }

  async remove(type: RecordType, id: string): Promise<void> {
    const current = await this.store.get(type, id);
    if (!current) return;
    const pending = (await this.store.outbox()).filter((o) => o.entityType === type && o.entityId === id);
    if (pending[0]?.action === `${type}.create`) {
      // Never reached the server: forget it entirely.
      for (const o of pending) await this.store.dequeue(o.opId);
      await this.store.remove(type, id);
      this.afterWrite([type]);
      return;
    }
    await this.store.remove(type, id);
    await this.queue(type, id, `${type}.delete`, current.version ?? null, {});
  }

  /** Mark sold locally and queue the server action (which also updates the show). */
  async markSold(artworkId: string, sale: { priceCents: number; showId?: string; clientId?: string; currency?: string }) {
    const art = await this.store.get("artwork", artworkId);
    if (!art) throw new Error(`No local artwork ${artworkId}`);
    await this.store.put("artwork", artworkId, {
      ...art, status: "sold",
      meta: { ...(art.meta as object), sale: { ...sale, clientId: sale.clientId ?? null, showId: sale.showId ?? null } },
    });
    await this.queue("artwork", artworkId, "artwork.mark_sold", null, { artworkId, ...sale });
  }

  private async queue(type: RecordType, entityId: string, action: string, baseVersion: number | null, input: Record<string, unknown>) {
    await this.store.enqueue({ opId: newId(), entityType: type, action, entityId, baseVersion, input });
    this.afterWrite([type]);
  }

  private afterWrite(types: RecordType[]) {
    this.emit("change", { types });
    if (this.timer) void this.sync();
  }

  // ----------------------------------------------------------------- sync

  /** Push the outbox, then pull. Safe to call often: overlapping calls share one run. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.runOnce();
      } while (this.again && this.online);
    })().finally(() => { this.running = null; });
    return this.running;
  }

  private async runOnce() {
    try {
      await this.pushAll();
      await this.pullAll();
      this.online = true;
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err;
      this.online = false; // keep the outbox; try again on the next trigger
    }
    this.emit("status", { online: this.online, pending: await this.pendingCount() });
  }

  private async pushAll() {
    for (;;) {
      const ops = (await this.store.outbox()).slice(0, PUSH_BATCH);
      if (!ops.length) return;
      const { results } = await this.api.push(ops.map(({ entityType: _t, ...op }) => op));
      const touched = new Set<RecordType>();
      for (const [i, r] of results.entries()) {
        const op = ops[i]!;
        await this.store.dequeue(op.opId);
        touched.add(op.entityType);
        const record = r.record as LocalRecord | undefined;
        if (record?.id && op.action !== "artwork.mark_sold") await this.store.put(op.entityType, record.id, record);
        if (r.status === "conflict") {
          this.emit("conflict", { entityType: op.entityType, entityId: op.entityId, conflicts: r.conflicts ?? [], record: record ?? null });
        } else if (r.status === "rejected") {
          if (op.action.endsWith(".create")) await this.store.remove(op.entityType, op.entityId);
          this.emit("rejected", { entityType: op.entityType, entityId: op.entityId, action: op.action, message: r.error?.message ?? "Rejected" });
        }
      }
      this.emit("change", { types: [...touched] });
    }
  }

  private async pullAll() {
    let cursor = (await this.store.getMeta<string>("cursor")) ?? "0";
    const touched = new Set<RecordType>();
    for (;;) {
      const page = await this.api.pull(cursor);
      // A record with unsent local edits keeps the local copy until those edits are pushed.
      const pending = new Set((await this.store.outbox()).map((o) => `${o.entityType}:${o.entityId}`));
      for (const c of page.changes) {
        const type = c.entityType as RecordType;
        if (pending.has(`${type}:${c.entityId}`)) continue;
        if (c.record.deletedAt) await this.store.remove(type, c.entityId);
        else await this.store.put(type, c.entityId, c.record as LocalRecord);
        touched.add(type);
      }
      cursor = page.cursor;
      await this.store.setMeta("cursor", cursor);
      if (!page.hasMore) break;
    }
    if (touched.size) this.emit("change", { types: [...touched] });
  }

  // ------------------------------------------------------------- triggers

  /** Sync now, then on focus, reconnect, after each write, and every intervalMs. */
  start(intervalMs = 60_000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sync(), intervalMs);
    const g = globalThis as { addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void; document?: { visibilityState?: string } };
    const kick = () => {
      if (g.document?.visibilityState !== "hidden") void this.sync();
    };
    for (const t of ["online", "focus", "visibilitychange"]) g.addEventListener?.(t, kick);
    this.detach = () => { for (const t of ["online", "focus", "visibilitychange"]) g.removeEventListener?.(t, kick); };
    void this.sync();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.detach?.();
    this.detach = null;
  }

  close() {
    this.stop();
    this.store.close();
  }

  // --------------------------------------------------------------- events

  on<K extends keyof StudioEvents>(event: K, fn: Listener<K>): () => void {
    const set = (this.listeners[event] ??= new Set()) as Set<Listener<K>>;
    set.add(fn);
    return () => set.delete(fn);
  }

  private emit<K extends keyof StudioEvents>(event: K, payload: StudioEvents[K]) {
    for (const fn of (this.listeners[event] ?? []) as Set<Listener<K>>) fn(payload);
  }
}
