// Local-first studio data for any app (spec → Online and offline).
//
// Writes land in IndexedDB and on screen at once, and go into an outbox. sync()
// pushes the outbox (in order, retry-safe by opId), then pulls everything that
// changed since the last cursor. Triggers: start(), focus, reconnect, after
// each write, and every 60 s while running.
// From ids only, so a browser bundle of the SDK doesn't pull in zod and drizzle.
import { isId, newId } from "@studio/core/ids";
import { ApiClient, type ClientOptions, NetworkError } from "./client";
import { type LocalRecord, LocalStore, type OutboxOp, type RecordType } from "./store";

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A patch over a record: fields replace, but `meta` merges per key (D-036). */
export function applyPatch(base: LocalRecord, patch: LocalRecord): LocalRecord {
  const next = { ...base, ...patch };
  if (isObject(patch.meta) && isObject(base.meta)) next.meta = { ...base.meta, ...patch.meta };
  return next;
}

const verb = (op: OutboxOp) => op.action.slice(op.entityType.length + 1);
const same = (o: OutboxOp, type: RecordType, id: string) => o.entityType === type && o.entityId === id;

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
  /** Op ids sent and not yet answered. */
  private inFlight = new Set<string>();
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
  //
  // An op that is being pushed right now is never changed: an edit made
  // meanwhile is queued as its own op, held back until the first is answered,
  // and then rebased onto the version the server gave it (pushAll). Folding
  // into an op in flight would drop the edit when that op is dequeued.

  /**
   * Create a record locally; it keeps its id on the server. `fields.id` may be
   * a ULID the app chose (e.g. one derived from an imported record); else a new one.
   */
  async create(type: RecordType, fields: LocalRecord): Promise<LocalRecord> {
    const { id: wanted, ...input } = fields;
    const id = isId(wanted) ? wanted : newId();
    const record: LocalRecord = { ...input, id, version: 0, deletedAt: null };
    await this.store.edit(type, id, (current) => {
      if (current) throw new Error(`${type} ${id} already exists on this device`);
      return { record, enqueue: [this.op(type, id, `${type}.create`, null, input)] };
    });
    this.afterWrite([type]);
    return record;
  }

  /** Change fields locally; the server applies them, or merges them if another device got there first. */
  async update(type: RecordType, id: string, patch: LocalRecord): Promise<LocalRecord> {
    const next = await this.store.edit(type, id, (current, outbox) => {
      if (!current) throw new Error(`No local ${type} ${id}`);
      const record = applyPatch(current, patch);
      // Fold into a change that hasn't been sent yet, so one edit session = one op.
      const last = outbox.filter((o) => same(o, type, id)).at(-1);
      if (last && !this.inFlight.has(last.opId) && verb(last) === "create") {
        return { record, enqueue: [{ ...last, input: applyPatch(last.input, patch) }] };
      }
      if (last && !this.inFlight.has(last.opId) && verb(last) === "update") {
        return { record, enqueue: [{ ...last, input: { patch: applyPatch(last.input.patch as LocalRecord, patch) } }] };
      }
      return { record, enqueue: [this.op(type, id, `${type}.update`, current.version ?? null, { patch })] };
    });
    this.afterWrite([type]);
    return next!;
  }

  async remove(type: RecordType, id: string): Promise<void> {
    let changed = false;
    await this.store.edit(type, id, (current, outbox) => {
      if (!current) return {};
      changed = true;
      const pending = outbox.filter((o) => same(o, type, id));
      if (pending[0] && verb(pending[0]) === "create" && !this.inFlight.has(pending[0].opId)) {
        // Never reached the server: forget it entirely.
        return { record: null, dequeue: pending.map((o) => o.opId) };
      }
      return { record: null, enqueue: [this.op(type, id, `${type}.delete`, current.version ?? null, {})] };
    });
    if (changed) this.afterWrite([type]);
  }

  /** Mark sold locally and queue the server action (which also updates the show). */
  async markSold(artworkId: string, sale: { priceCents: number; showId?: string; clientId?: string; currency?: string }) {
    await this.store.edit("artwork", artworkId, (art) => {
      if (!art) throw new Error(`No local artwork ${artworkId}`);
      const record = {
        ...art, status: "sold",
        meta: { ...(art.meta as object), sale: { ...sale, clientId: sale.clientId ?? null, showId: sale.showId ?? null } },
      };
      return { record, enqueue: [this.op("artwork", artworkId, "artwork.mark_sold", null, { artworkId, ...sale })] };
    });
    this.afterWrite(["artwork"]);
  }

  private op(type: RecordType, entityId: string, action: string, baseVersion: number | null, input: Record<string, unknown>): OutboxOp {
    return { opId: newId(), entityType: type, action, entityId, baseVersion, input };
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
      const ops = this.nextBatch(await this.store.outbox());
      if (!ops.length) return;
      for (const op of ops) this.inFlight.add(op.opId);
      let results;
      try {
        ({ results } = await this.api.push(ops.map(({ entityType: _t, ...op }) => op)));
      } finally {
        for (const op of ops) this.inFlight.delete(op.opId);
      }
      const touched = new Set<RecordType>();
      for (const [i, r] of results.entries()) {
        const op = ops[i]!;
        touched.add(op.entityType);
        const record = r.record as LocalRecord | undefined;
        const ok = r.status === "applied" || r.status === "merged" || r.status === "duplicate";
        await this.store.edit(op.entityType, op.entityId, (local, outbox) => {
          const later = outbox.filter((o) => o.opId !== op.opId && same(o, op.entityType, op.entityId));
          const plan: { record?: LocalRecord | null; enqueue: OutboxOp[]; dequeue: string[] } = { enqueue: [], dequeue: [op.opId] };
          if (r.status === "rejected" && verb(op) === "create") {
            // Nothing exists to edit: drop the record and anything queued after it.
            plan.record = null;
            plan.dequeue.push(...later.map((o) => o.opId));
            return plan;
          }
          // Edits made while this op was out were queued against the old version;
          // they build on this answer, so rebase them (only when the server took it).
          const answered = (op.action === "artwork.mark_sold" ? (record?.artwork as LocalRecord | undefined) : record)?.version;
          const rebased = later.map((o) => (ok && typeof answered === "number" && o.baseVersion !== null ? { ...o, baseVersion: answered } : o));
          plan.enqueue = rebased;
          if (record?.id && op.action !== "artwork.mark_sold" && local !== null) {
            // The server's copy, with this device's unsent edits still on top.
            plan.record = rebased.reduce((acc, o) => (verb(o) === "update" ? applyPatch(acc, o.input.patch as LocalRecord) : acc), { ...record } as LocalRecord);
            if (rebased.some((o) => verb(o) === "delete")) plan.record = null;
          }
          return plan;
        });
        if (r.status === "conflict") {
          this.emit("conflict", { entityType: op.entityType, entityId: op.entityId, conflicts: r.conflicts ?? [], record: record ?? null });
        } else if (r.status === "rejected") {
          this.emit("rejected", { entityType: op.entityType, entityId: op.entityId, action: op.action, message: r.error?.message ?? "Rejected" });
        }
      }
      this.emit("change", { types: [...touched] });
    }
  }

  /**
   * The outbox in order, up to PUSH_BATCH, stopping before an edit or delete of
   * a record already changed earlier in the batch: that one needs the version
   * the earlier op gets back, so it goes in the next round.
   */
  private nextBatch(outbox: OutboxOp[]) {
    const batch: OutboxOp[] = [];
    const seen = new Set<string>();
    for (const o of outbox) {
      const key = `${o.entityType}:${o.entityId}`;
      if (batch.length >= PUSH_BATCH || (o.baseVersion !== null && seen.has(key))) break;
      batch.push(o);
      seen.add(key);
    }
    return batch;
  }

  private async pullAll() {
    let cursor = (await this.store.getMeta<string>("cursor")) ?? "0";
    const touched = new Set<RecordType>();
    for (;;) {
      const page = await this.api.pull(cursor);
      // A record with unsent local edits keeps the local copy until those edits are
      // pushed; checked per record, in the same transaction as the write.
      for (const c of page.changes) {
        const type = c.entityType as RecordType;
        const data = c.record.deletedAt ? null : (c.record as LocalRecord);
        if (await this.store.putFromServer(type, c.entityId, data)) touched.add(type);
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
    const set = (this.listeners[event] ??= new Set() as never) as Set<Listener<K>>;
    set.add(fn);
    return () => set.delete(fn);
  }

  private emit<K extends keyof StudioEvents>(event: K, payload: StudioEvents[K]) {
    for (const fn of (this.listeners[event] ?? []) as Set<Listener<K>>) fn(payload);
  }
}
