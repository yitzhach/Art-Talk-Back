// Drizzle schema — mirrors workers/studio-api/migrations/*.sql.
// db-drift.test.ts fails if the two disagree (D-012). Property names are
// camelCase (the API shape); column names are snake_case.
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const actorTypes = ["user", "assistant", "system", "api"] as const;

/** created_at … meta: the columns every studio-owned record carries. */
const recordColumns = (defaultActor: (typeof actorTypes)[number] = "user") => ({
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by"),
  actorType: text("actor_type", { enum: actorTypes }).notNull().default(defaultActor),
  version: integer("version").notNull().default(1),
  deletedAt: text("deleted_at"),
  meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
});

const actorCheck = (name: string) => check(name, sql`actor_type IN ('user','assistant','system','api')`);
const metaCheck = (name: string) => check(name, sql`json_valid(meta)`);

export const studios = sqliteTable(
  "studios",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    ...recordColumns("system"),
  },
  () => [actorCheck("studios_actor"), metaCheck("studios_meta")],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name"),
    phone: text("phone"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastSeenAt: text("last_seen_at"),
    version: integer("version").notNull().default(1),
    deletedAt: text("deleted_at"),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  },
  () => [metaCheck("users_meta")],
);

export const clients = sqliteTable(
  "clients",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["collector", "gallery", "business", "other"] }).notNull().default("collector"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    notes: text("notes"),
    notifyEmail: integer("notify_email", { mode: "boolean" }).notNull().default(true),
    notifySms: integer("notify_sms", { mode: "boolean" }).notNull().default(false),
    ...recordColumns(),
  },
  (t) => [
    index("clients_studio_updated").on(t.studioId, t.updatedAt),
    index("clients_studio_name").on(t.studioId, sql`name COLLATE NOCASE`),
    index("clients_studio_email").on(t.studioId, t.email),
    actorCheck("clients_actor"),
    metaCheck("clients_meta"),
  ],
);

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["owner", "staff", "client"] }).notNull(),
    clientId: text("client_id").references((): AnySQLiteColumn => clients.id),
    ...recordColumns(),
  },
  (t) => [
    uniqueIndex("memberships_studio_user").on(t.studioId, t.userId).where(sql`deleted_at IS NULL`),
    index("memberships_user").on(t.userId),
    actorCheck("memberships_actor"),
    metaCheck("memberships_meta"),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: text("user_id").notNull().references(() => users.id),
    studioId: text("studio_id").references(() => studios.id),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at"),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("sessions_user").on(t.userId), index("sessions_expires").on(t.expiresAt)],
);

