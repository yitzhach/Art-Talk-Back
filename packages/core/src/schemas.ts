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

export const AttachableType = z.enum(["artwork", "client"]);
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
export const SyncPushResponse = z.object({ results: z.array(SyncOpResult) });

export const SyncChange = z.object({ entityType: z.string(), entityId: z.string(), record: Meta });
export const SyncPullResponse = z.object({ changes: z.array(SyncChange), cursor: z.string(), hasMore: z.boolean() });

/** Fields that never auto-merge when two devices disagree (spec → Conflicts). */
export const NEVER_MERGE = ["status", "outcome", "currency"] as const;
export const isProtectedField = (field: string) =>
  (NEVER_MERGE as readonly string[]).includes(field) || /Cents$/.test(field);
