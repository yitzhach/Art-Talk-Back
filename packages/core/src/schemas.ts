// API shapes (camelCase). One definition each, used by studio-api for
// validation and OpenAPI, and later by the SDK and the assistant's tools.
import { z } from "zod";
import { isValid } from "ulidx";
import { ArtworkShipping, ShipTier, ShippingSettings } from "./shipping";

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
/** A work, or a photo the studio's site pages use (a banner, a process or room photo), never listed in Works (D-118). */
export const ArtworkKind = z.enum(["work", "site_photo"]);
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
  kind: ArtworkKind,
  /** The work's own shipping (D-146); null until the owner sets it. */
  shipping: ArtworkShipping.nullable(),
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
  /** First look (D-165): set by `artwork.first_look`; hidden from the public site until then. */
  publicFrom: z.string().nullable(),
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

// ------------------------------------------------------------ the site (D-119)

/** A place on a site page that shows photos, e.g. `home.hero`, `process.surface`. The site names its places. */
export const SitePlace = z.string().min(1).max(60).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, "Lower case words joined by dots or hyphens");
const siteText = (max: number) => z.string().trim().min(1).max(max);
/** One block of a page's text: a heading and plain-text paragraphs (blank lines between them, no markup). */
export const SiteSection = z.object({
  /** Stable name for the site's template, e.g. `surface` for the first process stage. */
  key: SitePlace.optional(),
  heading: siteText(200).optional(),
  body: z.string().trim().max(5000).optional(),
  /** The photo place shown beside this section, if any. */
  place: SitePlace.optional(),
}).strict();
export const SitePage = z.object({
  title: siteText(200).optional(),
  /** The line under the title. */
  lede: z.string().trim().max(1000).optional(),
  sections: z.array(SiteSection).max(30).optional(),
}).strict();
/**
 * The site's pages. `trade` (designers and architects), `privacy` and `terms` are the final pass's (D-175): each is
 * public only once the artist saves its words, so an unsaved one stays off the site, its nav and its sitemap.
 */
export const SitePageKey = z.enum(["home", "commissions", "process", "about", "trade", "privacy", "terms"]);
/**
 * What the visitor assistant may say beyond a piece's record (D-126, D-128), in the studio's own words. Each is
 * plain text; a topic left out is handed to the artist. A piece's record wins over a general fact.
 */
export const AssistantTopic = z.enum([
  "commissionPrice", "commissionTimeline", "deposit", "shipping", "returns", "trade", "visits", "whereToSee",
  "materials", "outdoorUse", "weight", "hanging", "care", "other",
]);
export const SiteAssistant = z.object({
  /** false turns the chat off: the site shows search and the contact sheet only. */
  enabled: z.boolean().optional(),
  /** What the assistant calls the artist, e.g. "Isaac" (D-125). Default: "the artist". */
  artistName: z.string().trim().min(1).max(60).optional(),
  greeting: z.string().trim().min(1).max(300).optional(),
  /** Up to three questions the sheet offers as buttons. */
  suggestions: z.array(z.string().trim().min(1).max(80)).max(3).optional(),
  /** e.g. "Isaac usually replies within a day." */
  replyTime: z.string().trim().max(200).optional(),
  /** What a month of chat may cost, in cents (D-130). Default 1000. */
  budgetCents: z.number().int().min(0).max(1_000_000).optional(),
  answers: z.partialRecord(AssistantTopic, z.string().trim().max(1500)).optional(),
}).strict();
/**
 * Buying from the site (D-144): cards through the studio's Square account, Venmo and Zelle by hand. Off unless
 * `enabled`. Only pieces whose longest side is up to `smallMaxInches` get Buy; larger ones keep inquiry (D-102).
 */
