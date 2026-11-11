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

/** A work's address on the public site: lower case words joined by hyphens (Site 3.0, migration 0010). */
export const Slug = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lower case letters, numbers and single hyphens");
/** One colour of a work's cover, read by code in the owner's browser; `share` in basis points. */
export const PaletteSwatch = z.object({
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "#rrggbb").toLowerCase(),
  share: z.number().int().min(0).max(10000),
});
export const ArtworkTag = z.string().trim().toLowerCase().min(1).max(40);
/** Fields the assistant drafts; while a name is in `draftedFields`, that field still holds its unedited text. */
export const DraftableField = z.enum(["description", "tags", "collection", "altText"]);
export const MAX_TAGS = 20;
export const MAX_PALETTE = 6;

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
  slug: Slug.nullable(),
  collection: z.string().trim().min(1).max(80).nullable(),
  tags: z.array(ArtworkTag).max(MAX_TAGS),
  palette: z.array(PaletteSwatch).max(MAX_PALETTE),
  /** null = an original (D-102 question 8: ready for editions, unused for now). */
  editionSize: z.number().int().min(1).max(100000).nullable(),
  meta: Meta,
});
export const ArtworkPatch = ArtworkFields.partial().strict()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field");
export const ArtworkInput = ArtworkFields.partial().required({ title: true })
  .extend({ id: Id.optional() }).strict();
/** Set only by the server: `public` and `publishedAt` by publish/unpublish (D-104), `draftedFields` by the assistant's draft. */
export const Artwork = RecordMeta.extend(ArtworkFields.shape).extend({
  public: z.boolean(),
  publishedAt: z.string().nullable(),
  draftedFields: z.array(DraftableField),
});

export const PublishRequest = z.object({ slug: Slug.optional() }).strict();

/** What the assistant's draft job writes (artwork.applyDraft): only empty or still-drafted fields change. */
export const DraftResult = z.object({
  description: z.string().trim().min(1).max(5000).optional(),
  tags: z.array(ArtworkTag).max(12).optional(),
  collection: z.string().trim().min(1).max(80).optional(),
  altText: z.string().trim().min(1).max(500).optional(),
  /** What the draft cost, for the studio's assistant budget (D-100). */
  usage: z.object({ model: z.string().max(80), inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0) }).optional(),
}).strict();

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

/** Widths the owner's browser makes of a picture (D-106); a size is never wider than the original. */
export const IMAGE_WIDTHS = [480, 960, 1600] as const;
export const ImageWidth = z.union([z.literal(480), z.literal(960), z.literal(1600)]);
export const MAX_SIZE_BYTES = 10 * 1024 * 1024;

export const UploadRequest = z.object({
  name: z.string().trim().min(1).max(200),
  contentType: z.string().min(1).max(200),
  size: z.number().int().min(1).max(MAX_FILE_BYTES),
  kind: FileKind.optional(),
  /** WebP copies the browser made, each uploaded to its own signed link (D-106). Pictures only. */
  sizes: z.array(z.object({ width: ImageWidth, size: z.number().int().min(1).max(MAX_SIZE_BYTES) }).strict()).min(1).max(3).optional(),
  /** The original's pixel size, so pages can reserve the space before the picture loads. */
  pixels: z.object({ width: z.number().int().min(1).max(100000), height: z.number().int().min(1).max(100000) }).strict().optional(),
}).strict()
  .refine((v) => !v.sizes || new Set(v.sizes.map((s) => s.width)).size === v.sizes.length, "Each width once")
  .refine((v) => !v.sizes || v.contentType.toLowerCase().startsWith("image/"), "Sizes are for pictures");

export const AttachableType = z.enum(["artwork", "client", "placement", "pin"]);
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
  /** Order among a record's pictures, lowest first (migration 0010). */
  position: z.number().int(),
  altText: z.string().nullable(),
});

