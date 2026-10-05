// API shapes (camelCase). One definition each, used by studio-api for
// validation and OpenAPI, and later by the SDK and the assistant's tools.
import { z } from "zod";
import { isValid } from "ulidx";

export const Id = z.string().refine(isValid, "Must be a ULID").meta({ description: "ULID" });
export const Currency = z.string().regex(/^[A-Z]{3}$/, "3-letter currency code");
export const SizeUnit = z.enum(["in", "cm"]);
export const ActorType = z.enum(["user", "assistant", "system", "api"]);
export const Meta = z.record(z.string(), z.unknown());

const nullableText = (max = 5000) => z.string().max(max).nullable();

/** Fields every stored record returns. */
export const RecordMeta = z.object({
  id: Id,
  studioId: Id,
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string().nullable(),
  actorType: ActorType,
  version: z.number().int().min(1),
  deletedAt: z.string().nullable(),
  meta: Meta,
});

// ---------------------------------------------------------------- artworks

export const ArtworkStatus = z.enum(["available", "reserved", "sold", "not_for_sale", "archived"]);

export const ArtworkFields = z.object({
  title: z.string().trim().min(1).max(300),
  inventoryCode: nullableText(100),
  medium: nullableText(300),
  year: z.number().int().min(0).max(3000).nullable(),
  width: z.number().nonnegative().nullable(),
  height: z.number().nonnegative().nullable(),
  depth: z.number().nonnegative().nullable(),
  sizeUnit: SizeUnit,
  priceCents: z.number().int().nonnegative().nullable(),
  currency: Currency,
  status: ArtworkStatus,
  description: nullableText(),
  primaryFileId: Id.nullable(),
  meta: Meta,
});
export const ArtworkPatch = ArtworkFields.partial().strict()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field");
export const ArtworkInput = ArtworkFields.partial().required({ title: true })
  .extend({ id: Id.optional() }).strict();
export const Artwork = RecordMeta.extend(ArtworkFields.shape);

// ----------------------------------------------------------------- clients

export const ClientFields = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["collector", "gallery", "business", "other"]),
  email: z.email().transform((e) => e.toLowerCase()).nullable(),
  phone: nullableText(50),
  address: nullableText(1000),
  notes: nullableText(),
  notifyEmail: z.boolean(),
  notifySms: z.boolean(),
  meta: Meta,
});
export const ClientPatch = ClientFields.partial().strict()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field");
export const ClientInput = ClientFields.partial().required({ name: true })
  .extend({ id: Id.optional() }).strict();
export const Client = RecordMeta.extend(ClientFields.shape);

// ---------------------------------------------------------------- settings

export const SettingsFields = z.object({
  currency: Currency,
  paymentTermsDays: z.number().int().min(0).max(365),
  depositBps: z.number().int().min(0).max(10000),
  taxRateBps: z.number().int().min(0).max(10000),
  sizeUnit: SizeUnit,
  timezone: z.string().min(1).max(64),
  emailTone: nullableText(500),
  signature: nullableText(2000),
  meta: Meta,
});
export const SettingsPatch = SettingsFields.partial().strict()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field");
export const Settings = SettingsFields.extend({
  studioId: Id,
  version: z.number().int().min(1),
  updatedAt: z.string(),
});

// ------------------------------------------------------------------- files

export const FileKind = z.enum(["photo", "reference", "agreement", "coa", "receipt", "document", "other"]);
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export const UploadRequest = z.object({
  name: z.string().trim().min(1).max(200),
  contentType: z.string().min(1).max(200),
  size: z.number().int().min(1).max(MAX_FILE_BYTES),
  kind: FileKind.optional(),
}).strict();

export const AttachableType = z.enum(["artwork", "client", "placement"]);
export const AttachRequest = z.object({ entityType: AttachableType, entityId: Id }).strict();

export const FileRecord = RecordMeta.extend({
  name: z.string(),
  contentType: z.string().nullable(),
  size: z.number().int().nullable(),
  kind: FileKind,
  status: z.enum(["pending", "ready"]),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  locked: z.boolean(),
});

// ---------------------------------------------------------------- activity

export const Activity = z.object({
  id: Id,
  actorId: z.string().nullable(),
  actorType: ActorType,
  source: z.enum(["app", "assistant", "job", "api_key", "sync", "system"]),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  before: Meta.nullable(),
  after: Meta.nullable(),
  undoOf: z.string().nullable(),
  undoneAt: z.string().nullable(),
  createdAt: z.string(),
});

export const ActionResult = z.object({
  ok: z.boolean(),
  result: Meta.optional(),
  activityIds: z.array(Id),
});

// --------------------------------------------------------------------- me

export const Role = z.enum(["owner", "staff", "client"]);
export const Me = z.object({
  user: z.object({ id: Id, email: z.string(), name: z.string().nullable() }),
  memberships: z.array(z.object({
    studioId: Id,
    studioName: z.string(),
    role: Role,
    clientId: z.string().nullable(),
  })),
  activeStudioId: z.string().nullable(),
});