export const loginCodes = sqliteTable("login_codes", {
  email: text("email").primaryKey(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const studioSettings = sqliteTable(
  "studio_settings",
  {
    studioId: text("studio_id").primaryKey().references(() => studios.id),
    currency: text("currency").notNull().default("USD"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(14),
    depositBps: integer("deposit_bps").notNull().default(5000),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    sizeUnit: text("size_unit", { enum: ["in", "cm"] }).notNull().default("in"),
    timezone: text("timezone").notNull().default("America/New_York"),
    emailTone: text("email_tone"),
    signature: text("signature"),
    ...recordColumns(),
  },
  () => [actorCheck("studio_settings_actor"), metaCheck("studio_settings_meta")],
);

export const artworks = sqliteTable(
  "artworks",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    title: text("title").notNull(),
    inventoryCode: text("inventory_code"),
    medium: text("medium"),
    year: integer("year"),
    width: real("width"),
    height: real("height"),
    depth: real("depth"),
    sizeUnit: text("size_unit", { enum: ["in", "cm"] }).notNull().default("in"),
    priceCents: integer("price_cents"),
    currency: text("currency").notNull().default("USD"),
    status: text("status", { enum: ["available", "reserved", "sold", "not_for_sale", "archived"] })
      .notNull()
      .default("available"),
    description: text("description"),
    primaryFileId: text("primary_file_id"),
    ...recordColumns(),
  },
  (t) => [
    index("artworks_studio_updated").on(t.studioId, t.updatedAt),
    index("artworks_studio_status").on(t.studioId, t.status),
    index("artworks_studio_title").on(t.studioId, sql`title COLLATE NOCASE`),
    uniqueIndex("artworks_studio_code")
      .on(t.studioId, t.inventoryCode)
      .where(sql`inventory_code IS NOT NULL AND deleted_at IS NULL`),
    actorCheck("artworks_actor"),
    metaCheck("artworks_meta"),
  ],
);

export const shows = sqliteTable(
  "shows",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    name: text("name").notNull(),
    venue: text("venue"),
    city: text("city"),
    startsOn: text("starts_on"),
    endsOn: text("ends_on"),
    booth: text("booth"),
    feeCents: integer("fee_cents"),
    currency: text("currency").notNull().default("USD"),
    status: text("status", { enum: ["planned", "applied", "accepted", "declined", "done", "cancelled"] })
      .notNull()
      .default("planned"),
    notes: text("notes"),
    ...recordColumns(),
  },
  (t) => [
    index("shows_studio_updated").on(t.studioId, t.updatedAt),
    index("shows_studio_starts").on(t.studioId, t.startsOn),
    actorCheck("shows_actor"),
    metaCheck("shows_meta"),
  ],
);

export const showArtworks = sqliteTable(
  "show_artworks",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    showId: text("show_id").notNull().references(() => shows.id),
    artworkId: text("artwork_id").notNull().references(() => artworks.id),
    outcome: text("outcome", { enum: ["brought", "sold", "returned"] }).notNull().default("brought"),
    soldPriceCents: integer("sold_price_cents"),
    currency: text("currency").notNull().default("USD"),
    clientId: text("client_id").references(() => clients.id),
    soldAt: text("sold_at"),
    ...recordColumns(),
  },
  (t) => [
    uniqueIndex("show_artworks_show_artwork").on(t.showId, t.artworkId).where(sql`deleted_at IS NULL`),
    index("show_artworks_studio_artwork").on(t.studioId, t.artworkId),
    index("show_artworks_studio_updated").on(t.studioId, t.updatedAt),
    actorCheck("show_artworks_actor"),
    metaCheck("show_artworks_meta"),
  ],
);

// 0003 — the Show Tracker's sale rows (D-035). artwork_id is optional: a
// tracker sale names a piece in words, not a catalogued artwork.
export const sales = sqliteTable(
  "sales",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    showId: text("show_id").references(() => shows.id),
    artworkId: text("artwork_id").references(() => artworks.id),
    title: text("title"),
    priceCents: integer("price_cents"),
    currency: text("currency").notNull().default("USD"),
    quantity: integer("quantity").notNull().default(1),
    soldOn: text("sold_on"),
    paymentMethod: text("payment_method", { enum: ["cash", "card", "check", "online", "other"] }),
    size: text("size"),
    medium: text("medium"),
    source: text("source", { enum: ["manual", "square", "stripe", "csv"] }).notNull().default("manual"),
    externalId: text("external_id"),
    notes: text("notes"),
    ...recordColumns(),
  },
  (t) => [
    index("sales_studio_updated").on(t.studioId, t.updatedAt),
    index("sales_studio_show").on(t.studioId, t.showId),
    actorCheck("sales_actor"),
    metaCheck("sales_meta"),
  ],
);

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    r2Key: text("r2_key").notNull().unique(),
    thumbKey: text("thumb_key"),
    name: text("name").notNull(),
    contentType: text("content_type"),
    size: integer("size"),
    kind: text("kind", { enum: ["photo", "reference", "agreement", "coa", "receipt", "document", "other"] })
      .notNull()
      .default("other"),
    status: text("status", { enum: ["pending", "ready"] }).notNull().default("pending"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    ...recordColumns(),
  },
  (t) => [
    index("files_studio_entity").on(t.studioId, t.entityType, t.entityId),
    index("files_studio_updated").on(t.studioId, t.updatedAt),
    actorCheck("files_actor"),
    metaCheck("files_meta"),
  ],
);

export const activityLog = sqliteTable(
  "activity_log",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    actorId: text("actor_id"),
    actorType: text("actor_type", { enum: actorTypes }).notNull(),
    source: text("source", { enum: ["app", "assistant", "job", "api_key", "sync", "system"] }).notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    before: text("before", { mode: "json" }).$type<Record<string, unknown> | null>(),
    after: text("after", { mode: "json" }).$type<Record<string, unknown> | null>(),
    opId: text("op_id"),
    jobId: text("job_id"),
    undoOf: text("undo_of").references((): AnySQLiteColumn => activityLog.id),
    undoneAt: text("undone_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("activity_studio_seq").on(t.studioId, t.seq),
    index("activity_studio_entity").on(t.studioId, t.entityType, t.entityId),
    index("activity_job").on(t.jobId).where(sql`job_id IS NOT NULL`),
    uniqueIndex("activity_studio_op").on(t.studioId, t.opId, t.entityId).where(sql`op_id IS NOT NULL`),
  ],
);

export type ArtworkRow = typeof artworks.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type SettingsRow = typeof studioSettings.$inferSelect;
export type ShowRow = typeof shows.$inferSelect;
export type ShowArtworkRow = typeof showArtworks.$inferSelect;
export type ActivityRow = typeof activityLog.$inferSelect;