export const SiteCheckout = z.object({
  enabled: z.boolean().optional(),
  /** Card on Square's checkout page. Needs the platform's Square credentials for this studio. Default true. */
  card: z.boolean().optional(),
  /** The Venmo name buyers pay, e.g. "@Isaac-Anderson-Art". Unset: no Venmo. */
  venmo: z.string().trim().regex(/^@?[A-Za-z0-9_-]{3,40}$/, "A Venmo name like @Your-Name").optional(),
  /** The email or US phone buyers send Zelle to. Unset: no Zelle. */
  zelle: z.string().trim().min(5).max(200).optional(),
  /** Flat shipping for a small piece, in cents. Default 0. */
  shippingCents: z.number().int().min(0).max(100_000).optional(),
  /** "Small" ends here, longest side in inches. Default 36. */
  smallMaxInches: z.number().min(1).max(240).optional(),
  /** The return terms shown before paying. */
  returns: z.string().trim().max(600).optional(),
  /** A fixed sales tax on the piece, basis points (600 = 6%). Default none. */
  taxBps: z.number().int().min(0).max(2000).optional(),
  /** How long a Venmo / Zelle order holds the piece. Default 48. */
  manualHoldHours: z.number().int().min(1).max(168).optional(),
}).strict();
/** Collectors' pages and first look (stage 6, D-163…D-168). */
export const SiteCollectors = z.object({
  /** Care notes every collector's page shows. */
  care: z.string().trim().max(2000).optional(),
  /** How many days first look runs before a work reaches the public site. Default 7. */
  firstLookDays: z.number().int().min(1).max(60).optional(),
}).strict();
/**
 * One of the artist's links elsewhere (Instagram, a gallery, press), for About's `sameAs` and `llms.txt` (card E,
 * D-176). https only: a link that names a person on another site is the artist's own choice to publish.
 */
export const SiteLink = z.object({
  label: siteText(60),
  url: z.string().trim().max(500).regex(/^https:\/\/[^\s/?#]+\.[^\s/?#]+[^\s]*$/i, "A complete https link"),
}).strict();
/** Calls taken between these times, studio time (`settings.timezone`); 24-hour HH:MM. */
const Hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM, 24-hour");
/**
 * The public face of a studio's site: its words, how to reach it, and which photos go where. Kept in
 * `settings.meta.site`, written through `settings.update` and checked there. Everything here is public.
 */
export const SiteProfile = z.object({
  name: siteText(120).optional(),
  tagline: z.string().trim().max(300).optional(),
  /** For search engines and link previews. */
  description: z.string().trim().max(300).optional(),
  /** For text and call links; digits with an optional leading +. */
  phone: z.string().trim().regex(/^\+?[0-9]{7,15}$/, "Digits only, with an optional leading +").optional(),
  email: z.email().max(200).optional(),
  hours: z.object({ from: Hhmm, to: Hhmm }).strict().optional(),
  pages: z.partialRecord(SitePageKey, SitePage).optional(),
  /** Each place's photos, in order: ids of the studio's artworks (site photos or works). Only public ones ever show. */
  photos: z.record(SitePlace, z.array(Id).max(12)).refine((p) => Object.keys(p).length <= 40, "At most 40 places").optional(),
  /** The visitor assistant's words, greeting and budget (D-126, D-136). */
  assistant: SiteAssistant.optional(),
  /** Buying from the site (D-144). */
  checkout: SiteCheckout.optional(),
  /** Shipping tiers, the large-work offer and the ZIP estimate (D-146…D-153). */
  shipping: ShippingSettings.optional(),
  /** Collectors' pages and first look (D-163…D-168). */
  collectors: SiteCollectors.optional(),
  /** The artist's links elsewhere, in order (D-176). */
  links: z.array(SiteLink).max(12).optional(),
}).strict();

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
  /**
   * How it ships (D-146): tier, the fixed price where there is one (tier 1 is 0, tier 2 the flat rate, a pinned
   * price), `estimate` when the price depends on the buyer's ZIP, `quote` when the artist quotes it. Null: not set.
   */
  shipping: z.object({ tier: ShipTier, cents: z.number().int().nullable(), estimate: z.boolean(), quote: z.boolean() }).nullable(),
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

/** What anyone may see of a studio (D-119): its site profile, minus the photo places, plus its time zone. */
export const PublicStudio = z.object({
  slug: z.string(),
  name: z.string(),
  tagline: z.string().nullable(),
  description: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  hours: z.object({ from: z.string(), to: z.string() }).nullable(),
  timezone: z.string(),
  pages: z.partialRecord(SitePageKey, SitePage),
  /** The artist's links elsewhere, in order (D-176); empty when none are saved. */
  links: z.array(SiteLink),
  catalogueVersion: z.number().int(),
});

/** A photo a site page shows: a public site photo or work, in its place's order (D-118). */
export const PublicSitePhoto = PublicImage.extend({
  title: z.string(),
  /** Set when the photo is a public work, so the page can link to it. */
  workSlug: Slug.nullable(),
});
export const PublicSitePhotos = z.object({
  places: z.record(z.string(), z.array(PublicSitePhoto)),
  catalogueVersion: z.number().int(),
});

// ---------------------------------------------------------------- the visitor assistant (Site 3.0 stage 3)

/** What the site's chat sheet needs to open (no sign-in). Never the budget or what was spent. */
export const PublicAssistant = z.object({
  name: z.string(),
  artistName: z.string(),
  greeting: z.string(),
  suggestions: z.array(z.string()),
  replyTime: z.string().nullable(),
  answers: z.partialRecord(AssistantTopic, z.string()),
  /** false: the chat is off or this month's budget is spent; the sheet shows search and Ask the artist. */
  available: z.boolean(),
  catalogueVersion: z.number().int(),
});

/** One work in the catalogue digest the assistant reads (public fields only). */
export const DigestWork = z.object({
  slug: Slug,
  title: z.string(),
  medium: z.string().nullable(),
  year: z.number().int().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  depth: z.number().nullable(),
  sizeUnit: SizeUnit,
  status: ArtworkStatus,
  priceCents: z.number().int().nullable(),
  currency: Currency.nullable(),
  collection: z.string().nullable(),
  tags: z.array(z.string()),
  palette: z.array(PaletteSwatch),
  /** The first sentence or so of the description. */
  blurb: z.string().nullable(),
  /** The cover at 480 px, a path on this API, or null. */
  image: z.string().nullable(),
});
export const PublicDigest = z.object({ works: z.array(DigestWork), catalogueVersion: z.number().int() });

/** A message as the visitor sees it again: text and the works shown as cards. */
export const VisitorMessage = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  works: z.array(z.string()),
  at: z.string(),
});
export const VisitorState = z.object({
  /** The visitor's proven email, or null. */
  email: z.string().nullable(),
  threadId: z.string().nullable(),
  messages: z.array(VisitorMessage),
});