// ------------------------------------------------------------------- shows

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
export const ShowStatus = z.enum(["planned", "applied", "accepted", "declined", "done", "cancelled"]);

export const ShowFields = z.object({
  name: z.string().trim().min(1).max(200),
  venue: nullableText(200),
  city: nullableText(200),
  startsOn: IsoDate.nullable(),
  endsOn: IsoDate.nullable(),
  booth: nullableText(100),
  feeCents: z.number().int().nonnegative().nullable(),
  currency: Currency,
  status: ShowStatus,
  notes: nullableText(),
  meta: Meta,
});
export const ShowPatch = ShowFields.partial().strict()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field");
export const ShowInput = ShowFields.partial().required({ name: true })
  .extend({ id: Id.optional() }).strict();
export const Show = RecordMeta.extend(ShowFields.shape);

export const ShowArtwork = RecordMeta.extend({
  showId: Id,
  artworkId: Id,
  outcome: z.enum(["brought", "sold", "returned"]),
  soldPriceCents: z.number().int().nullable(),
  currency: Currency,
  clientId: z.string().nullable(),
  soldAt: z.string().nullable(),
});
export const ShowDetail = Show.extend({ artworks: z.array(ShowArtwork) });

export const MarkSoldInput = z.object({
  artworkId: Id,
  priceCents: z.number().int().nonnegative(),
  currency: Currency.optional(),
  showId: Id.optional(),
  clientId: Id.optional(),
  /** The artwork version the artist saw; omit to use the current one. */
  version: z.number().int().min(1).optional(),
}).strict();

// ------------------------------------------------------------------- sales

/** One sale (D-035). Null price = not recorded, never 0; null date = not known. */
export const SaleFields = z.object({
  showId: Id.nullable(),
  artworkId: Id.nullable(),
  title: nullableText(300),
  priceCents: z.number().int().nonnegative().nullable(),
  currency: Currency,
  quantity: z.number().int().min(1),
  soldOn: IsoDate.nullable(),
  paymentMethod: z.enum(["cash", "card", "check", "online", "other"]).nullable(),
  size: nullableText(100),
  medium: nullableText(300),
  source: z.enum(["manual", "square", "stripe", "csv"]),
  externalId: nullableText(200),
  notes: nullableText(),
  meta: Meta,
});
export const SalePatch = SaleFields.partial().strict()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field");
export const SaleInput = SaleFields.partial().extend({ id: Id.optional() }).strict();
export const Sale = RecordMeta.extend(SaleFields.shape);

// -------------------------------------------------------------- placements
// Phase 5 (D-062): one scene, a booth or a wall. The space's real size is in
// fields; positions and the rest are in `scene`, in the format `format` names;
// `images` lists the studio files the scene uses (D-063), never the bytes.

/**
 * Caps that keep a logged write (before + after in one activity_log row)
 * well under D1's ~2 MB row limit (D-062).
 */
export const PLACEMENT_SCENE_MAX = 600_000;
export const PLACEMENT_IMAGES_MAX = 400;

export const PlacementImage = z.object({
  /** The image's key inside the scene (Booth Studio: its asset id). */
  key: z.string().min(1).max(100),
  /** The studio file holding it; null until the upload has been attached. */
  fileId: Id.nullable(),
  name: z.string().max(200).nullable(),
  contentType: z.string().max(200).nullable(),
  /** Pixel size (1 x 1 for non-images such as a 3D model). */
  width: z.number().int().min(0).max(100_000).nullable(),
  height: z.number().int().min(0).max(100_000).nullable(),
  /** Size of the original in bytes, as the device had it. */
  bytes: z.number().int().min(0).nullable(),
  /** What the scene uses it for (Booth Studio: artwork, ground, photo, model…). */
  role: z.string().max(50).nullable(),
}).strict();

const Scene = Meta.refine((v) => JSON.stringify(v).length <= PLACEMENT_SCENE_MAX,
  `The scene is too big to sync (over ${PLACEMENT_SCENE_MAX} characters of JSON)`);

export const PlacementFields = z.object({
  kind: z.enum(["booth", "wall"]),
  name: z.string().trim().min(1).max(200),
  format: z.string().regex(/^[a-z0-9-]+\/\d+$/, "app-name/version, e.g. booth-studio/1"),
  width: z.number().nonnegative().nullable(),
  depth: z.number().nonnegative().nullable(),
  height: z.number().nonnegative().nullable(),
  sizeUnit: SizeUnit,
  scene: Scene,
  images: z.array(PlacementImage).max(PLACEMENT_IMAGES_MAX),
  meta: Meta,
});
export const PlacementPatch = PlacementFields.partial().strict()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field");
export const PlacementInput = PlacementFields.partial().required({ name: true, format: true })
  .extend({ id: Id.optional() }).strict();
export const Placement = RecordMeta.extend(PlacementFields.shape);

// -------------------------------------------------------------------- sync

