// Drizzle schema — mirrors workers/studio-api/migrations/*.sql.
// db-drift.test.ts fails if the two disagree (D-012). Property names are
// camelCase (the API shape); column names are snake_case.
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
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
    // Migration 0010 appends this after meta: goes up with every change a public page could show.
    catalogueVersion: integer("catalogue_version").notNull().default(0),
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
    // Migration 0007 appends these after meta.
    passwordHash: text("password_hash"), // D-080: PBKDF2, optional
    passwordFailures: integer("password_failures").notNull().default(0),
    passwordLockedUntil: text("password_locked_until"),
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
  createdAt: text("created_at").notNull(), // start of the hour that `sends` counts (D-049)
  sends: integer("sends").notNull().default(1),
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
    // Migration 0010 (Site 3.0 stage 1) appends these after meta.
    public: integer("public", { mode: "boolean" }).notNull().default(false),
    publishedAt: text("published_at"),
    slug: text("slug"),
    collection: text("collection"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    palette: text("palette", { mode: "json" }).$type<{ hex: string; share: number }[]>().notNull().default(sql`'[]'`),
    editionSize: integer("edition_size"),
    draftedFields: text("drafted_fields", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    // Migration 0011 (Site 3.0 stage 2, D-118): a work, or a photo the site's pages use.
    kind: text("kind", { enum: ["work", "site_photo"] }).notNull().default("work"),
    // Migration 0014 (stage 4 revision, D-146): the work's own shipping (ArtworkShipping), null until set.
    shipping: text("shipping", { mode: "json" }).$type<Record<string, unknown> | null>(),
    // Migration 0015 (stage 6, D-165): first look; hidden from the public site until then.
    publicFrom: text("public_from"),
  },
  (t) => [
    index("artworks_studio_updated").on(t.studioId, t.updatedAt),
    index("artworks_studio_kind").on(t.studioId, t.kind, t.public),
    uniqueIndex("artworks_studio_slug").on(t.studioId, t.slug).where(sql`slug IS NOT NULL AND deleted_at IS NULL`),
    index("artworks_studio_public").on(t.studioId, t.public, t.status),
    index("artworks_studio_status").on(t.studioId, t.status),
    index("artworks_studio_title").on(t.studioId, sql`title COLLATE NOCASE`),
    uniqueIndex("artworks_studio_code")
      .on(t.studioId, t.inventoryCode)
      .where(sql`inventory_code IS NOT NULL AND deleted_at IS NULL`),
    check("artworks_kind", sql`kind IN ('work','site_photo')`),
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
    // Migration 0010 appends these after meta.
    position: integer("position").notNull().default(0),
    altText: text("alt_text"),
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

// Phase 3: the assistant's side (migration 0005).
const levels = ["auto", "confirm", "always_confirm", "never"] as const;

export const assistantPolicy = sqliteTable(
  "assistant_policy",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    action: text("action").notNull(),
    level: text("level", { enum: levels }).notNull(),
    ...recordColumns(),
  },
  (t) => [
    uniqueIndex("assistant_policy_action").on(t.studioId, t.action),
    actorCheck("assistant_policy_actor"),
    metaCheck("assistant_policy_meta"),
  ],
);

export const pendingActions = sqliteTable(
  "pending_actions",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    userId: text("user_id").notNull().references(() => users.id),
    action: text("action").notNull(),
    input: text("input", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    summary: text("summary").notNull(),
    details: text("details", { mode: "json" }).$type<{ label: string; value: string }[]>().notNull().default(sql`'[]'`),
    level: text("level", { enum: ["confirm", "always_confirm"] }).notNull(),
    status: text("status", { enum: ["pending", "confirmed", "cancelled"] }).notNull().default("pending"),
    expiresAt: text("expires_at").notNull(),
    activityId: text("activity_id"),
    ...recordColumns("assistant"),
  },
  (t) => [
    index("pending_actions_studio_status").on(t.studioId, t.status),
    actorCheck("pending_actions_actor"),
    metaCheck("pending_actions_meta"),
  ],
);

export const assistantMessages = sqliteTable(
  "assistant_messages",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    userId: text("user_id").notNull().references(() => users.id),
    threadId: text("thread_id").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content", { mode: "json" }).$type<unknown>().notNull(),
    app: text("app"),
    ...recordColumns("assistant"),
  },
  (t) => [
    index("assistant_messages_thread").on(t.studioId, t.userId, t.threadId, t.id),
    actorCheck("assistant_messages_actor"),
    metaCheck("assistant_messages_meta"),
  ],
);