/** A made page (D-131): read-only, unlisted. */
export const VisitorPageInput = z.object({
  title: z.string().trim().min(1).max(120),
  question: z.string().trim().max(500).optional(),
  works: z.array(Slug).min(1).max(24),
}).strict();
export const PublicVisitorPage = z.object({
  token: z.string(),
  title: z.string(),
  question: z.string().nullable(),
  works: z.array(PublicArtwork),
  createdAt: z.string(),
  catalogueVersion: z.number().int(),
});

export const LeadKind = z.enum(["inquiry", "hold"]);
export const LeadSource = z.enum(["chat", "form", "inquiry_list"]);
export const LeadStatus = z.enum(["new", "held", "declined", "closed"]);
export const LEAD_LIMITS = { pictures: 5, pictureBytes: 8 * 1024 * 1024, note: 3000, works: 24, perVisitorPerDay: 6, perAddressPerDay: 20 } as const;
/**
 * A lead from the site (D-129, D-133): JSON, or multipart with this as the `lead` field plus up to five `picture`
 * files. A hold is one available work (D-127). `website` is the form's hidden trap: anything in it, nothing is sent.
 */
export const LeadInput = z.object({
  kind: LeadKind,
  source: LeadSource.default("form"),
  works: z.array(Slug).max(LEAD_LIMITS.works).default([]),
  name: z.string().trim().max(120).optional(),
  email: z.email().max(200).optional(),
  phone: z.string().trim().regex(/^\+?[0-9 ().-]{7,24}$/, "A phone number").optional(),
  note: z.string().trim().max(LEAD_LIMITS.note).optional(),
  /** The chat this came from, so Isaac sees it with the lead. */
  threadId: Id.optional(),
  website: z.string().max(200).optional(),
}).strict()
  .refine((v) => !!v.email || !!v.phone, { message: "An email or a phone number, so Isaac can reply", path: ["email"] })
  .refine((v) => v.kind !== "hold" || v.works.length === 1, { message: "A hold is for one piece", path: ["works"] });

