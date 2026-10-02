// Studio-owned record types and their CRUD actions. Every action reads with
// studio_id from the session, so another studio's id is simply "not found" (D-016).
import {
  ArtworkInput, ArtworkPatch, ClientInput, ClientPatch, Id, SaleInput, SalePatch, SettingsPatch, ShowInput, ShowPatch,
  db as schema, newId,
} from "@studio/core";
import { and, eq, isNull } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import type { Permission } from "../auth/permissions";
import type { Db } from "../env";
import { notFound, versionConflict } from "../lib/errors";
import { type ActionCtx, type Snapshot, type Write, defineAction } from "./runner";

/** Fields the server owns; a client can never set them through a create or patch. */
const SYSTEM_FIELDS = ["id", "studioId", "createdAt", "updatedAt", "createdBy", "actorType", "version", "deletedAt"] as const;

export interface EntityDef {
  type: string;
  table: SQLiteTable;
  key: SQLiteColumn;
  studio: SQLiteColumn;
  version: SQLiteColumn;
  deletedAt: SQLiteColumn;
  perm: string; // permission prefix, e.g. "artworks"
  /** Column defaults, so the logged `after` matches the stored row exactly. */
  defaults: Snapshot;
}

const entities = new Map<string, EntityDef>();
const define = (e: EntityDef) => (entities.set(e.type, e), e);
export const getEntity = (type: string) => entities.get(type);

const recordDefaults = { createdBy: null, deletedAt: null, meta: {}, version: 1, actorType: "user" };

export const artworkEntity = define({
  type: "artwork", table: schema.artworks, key: schema.artworks.id, studio: schema.artworks.studioId,
  version: schema.artworks.version, deletedAt: schema.artworks.deletedAt, perm: "artworks",
  defaults: {
    ...recordDefaults, inventoryCode: null, medium: null, year: null, width: null, height: null, depth: null,
    sizeUnit: "in", priceCents: null, currency: "USD", status: "available", description: null, primaryFileId: null,
  },
});

export const clientEntity = define({
  type: "client", table: schema.clients, key: schema.clients.id, studio: schema.clients.studioId,
  version: schema.clients.version, deletedAt: schema.clients.deletedAt, perm: "clients",
  defaults: {
    ...recordDefaults, kind: "collector", email: null, phone: null, address: null, notes: null,
    notifyEmail: true, notifySms: false,
  },
});

export const settingsEntity = define({
  type: "settings", table: schema.studioSettings, key: schema.studioSettings.studioId,
  studio: schema.studioSettings.studioId, version: schema.studioSettings.version,
  deletedAt: schema.studioSettings.deletedAt, perm: "settings", defaults: {},
});

export const fileEntity = define({
  type: "file", table: schema.files, key: schema.files.id, studio: schema.files.studioId,
  version: schema.files.version, deletedAt: schema.files.deletedAt, perm: "files",
  defaults: { ...recordDefaults, thumbKey: null, contentType: null, size: null, kind: "other", status: "pending",
    entityType: null, entityId: null, locked: false },
});

export const showEntity = define({
  type: "show", table: schema.shows, key: schema.shows.id, studio: schema.shows.studioId,
  version: schema.shows.version, deletedAt: schema.shows.deletedAt, perm: "shows",
  defaults: {
    ...recordDefaults, venue: null, city: null, startsOn: null, endsOn: null, booth: null, feeCents: null,
    currency: "USD", status: "planned", notes: null,
  },
});

export const showArtworkEntity = define({
  type: "show_artwork", table: schema.showArtworks, key: schema.showArtworks.id, studio: schema.showArtworks.studioId,
  version: schema.showArtworks.version, deletedAt: schema.showArtworks.deletedAt, perm: "shows",
  defaults: { ...recordDefaults, outcome: "brought", soldPriceCents: null, currency: "USD", clientId: null, soldAt: null },
});

export const saleEntity = define({
  type: "sale", table: schema.sales, key: schema.sales.id, studio: schema.sales.studioId,
  version: schema.sales.version, deletedAt: schema.sales.deletedAt, perm: "sales",
  defaults: {
    ...recordDefaults, showId: null, artworkId: null, title: null, priceCents: null, currency: "USD", quantity: 1,
    soldOn: null, paymentMethod: null, size: null, medium: null, source: "manual", externalId: null, notes: null,
  },
});

/** Read one record in the caller's studio. Missing, other-studio and (unless asked) deleted → null. */
export async function findRecord(db: Db, e: EntityDef, studioId: string, id: string, opts: { withDeleted?: boolean } = {}) {
  const where = [eq(e.key, id), eq(e.studio, studioId)];
  if (!opts.withDeleted) where.push(isNull(e.deletedAt));
  const rows = await db.select().from(e.table).where(and(...where)).limit(1);
  return (rows[0] as Snapshot | undefined) ?? null;
}

export async function getRecord(db: Db, e: EntityDef, studioId: string, id: string, opts: { withDeleted?: boolean } = {}) {
  const row = await findRecord(db, e, studioId, id, opts);
  if (!row) throw notFound(e.type[0]!.toUpperCase() + e.type.slice(1));
  return row;
}