// Phase 5 (D-062): one scene per row, a booth or a wall. Real sizes in columns,
// positions in `scene` (in the app's `format`), images as studio files (`images`).
export const placements = sqliteTable(
  "placements",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    kind: text("kind", { enum: ["booth", "wall"] }).notNull().default("booth"),
    name: text("name").notNull(),
    format: text("format").notNull(),
    width: real("width"),
    depth: real("depth"),
    height: real("height"),
    sizeUnit: text("size_unit", { enum: ["in", "cm"] }).notNull().default("in"),
    scene: text("scene", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    images: text("images", { mode: "json" }).$type<Record<string, unknown>[]>().notNull().default(sql`'[]'`),
    ...recordColumns(),
  },
  (t) => [
    index("placements_studio_updated").on(t.studioId, t.updatedAt),
    index("placements_studio_kind").on(t.studioId, t.kind),
    actorCheck("placements_actor"),
    metaCheck("placements_meta"),
  ],
);

// Phase 5, Studio Wall (D-083): inspiration boards, their cards (pins) and the
// owner's and clients' comments and stars (board_feedback).
export const boards = sqliteTable(
  "boards",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    name: text("name").notNull(),
    description: text("description"),
    coverPinId: text("cover_pin_id"),
    position: integer("position").notNull().default(0),
    commentsEnabled: integer("comments_enabled", { mode: "boolean" }).notNull().default(true),
    ...recordColumns(),
  },
  (t) => [
    index("boards_studio_updated").on(t.studioId, t.updatedAt),
    actorCheck("boards_actor"),
    metaCheck("boards_meta"),
  ],
);

export const pins = sqliteTable(
  "pins",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    boardId: text("board_id").notNull().references(() => boards.id),
    fileId: text("file_id").references(() => files.id),
    sourceUrl: text("source_url"),
    sourceCredit: text("source_credit"),
    isOwn: integer("is_own", { mode: "boolean" }).notNull().default(false),
    note: text("note"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    palette: text("palette", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    kind: text("kind", { enum: ["image", "idea", "link"] }).notNull().default("idea"),
    title: text("title"),
    linkedType: text("linked_type"),
    linkedId: text("linked_id"),
    contributorName: text("contributor_name"),
    deletedBy: text("deleted_by"),
    ...recordColumns(),
  },
  (t) => [
    index("pins_studio_updated").on(t.studioId, t.updatedAt),
    index("pins_studio_board").on(t.studioId, t.boardId),
    check("pins_tags", sql`json_valid(tags)`),
    check("pins_palette", sql`json_valid(palette)`),
    check("pins_kind", sql`kind IN ('image','idea','link')`),
    actorCheck("pins_actor"),
    metaCheck("pins_meta"),
  ],
);

export const boardFeedback = sqliteTable(
  "board_feedback",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    boardId: text("board_id").notNull().references(() => boards.id),
    pinId: text("pin_id").references(() => pins.id),
    text: text("text").notNull().default(""),
    starred: integer("starred", { mode: "boolean" }),
    authorName: text("author_name"),
    ...recordColumns(),
  },
  (t) => [
    index("board_feedback_studio_updated").on(t.studioId, t.updatedAt),
    index("board_feedback_studio_board").on(t.studioId, t.boardId),
    actorCheck("board_feedback_actor"),
    metaCheck("board_feedback_meta"),
  ],
);