/** A lead as the owner sees it. */
export const Lead = z.object({
  id: Id,
  version: z.number().int(),
  kind: LeadKind,
  source: LeadSource,
  status: LeadStatus,
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  note: z.string().nullable(),
  works: z.array(z.object({ id: Id, slug: z.string().nullable(), title: z.string(), status: ArtworkStatus, priceCents: z.number().int().nullable(), currency: Currency.nullable() })),
  fileIds: z.array(Id),
  clientId: Id.nullable(),
  threadId: z.string().nullable(),
  /** For a held piece: when the hold ends (48 hours after Approve hold). */
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const LeadDetail = Lead.extend({ chat: z.array(VisitorMessage) });

export const AssistantUsageOut = z.object({
  month: z.string(),
  turns: z.number().int(),
  /** This month's spend in cents, to two decimals. */
  spentCents: z.number(),
  budgetCents: z.number().int(),
  capped: z.boolean(),
});

export const OrderMethod = z.enum(["card", "venmo", "zelle"]);
export const OrderStatus = z.enum(["pending", "awaiting_payment", "paid", "expired", "cancelled", "refunded"]);
export const OrderKind = z.enum(["piece", "deposit"]);
export const ShippingAddress = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(2).max(50),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "A US ZIP code"),
  country: z.literal("US").default("US"),
}).strict();
/**
 * A visitor buys one piece (D-144). By card, Square's page asks the address; by Venmo or Zelle, the site does.
 * `website` is the form's hidden trap, as on leads.
 */
export const OrderInput = z.object({
  /** One piece (the first cart); `works` takes the cart's pieces. */
  work: Slug.optional(),
  /** The cart: up to 10 pieces, one order (stage 4 revision). */
  works: z.array(Slug).min(1).max(10).optional(),
  /** The buyer's ZIP, for a large piece's estimate (D-153). */
  zip: z.string().regex(/^\d{5}$/, "A 5-digit ZIP").optional(),
  /** The shipping the cart showed, in cents: if it changed, nothing is reserved and the buyer sees the new total (409). */
  shippingCents: z.number().int().min(0).max(10_000_000).optional(),
  method: OrderMethod,
  name: z.string().trim().min(1).max(120).optional(),
  email: z.email().max(200).optional(),
  phone: z.string().trim().regex(/^\+?[0-9 ().-]{7,24}$/, "A phone number").optional(),
  address: ShippingAddress.optional(),
  website: z.string().max(200).optional(),
}).strict()
  .refine((v) => !!v.work !== !!v.works, { message: "One piece or the cart", path: ["works"] })
  .refine((v) => v.method === "card" || (!!v.name && !!v.email && !!v.address), {
    message: "Your name, email and shipping address, so the artist can send it", path: ["email"],
  });