export const SyncOp = z.object({
  opId: Id,
  action: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  entityId: Id,
  /** The version the device edited from; null for creates and actions. */
  baseVersion: z.number().int().min(1).nullable(),
  input: z.record(z.string(), z.unknown()),
});
export const SyncPushRequest = z.object({ ops: z.array(SyncOp).min(1).max(200) });
/**
 * How many ops one push answers (D-050). The rest get no result and are sent
 * again. Each op costs about 6 D1 queries, and a Worker on the free plan may
 * run 50 per request. The SDK sends batches of this size.
 */
export const SYNC_PUSH_MAX_OPS = 6;

export const SyncStatus = z.enum(["applied", "merged", "conflict", "rejected", "duplicate"]);
export const SyncConflict = z.object({ field: z.string(), serverValue: z.unknown(), deviceValue: z.unknown() });
export const SyncOpResult = z.object({
  opId: Id,
  status: SyncStatus,
  record: Meta.optional(),
  conflicts: z.array(SyncConflict).optional(),
  error: z.object({ code: z.string(), message: z.string(), details: Meta.optional() }).optional(),
});
// No cursor here on purpose: a device advances its cursor only by pulling, so it can't skip others' changes.
export const SyncPushResponse = z.object({
  results: z.array(SyncOpResult).meta({ description: `One result per op, in order, for the first ${SYNC_PUSH_MAX_OPS} ops. Ops after those get no result and were not applied: send them again.` }),
});

export const SyncChange = z.object({ entityType: z.string(), entityId: z.string(), record: Meta });
export const SyncPullResponse = z.object({ changes: z.array(SyncChange), cursor: z.string(), hasMore: z.boolean() });

/** Fields that never auto-merge when two devices disagree (spec → Conflicts). */
export const NEVER_MERGE = ["status", "outcome", "currency"] as const;
export const isProtectedField = (field: string) =>
  (NEVER_MERGE as readonly string[]).includes(field) || /Cents$/.test(field);

// --------------------------------------------------------------- assistant
// Phase 3. The assistant is one more caller of studio-api; what it may do is
// decided here, per action, never in its prompt (spec → Autonomy levels, D-045).

export const AssistantLevel = z.enum(["auto", "confirm", "always_confirm", "never"]);

export const PolicyEntry = z.object({
  action: z.string(),
  description: z.string(),
  /** The registry's level for this action. */
  defaultLevel: AssistantLevel,
  /** What the studio chose, if anything. */
  studioLevel: AssistantLevel.nullable(),
  /** What applies: the studio's choice where allowed, else the default. */
  level: AssistantLevel,
  /** Levels the studio may pick (always_confirm can't be lowered). */
  allowed: z.array(AssistantLevel),
});
export const PolicyUpdate = z.object({ level: AssistantLevel }).strict();

/** One line of a confirm card, written by studio-api from the input itself (never by the model). */
export const CardLine = z.object({ label: z.string(), value: z.string() });

export const Proposal = RecordMeta.extend({
  userId: Id,
  action: z.string(),
  input: Meta,
  summary: z.string(),
  details: z.array(CardLine),
  level: z.enum(["confirm", "always_confirm"]),
  status: z.enum(["pending", "confirmed", "cancelled"]),
  expiresAt: z.string(),
  activityId: z.string().nullable(),
});

export const ActRequest = z.object({
  action: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  input: Meta,
  /** The assistant's one-line description for the card; shown beside studio-api's own lines. */
  summary: z.string().trim().min(1).max(300),
}).strict();
export const ActResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("done"), result: Meta, activityIds: z.array(Id) }),
  z.object({ status: z.literal("needs_confirmation"), proposal: Proposal }),
]);

export const ConfirmResponse = z.object({ proposal: Proposal, result: Meta, activityIds: z.array(Id) });

export const SearchType = z.enum(["show", "sale", "artwork", "client"]);
export const SearchItem = z.object({
  type: SearchType,
  id: Id,
  version: z.number().int(),
  label: z.string(),
  detail: z.string(),
});
export const SearchResponse = z.object({ items: z.array(SearchItem) });

export const ToolDef = z.object({
  /** Tool name for the model (letters, digits, _ and -). */
  name: z.string(),
  /** The registry action it runs, or null for a read tool (search). */
  action: z.string().nullable(),
  description: z.string(),
  inputSchema: Meta,
  level: AssistantLevel,
});
export const ToolsResponse = z.object({ app: z.string(), tools: z.array(ToolDef) });

export const AssistantMessage = z.object({
  id: Id,
  threadId: Id,
  role: z.enum(["user", "assistant"]),
  /** A Messages API `content` value, stored exactly as sent or received (the thread is append-only). */
  content: z.unknown(),
  app: z.string().nullable(),
  createdAt: z.string(),
});
export const ThreadResponse = z.object({ threadId: Id, messages: z.array(AssistantMessage) });
export const AppendMessages = z.object({
  threadId: Id,
  app: z.string().max(50).nullable(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.unknown() })).min(1).max(20),
}).strict();