// Phase 5, Studio Wall stage 5 (D-090…D-095): client links to a board. The
// token is derived from the id (D-091); token_hash finds it.
export const shares = sqliteTable(
  "shares",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    boardId: text("board_id").notNull().references(() => boards.id),
    tokenHash: text("token_hash").notNull().unique(),
    permission: text("permission", { enum: ["view", "comment", "contribute"] }).notNull(),
    expiresAt: text("expires_at"),
    passwordHash: text("password_hash"),
    pinIds: text("pin_ids", { mode: "json" }).$type<string[] | null>(),
    ...recordColumns(),
  },
  (t) => [
    index("shares_studio_board").on(t.studioId, t.boardId),
    check("shares_permission", sql`permission IN ('view','comment','contribute')`),
    check("shares_pin_ids", sql`pin_ids IS NULL OR json_valid(pin_ids)`),
    actorCheck("shares_actor"),
    metaCheck("shares_meta"),
  ],
);

export const shareSessions = sqliteTable(
  "share_sessions",
  {
    idHash: text("id_hash").primaryKey(),
    shareId: text("share_id").notNull().references(() => shares.id),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("share_sessions_expires").on(t.expiresAt)],
);

export const shareAttempts = sqliteTable(
  "share_attempts",
  {
    shareId: text("share_id").notNull().references(() => shares.id),
    ipHash: text("ip_hash").notNull(),
    at: text("at").notNull(),
  },
  (t) => [index("share_attempts_share_ip").on(t.shareId, t.ipHash, t.at)],
);

// Site 3.0 stage 3 (D-125…D-141): the visitor assistant, made pages and leads (migration 0012).
export const visitors = sqliteTable(
  "visitors",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    keyHash: text("key_hash").notNull().unique(),
    email: text("email"),
    emailVerifiedAt: text("email_verified_at"),
    ...recordColumns(),
  },
  (t) => [index("visitors_studio_email").on(t.studioId, t.email), actorCheck("visitors_actor"), metaCheck("visitors_meta")],
);

export const visitorMessages = sqliteTable(
  "visitor_messages",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    visitorId: text("visitor_id").notNull().references(() => visitors.id),
    threadId: text("thread_id").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    text: text("text").notNull(),
    works: text("works", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    ipHash: text("ip_hash"),
    ...recordColumns(),
  },
  (t) => [
    index("visitor_messages_thread").on(t.studioId, t.threadId, t.createdAt),
    index("visitor_messages_visitor").on(t.visitorId, t.createdAt),
    index("visitor_messages_ip").on(t.studioId, t.ipHash, t.createdAt),
    index("visitor_messages_studio_day").on(t.studioId, t.createdAt),
    check("visitor_messages_role", sql`role IN ('user','assistant')`),
    check("visitor_messages_works", sql`json_valid(works)`),
    actorCheck("visitor_messages_actor"),
    metaCheck("visitor_messages_meta"),
  ],
);

export const visitorPages = sqliteTable(
  "visitor_pages",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    visitorId: text("visitor_id").references(() => visitors.id),
    token: text("token").notNull().unique(),
    title: text("title").notNull(),
    question: text("question"),
    artworkIds: text("artwork_ids", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    ...recordColumns(),
  },
  (t) => [
    index("visitor_pages_visitor").on(t.studioId, t.visitorId, t.createdAt),
    check("visitor_pages_artworks", sql`json_valid(artwork_ids)`),
    actorCheck("visitor_pages_actor"),
    metaCheck("visitor_pages_meta"),
  ],
);

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    visitorId: text("visitor_id").references(() => visitors.id),
    clientId: text("client_id").references(() => clients.id),
    kind: text("kind", { enum: ["inquiry", "hold"] }).notNull(),
    source: text("source", { enum: ["chat", "form", "inquiry_list"] }).notNull().default("form"),
    status: text("status", { enum: ["new", "held", "declined", "closed"] }).notNull().default("new"),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    note: text("note"),
    artworkIds: text("artwork_ids", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    fileIds: text("file_ids", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    threadId: text("thread_id"),
    expiresAt: text("expires_at"),
    ipHash: text("ip_hash"),
    ...recordColumns(),
  },
  (t) => [
    index("leads_studio_status").on(t.studioId, t.status, t.createdAt),
    index("leads_visitor").on(t.studioId, t.visitorId, t.createdAt),
    index("leads_ip").on(t.studioId, t.ipHash, t.createdAt),
    check("leads_kind", sql`kind IN ('inquiry','hold')`),
    check("leads_source", sql`source IN ('chat','form','inquiry_list')`),
    check("leads_status", sql`status IN ('new','held','declined','closed')`),
    check("leads_artworks", sql`json_valid(artwork_ids)`),
    check("leads_files", sql`json_valid(file_ids)`),
    actorCheck("leads_actor"),
    metaCheck("leads_meta"),
  ],
);