/** What a buyer sees about their own order. */
export const PublicOrder = z.object({
  id: Id,
  code: z.string(),
  kind: OrderKind,
  method: OrderMethod,
  status: OrderStatus,
  title: z.string(),
  slug: z.string().nullable(),
  amountCents: z.number().int(),
  shippingCents: z.number().int(),
  taxCents: z.number().int(),
  totalCents: z.number().int(),
  currency: Currency,
  /** Shipping the studio covered (D-148). */
  coveredCents: z.number().int(),
  /** Each piece, for a cart order (one line for a one-piece order). */
  items: z.array(z.object({
    slug: z.string().nullable(), title: z.string(), priceCents: z.number().int(), shippingCents: z.number().int(), coveredCents: z.number().int(),
  })),
  /** Card: Square's checkout page, while the order waits. */
  checkoutUrl: z.string().nullable(),
  /** Venmo / Zelle: where to send the money, with the code in the note. */
  payTo: z.object({ venmo: z.string().nullable(), zelle: z.string().nullable() }).nullable(),
  expiresAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  shippedAt: z.string().nullable(),
  returns: z.string().nullable(),
});
/** The studio's shipping as the site shows it (D-146…D-153). Amounts in cents; rules only while they run. */
export const PublicShipping = z.object({
  tier1: z.object({ maxSqIn: z.number(), maxLongIn: z.number() }),
  tier2: z.object({ maxSqIn: z.number(), maxLongIn: z.number(), cents: z.number().int() }),
  /** R1: a tier 2 piece ships free with any other piece. */
  pairsFree: z.boolean(),
  /** R2: a qualifying piece takes `bps` of its price off one large piece's shipping. */
  largeOffer: z.object({ minCents: z.number().int(), bps: z.number().int(), capCents: z.number().int().nullable() }).nullable(),
  pickup: z.object({ words: z.string().nullable() }).nullable(),
  /** Only the US ships at checkout; anywhere else is a quote. */
  countries: z.array(z.string()),
  words: z.record(z.string(), z.string()),
});
export const ShippingQuoteInput = z.object({
  works: z.array(Slug).min(1).max(10),
  zip: z.string().regex(/^\d{5}$/, "A 5-digit ZIP").optional(),
  pickup: z.boolean().optional(),
}).strict();
/** The cart's shipping, worked out by studio-api (the site never works it out itself; D-151). */
export const ShippingQuote = z.object({
  ok: z.boolean(),
  needsZip: z.boolean(),
  quote: z.array(z.string()),
  blocked: z.array(z.object({ slug: z.string(), why: z.string() })),
  lines: z.array(z.object({
    slug: z.string(), tier: ShipTier, baseCents: z.number().int(), chargedCents: z.number().int(), coveredCents: z.number().int(),
    rule: z.enum(["r1", "r2"]).nullable(), estimate: z.boolean(),
  })),
  subtotalCents: z.number().int(),
  shippingCents: z.number().int(),
  coveredCents: z.number().int(),
  totalCents: z.number().int(),
  reason: z.string(),
  nudge: z.object({ kind: z.string(), text: z.string(), amountCents: z.number().int() }).nullable(),
  /** Up to three pieces that would unlock the offer: the artist's pairings first. */
  suggestions: z.array(z.object({ slug: z.string(), title: z.string(), priceCents: z.number().int(), image: z.string().nullable() })),
});
/** What the checkout page needs before an order exists. */
export const PublicCheckout = z.object({
  enabled: z.boolean(),
  methods: z.array(OrderMethod),
  shippingCents: z.number().int(),
  smallMaxInches: z.number(),
  taxBps: z.number().int(),
  returns: z.string().nullable(),
  manualHoldHours: z.number().int(),
  shipping: PublicShipping,
});
/** An order as the owner sees it. */
export const Order = PublicOrder.omit({ payTo: true, returns: true }).extend({
  version: z.number().int(),
  artworkId: Id.nullable(),
  leadId: Id.nullable(),
  clientId: Id.nullable(),
  paidCents: z.number().int().nullable(),
  buyerName: z.string().nullable(),
  buyerEmail: z.string().nullable(),
  buyerPhone: z.string().nullable(),
  shippingAddress: Meta.nullable(),
  carrier: z.string().nullable(),
  tracking: z.string().nullable(),
  squarePaymentId: z.string().nullable(),
  /** Paid for a piece that had already sold another way: refund it (the owner's call). */
  conflict: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const MarkPaidInput = z.object({
  /** What arrived, in cents; default the order's total. */
  paidCents: z.number().int().min(0).max(100_000_000).optional(),
  note: z.string().trim().max(500).optional(),
}).strict();
export const ShipInput = z.object({
  carrier: z.string().trim().min(1).max(60),
  tracking: z.string().trim().min(1).max(100),
}).strict();

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
    /** The studio's address in the public catalogue routes (`/v1/public/studios/{slug}/…`, Site 3.0). */
    studioSlug: z.string().optional(),
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

// ---------------------------------------------------------------- collectors (Site 3.0 stage 6, D-163…D-168)

export const COMMISSION_STAGE_LIST = ["surface", "layering", "color", "erosion", "finished"] as const;
export const CommissionStage = z.enum(COMMISSION_STAGE_LIST);
export const CommissionStatus = z.enum(["open", "done", "cancelled"]);
const StageNotes = z.partialRecord(CommissionStage, z.string().trim().max(2000));
export const CommissionFields = z.object({
  title: z.string().trim().min(1).max(200),
  size: nullableText(100),
  priceCents: z.number().int().nonnegative().nullable(),
  currency: Currency,
  stage: CommissionStage,
  status: CommissionStatus,
  notes: StageNotes,
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").nullable(),
});
export const CommissionInput = CommissionFields.partial().required({ title: true }).extend({ clientId: Id }).strict();
export const CommissionPatch = CommissionFields.partial().strict()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field");
export const Commission = CommissionFields.extend({
  id: Id, version: z.number().int(), clientId: Id, createdAt: z.string(), updatedAt: z.string(),
});

/** A collector's private link (D-163): the path on the studio's site. */
export const CollectorLink = z.object({ path: z.string(), invitedAt: z.string().nullable(), createdAt: z.string() });

export const CollectorSummary = z.object({
  id: Id,
  version: z.number().int(),
  name: z.string(),
  kind: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  /** Works this collector owns (D-164). */
  workCount: z.number().int(),
  commissionCount: z.number().int(),
  link: CollectorLink.nullable(),
  /** Follows the studio with a proven email (D-163). */
  following: z.boolean(),
  /** "site", "order", "manual"…: where the record came from, when known. */
  from: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const CollectorWork = z.object({
  id: Id,
  version: z.number().int(),
  slug: z.string().nullable(),
  title: z.string(),
  year: z.number().int().nullable(),
  status: ArtworkStatus,
  soldAt: z.string().nullable(),
  certificate: z.string(),
});
export const CollectorDetail = CollectorSummary.extend({
  notes: z.string().nullable(),
  works: z.array(CollectorWork),
  commissions: z.array(Commission),
});
export const SetOwnerInput = z.object({
  /** null: no owner recorded. */
  clientId: Id.nullable(),
  /** Marks an unsold work sold to them at this price (as Mark sold). Only for works not sold yet. */
  priceCents: z.number().int().nonnegative().optional(),
}).strict();
export const FirstLookInput = z.object({
  /** When the work reaches the public site; null ends first look now. Default: today + the studio's first-look days. */
  until: z.iso.datetime().nullable().optional(),
}).strict();
export const Follower = z.object({
  id: Id, email: z.string(), clientId: Id.nullable(), showId: Id.nullable(), showName: z.string().nullable(),
  verifiedAt: z.string().nullable(), unsubscribedAt: z.string().nullable(), createdAt: z.string(),
});

/** One work a collector owns, as their page shows it: public fields plus the certificate (D-166). */
export const PublicOwnedWork = PublicArtwork.extend({ certificate: z.string(), soldOn: z.string().nullable() });
export const PublicCommission = z.object({
  title: z.string(), size: z.string().nullable(), stage: CommissionStage, status: CommissionStatus, notes: StageNotes,
  dueOn: z.string().nullable(), updatedAt: z.string(),
});
/** A collector's page (D-163): their first name, their works, care, first look and commissions. Unlisted, no sign-in. */
export const PublicCollectorPage = z.object({
  firstName: z.string(),
  studioName: z.string(),
  works: z.array(PublicOwnedWork),
  care: z.string().nullable(),
  firstLook: z.array(PublicArtwork.extend({ publicFrom: z.string() })),
  commissions: z.array(PublicCommission),
  catalogueVersion: z.number().int(),
});
export const PublicFollowerPage = z.object({
  email: z.string(),
  following: z.boolean(),
  studioName: z.string(),
  firstLook: z.array(PublicArtwork.extend({ publicFrom: z.string() })),
});
export const PublicShow = z.object({
  id: Id, name: z.string(), venue: z.string().nullable(), city: z.string().nullable(), startsOn: z.string().nullable(), endsOn: z.string().nullable(),
});
export const FollowCodeInput = z.object({ email: z.email().max(200), showId: Id.optional(), website: z.string().max(200).optional() }).strict();
export const FollowVerifyInput = z.object({ email: z.email().max(200), code: z.string().regex(/^\d{6}$/), showId: Id.optional() }).strict();