/** Strip server-owned fields from a client-supplied object. */
const clientFields = (o: Snapshot) => Object.fromEntries(Object.entries(o).filter(([k]) => !(SYSTEM_FIELDS as readonly string[]).includes(k)));

/** An UPDATE guarded by the version the caller saw; aborts the batch if it moved on. */
export function updateWrite(ctx: ActionCtx, e: EntityDef, before: Snapshot, changes: Snapshot): Write {
  const version = before.version as number;
  const after: Snapshot = { ...before, ...changes, version: version + 1, updatedAt: ctx.now };
  const set = { ...changes, version: version + 1, updatedAt: ctx.now };
  return {
    query: ctx.db.update(e.table).set(set).where(and(
      eq(e.key, before[keyProp(e)] as string), eq(e.studio, ctx.actor.studioId), eq(e.version, version),
    )),
    expectOne: true,
    log: { entityType: e.type, entityId: before[keyProp(e)] as string, before, after },
  };
}

export function insertWrite(ctx: ActionCtx, e: EntityDef, fields: Snapshot): Write {
  const row: Snapshot = {
    ...e.defaults, ...fields, studioId: ctx.actor.studioId, createdAt: ctx.now, updatedAt: ctx.now,
    createdBy: ctx.actor.userId, actorType: "user", version: 1, deletedAt: null,
  };
  return {
    query: ctx.db.insert(e.table).values(row),
    expectOne: true,
    log: { entityType: e.type, entityId: row[keyProp(e)] as string, before: null, after: row },
  };
}

export const keyProp = (e: EntityDef) => (e.key === e.studio ? "studioId" : "id");

/** The version from If-Match (record routes) or the input (actions endpoint). */
export function checkVersion(current: Snapshot, expected: number): void {
  if (current.version !== expected) throw versionConflict({ version: current.version });
}

const VersionedId = { id: Id, version: z.number().int().min(1) };

/** Checks run before a create or update writes, e.g. that linked records are in the caller's studio. */
type Refs = (ctx: ActionCtx, fields: Snapshot) => Promise<void>;

/** create / update / delete actions for one record type. */
function crudActions(e: EntityDef, input: z.ZodType<Snapshot>, patch: z.ZodType<Snapshot>, refs?: Refs) {
  const one = (_c: ActionCtx, afters: (Snapshot | null)[]) => afters[0] as Snapshot;
  return {
    create: defineAction({
      name: `${e.type}.create`,
      description: `Create a ${e.type}`,
      input,
      permission: `${e.perm}:write` as Permission,
      risk: "auto",
      plan: async (ctx, data) => {
        await refs?.(ctx, data);
        return { writes: [insertWrite(ctx, e, { ...clientFields(data), id: data.id ?? newId() })] };
      },
      respond: one,
    }),
    update: defineAction({
      name: `${e.type}.update`,
      description: `Change fields on a ${e.type}`,
      input: z.object({ ...VersionedId, patch }),
      permission: `${e.perm}:write` as Permission,
      risk: "auto",
      plan: async (ctx, { id, version, patch: p }) => {
        const before = await getRecord(ctx.db, e, ctx.actor.studioId, id);
        checkVersion(before, version);
        await refs?.(ctx, p);
        return { writes: [updateWrite(ctx, e, before, clientFields(p))] };
      },
      respond: one,
    }),
    delete: defineAction({
      name: `${e.type}.delete`,
      description: `Delete a ${e.type} (soft; can be undone)`,
      input: z.object(VersionedId),
      permission: `${e.perm}:delete` as Permission,
      risk: "always_confirm",
      plan: async (ctx, { id, version }) => {
        const before = await getRecord(ctx.db, e, ctx.actor.studioId, id);
        checkVersion(before, version);
        return { writes: [updateWrite(ctx, e, before, { deletedAt: ctx.now })] };
      },
      respond: one,
    }),
  };
}

export const artworkActions = crudActions(artworkEntity, ArtworkInput, ArtworkPatch);
export const clientActions = crudActions(clientEntity, ClientInput, ClientPatch);
export const showActions = crudActions(showEntity, ShowInput, ShowPatch);
// A sale may name a show and an artwork; both must be live records in this studio (D-016: else 404).
export const saleActions = crudActions(saleEntity, SaleInput, SalePatch, async (ctx, f) => {
  if (f.showId) await getRecord(ctx.db, showEntity, ctx.actor.studioId, f.showId as string);
  if (f.artworkId) await getRecord(ctx.db, artworkEntity, ctx.actor.studioId, f.artworkId as string);
});

export const settingsUpdate = defineAction({
  name: "settings.update",
  description: "Change studio settings (currency, terms, deposit, tax, units, tone, signature)",
  input: z.object({ version: z.number().int().min(1), patch: SettingsPatch }),
  permission: "settings:write",
  risk: "confirm",
  plan: async (ctx, { version, patch }) => {
    const before = await getRecord(ctx.db, settingsEntity, ctx.actor.studioId, ctx.actor.studioId);
    checkVersion(before, version);
    return { writes: [updateWrite(ctx, settingsEntity, before, clientFields(patch))] };
  },
  respond: (_c, a) => a[0] as Snapshot,
});