export const assistantUsage = sqliteTable(
  "assistant_usage",
  {
    studioId: text("studio_id").notNull().references(() => studios.id),
    month: text("month").notNull(),
    turns: integer("turns").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costMillicents: integer("cost_millicents").notNull().default(0),
    cappedAt: text("capped_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.studioId, t.month] })],
);

// 0013 — buying from the site (D-144): an order per piece, and each Square webhook event once.
/** One piece of an order (orders.items). */
export interface OrderItemRow { artworkId: string; priceCents: number; shippingCents: number; coveredCents: number; rule: string | null }

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    kind: text("kind", { enum: ["piece", "deposit"] }).notNull().default("piece"),
    method: text("method", { enum: ["card", "venmo", "zelle"] }).notNull(),
    status: text("status", { enum: ["pending", "awaiting_payment", "paid", "expired", "cancelled", "refunded"] }).notNull().default("pending"),
    code: text("code").notNull(),
    artworkId: text("artwork_id").references(() => artworks.id),
    leadId: text("lead_id").references(() => leads.id),
    clientId: text("client_id").references(() => clients.id),
    visitorId: text("visitor_id").references(() => visitors.id),
    amountCents: integer("amount_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    paidCents: integer("paid_cents"),
    currency: text("currency").notNull().default("USD"),
    squareLinkId: text("square_link_id"),
    squareOrderId: text("square_order_id").unique(),
    squarePaymentId: text("square_payment_id"),
    checkoutUrl: text("checkout_url"),
    buyerName: text("buyer_name"),
    buyerEmail: text("buyer_email"),
    buyerPhone: text("buyer_phone"),
    shippingAddress: text("shipping_address", { mode: "json" }).$type<Record<string, unknown> | null>(),
    expiresAt: text("expires_at"),
    paidAt: text("paid_at"),
    shippedAt: text("shipped_at"),
    carrier: text("carrier"),
    tracking: text("tracking"),
    ...recordColumns(),
    // Migration 0014 (stage 4 revision): a multi-piece order's pieces, the shipping given away, the ZIP it was for.
    items: text("items", { mode: "json" }).$type<OrderItemRow[]>().notNull().default(sql`'[]'`),
    coveredCents: integer("covered_cents").notNull().default(0),
    shipZip: text("ship_zip"),
  },
  (t) => [
    index("orders_studio_status").on(t.studioId, t.status, t.createdAt),
    index("orders_studio_artwork").on(t.studioId, t.artworkId),
    index("orders_visitor").on(t.studioId, t.visitorId, t.createdAt),
    index("orders_expires").on(t.status, t.expiresAt),
    check("orders_kind", sql`kind IN ('piece','deposit')`),
    check("orders_method", sql`method IN ('card','venmo','zelle')`),
    check("orders_status", sql`status IN ('pending','awaiting_payment','paid','expired','cancelled','refunded')`),
    actorCheck("orders_actor"),
    metaCheck("orders_meta"),
  ],
);

export const paymentEvents = sqliteTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").references(() => studios.id),
    orderId: text("order_id").references(() => orders.id),
    type: text("type").notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (t) => [index("payment_events_received").on(t.receivedAt)],
);