export const FilePatch = z.object({
  altText: z.string().trim().max(500).nullable(),
  position: z.number().int().min(0).max(10000),
  locked: z.boolean(),
}).partial().strict().refine((v) => Object.keys(v).length > 0, "Send at least one field");

export const FileReorder = z.object({
  entityType: z.literal("artwork"),
  entityId: Id,
  /** The record's files in their new order; files not named keep their place after these. */
  fileIds: z.array(Id).min(1).max(50),
}).strict();

/** An artwork with its pictures in order (owner view). */
export const ArtworkDetail = Artwork.extend({ images: z.array(FileRecord) });

// ---------------------------------------------------------------- public catalogue (Site 3.0, D-104, D-106)

export const PublicImage = z.object({
  fileId: Id,
  altText: z.string().nullable(),
  /** Original width ÷ height, when known. */
  aspectRatio: z.number().positive().nullable(),
  /** Each size the picture has, as a path on this API (`/v1/public/studios/{slug}/images/{fileId}/{width}.webp`). */
  sizes: z.array(z.object({ width: ImageWidth, url: z.string() })),
});

/** What anyone may see of a public work. Never its id, inventory code, notes, meta or who made the record. */
export const PublicArtwork = z.object({
  slug: Slug,
  title: z.string(),
  medium: z.string().nullable(),
  year: z.number().int().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  depth: z.number().nullable(),
  sizeUnit: SizeUnit,
  editionSize: z.number().int().nullable(),
  collection: z.string().nullable(),
  tags: z.array(z.string()),
  palette: z.array(PaletteSwatch),
  description: z.string().nullable(),
  status: ArtworkStatus,
  /** Only for an available work with a price (D-102 question 6); otherwise null. */
  priceCents: z.number().int().nullable(),
  currency: Currency.nullable(),
  images: z.array(PublicImage),
  publishedAt: z.string().nullable(),
});

export const PublicArtworkList = z.object({
  items: z.array(PublicArtwork),
  nextCursor: z.string().nullable(),
  /** Goes up whenever the studio's public catalogue may have changed; key caches on it. */
  catalogueVersion: z.number().int(),
});
export const PublicCollections = z.object({
  items: z.array(z.object({ name: z.string(), count: z.number().int() })),
  catalogueVersion: z.number().int(),
});
export const PublicArtworkDetail = PublicArtwork.extend({ catalogueVersion: z.number().int() });

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
  /** D-080: whether this person has set a password (sign-in by code always works). */
  hasPassword: z.boolean().optional(),
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

// ------------------------------------------------- boards, pins, feedback
// Phase 5, Studio Wall (D-083): inspiration boards, their cards (pins) and
// comments and stars on them (board_feedback). Empty text is null, not "".

/** Keeps a card's `meta` (its drawings live there) small enough to log twice in one row. */
export const PIN_META_MAX = 100_000;
/** Most cards one pin.save, pin.move or pin.copy handles. */
export const PIN_BATCH_MAX = 50;

const HttpUrl = z.string().max(2000).regex(/^https?:\/\/\S+$/i, "A complete http or https link");

export const BoardFields = z.object({
  name: z.string().trim().min(1).max(200),
  description: nullableText(),
  coverPinId: Id.nullable(),
  position: z.number().int().min(0).max(1_000_000),
  commentsEnabled: z.boolean().meta({ description: "Clients may comment and star through a link (stage 5)" }),
  meta: Meta,
});
export const BoardPatch = BoardFields.partial().strict()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field");
export const BoardInput = BoardFields.partial().required({ name: true }).extend({ id: Id.optional() }).strict();
export const Board = RecordMeta.extend(BoardFields.shape);

export const PinKind = z.enum(["image", "idea", "link"]);
export const PinLinkType = z.enum(["artwork"]);
const PinMeta = Meta.refine((v) => JSON.stringify(v).length <= PIN_META_MAX,
  `The card's meta is too big (over ${PIN_META_MAX} characters of JSON)`);

export const PinFields = z.object({
  boardId: Id,
  fileId: Id.nullable().meta({ description: "The card's picture: a studio file in this studio" }),
  sourceUrl: HttpUrl.nullable(),
  sourceCredit: nullableText(500),
  isOwn: z.boolean().meta({ description: "The artist's own work, not a reference" }),
  note: nullableText(),
  tags: z.array(z.string().trim().min(1).max(50)).max(50),
  palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/i, "#rrggbb")).max(12),
  kind: PinKind,
  title: nullableText(500),
  linkedType: PinLinkType.nullable(),
  linkedId: Id.nullable(),
  contributorName: nullableText(100),
  deletedBy: nullableText(100).meta({ description: "Who removed it, when not the owner (e.g. guest:<id>)" }),
  meta: PinMeta,
});
export const PinPatch = PinFields.partial().strict()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field");
export const PinInput = PinFields.partial().required({ boardId: true, kind: true }).extend({ id: Id.optional() }).strict();
export const Pin = RecordMeta.extend(PinFields.shape);

export const FeedbackFields = z.object({
  boardId: Id,
  pinId: Id.nullable(),
  text: z.string().trim().max(4000),
  starred: z.boolean().nullable().meta({ description: "null for a comment; true or false for a star" }),
  authorName: nullableText(100),
  meta: Meta,
});
export const FeedbackPatch = FeedbackFields.omit({ boardId: true }).partial().strict()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field");
export const FeedbackInput = FeedbackFields.partial().required({ boardId: true }).extend({ id: Id.optional() }).strict()
  .refine((v) => !!v.text || typeof v.starred === "boolean", "A comment needs text; a star needs starred");
export const Feedback = RecordMeta.extend(FeedbackFields.shape);

// ------------------------------------------------------------------ shares
// Phase 5, Studio Wall stage 5 (D-090…D-095): a client link to one board.

export const SharePermission = z.enum(["view", "comment", "contribute"]);
/** Most chosen cards one link may name. */
export const SHARE_PINS_MAX = 500;

export const ShareInput = z.object({
  boardId: Id,
  permission: SharePermission,
  expiresDays: z.number().int().min(0).max(365).default(30)
    .meta({ description: "Days until the link stops working; 0 = never" }),
  password: z.string().min(8).max(200).optional()
    .meta({ description: "Clients type it once per browser; stored only as a hash" }),
  pinIds: z.array(Id).min(1).max(SHARE_PINS_MAX).optional()
    .meta({ description: "Only these cards of the board (live ones); absent = the whole board" }),
}).strict();

/** What the owner sees of a link. The token is shown again on every read (D-091). */
export const Share = z.object({
  id: Id,
  version: z.number().int().min(1).meta({ description: "Send it as If-Match to turn the link off" }),
  boardId: Id,
  token: z.string(),
  permission: SharePermission,
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  locked: z.boolean().meta({ description: "Has a password" }),
  pinCount: z.number().int().nullable().meta({ description: "Chosen cards; null = the whole board" }),
});

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

export const SearchType = z.enum(["show", "sale", "artwork", "client", "placement"]);
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
  /** The registry action it runs, or null for a read tool (search, describe_booth). */
  action: z.string().nullable(),
  description: z.string(),
  inputSchema: Meta,
  level: AssistantLevel,
  /**
   * A read tool other than search: the studio-api GET it runs, with `{name}`
   * filled from the input of that name (D-070). The assistant needs no code of
   * its own for a new one.
   */
  read: z.object({ path: z.string() }).optional(),
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
/** One past conversation in the list: its first words, when, and how long. */
export const ThreadSummary = z.object({
  threadId: Id, title: z.string(), startedAt: z.string(), lastAt: z.string(), messages: z.number().int(),
});
export const AppendMessages = z.object({
  threadId: Id,
  app: z.string().max(50).nullable(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.unknown() })).min(1).max(20),
}).strict();