// Migration 0015 (Site 3.0 stage 6, D-163…D-168): collectors' pages, followers, commissions.
export const collectorLinks = sqliteTable(
  "collector_links",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    clientId: text("client_id").notNull().references(() => clients.id),
    token: text("token").notNull().unique(),
    revokedAt: text("revoked_at"),
    invitedAt: text("invited_at"),
    ...recordColumns(),
  },
  (t) => [index("collector_links_client").on(t.studioId, t.clientId), actorCheck("collector_links_actor"), metaCheck("collector_links_meta")],
);

export const followers = sqliteTable(
  "followers",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    email: text("email").notNull(),
    clientId: text("client_id").references(() => clients.id),
    showId: text("show_id").references(() => shows.id),
    token: text("token").notNull().unique(),
    verifiedAt: text("verified_at"),
    unsubscribedAt: text("unsubscribed_at"),
    ...recordColumns(),
  },
  (t) => [uniqueIndex("followers_studio_email").on(t.studioId, t.email), actorCheck("followers_actor"), metaCheck("followers_meta")],
);

/** Visitor numbers (card G, D-177): counts per UTC day, nothing about a person. */
export const SITE_COUNT_KINDS = ["view", "ask", "wall", "inquiry"] as const;
export const siteCounts = sqliteTable(
  "site_counts",
  {
    studioId: text("studio_id").notNull().references(() => studios.id),
    day: text("day").notNull(),
    kind: text("kind", { enum: SITE_COUNT_KINDS }).notNull(),
    artworkId: text("artwork_id").notNull().default(""),
    n: integer("n").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.studioId, t.day, t.kind, t.artworkId] }),
    check("site_counts_kind", sql`kind IN ('view','ask','wall','inquiry')`),
  ],
);

export const COMMISSION_STAGES = ["surface", "layering", "color", "erosion", "finished"] as const;
export const commissions = sqliteTable(
  "commissions",
  {
    id: text("id").primaryKey(),
    studioId: text("studio_id").notNull().references(() => studios.id),
    clientId: text("client_id").notNull().references(() => clients.id),
    title: text("title").notNull(),
    size: text("size"),
    priceCents: integer("price_cents"),
    currency: text("currency").notNull().default("USD"),
    stage: text("stage", { enum: COMMISSION_STAGES }).notNull().default("surface"),
    status: text("status", { enum: ["open", "done", "cancelled"] }).notNull().default("open"),
    notes: text("notes", { mode: "json" }).$type<Record<string, string>>().notNull().default(sql`'{}'`),
    dueOn: text("due_on"),
    ...recordColumns(),
  },
  (t) => [
    index("commissions_client").on(t.studioId, t.clientId),
    check("commissions_price", sql`price_cents IS NULL OR price_cents >= 0`),
    check("commissions_currency", sql`length(currency) = 3`),
    check("commissions_stage", sql`stage IN ('surface','layering','color','erosion','finished')`),
    check("commissions_status", sql`status IN ('open','done','cancelled')`),
    check("commissions_notes", sql`json_valid(notes)`),
    actorCheck("commissions_actor"),
    metaCheck("commissions_meta"),
  ],
);

export type ArtworkRow = typeof artworks.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type SettingsRow = typeof studioSettings.$inferSelect;
export type ShowRow = typeof shows.$inferSelect;
export type ShowArtworkRow = typeof showArtworks.$inferSelect;
export type ActivityRow = typeof activityLog.$inferSelect;
export type PlacementRow = typeof placements.$inferSelect;
export type BoardRow = typeof boards.$inferSelect;
export type PinRow = typeof pins.$inferSelect;
export type FeedbackRow = typeof boardFeedback.$inferSelect;
export type ShareRow = typeof shares.$inferSelect;
export type LeadRow = typeof leads.$inferSelect;
export type VisitorRow = typeof visitors.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
