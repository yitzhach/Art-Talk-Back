// The assistant's side of the data (Phase 3): what it may do per action
// (assistant_policy), the confirm cards it leaves for a person
// (pending_actions), and its conversation (assistant_messages).
// Policy is enforced in runAction (D-045); these are the records around it.
import { AssistantLevel, Id, db as schema, newId } from "@studio/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { HttpError, notFound } from "../lib/errors";
import { inSeconds } from "../lib/time";
import {
  type EntityDef, defineEntity, findRecord, getEntity, getRecord, insertWrite, updateWrite,
} from "./records";
import { type ActionCtx, type ActionDef, type Snapshot, allowedLevels, defineAction, getAction } from "./runner";

const defaults = { createdBy: null, deletedAt: null, meta: {}, version: 1, actorType: "user" };

export const policyEntity = defineEntity({
  type: "assistant_policy", table: schema.assistantPolicy, key: schema.assistantPolicy.id,
  studio: schema.assistantPolicy.studioId, version: schema.assistantPolicy.version,
  deletedAt: schema.assistantPolicy.deletedAt, perm: "settings", defaults,
});

export const pendingEntity = defineEntity({
  type: "pending_action", table: schema.pendingActions, key: schema.pendingActions.id,
  studio: schema.pendingActions.studioId, version: schema.pendingActions.version,
  deletedAt: schema.pendingActions.deletedAt, perm: "assistant",
  defaults: { ...defaults, details: [], status: "pending", activityId: null },
});

export const messageEntity = defineEntity({
  type: "assistant_message", table: schema.assistantMessages, key: schema.assistantMessages.id,
  studio: schema.assistantMessages.studioId, version: schema.assistantMessages.version,
  deletedAt: schema.assistantMessages.deletedAt, perm: "assistant", defaults: { ...defaults, app: null },
});

/** How long a confirm card can wait for its tap. */
export const PROPOSAL_TTL = 24 * 3600;

export const setPolicy = defineAction({
  name: "assistant_policy.set",
  description: "Choose how much the assistant may do with one action",
  input: z.object({ action: z.string(), level: AssistantLevel }),
  permission: "settings:write",
  risk: "always_confirm",
  assistant: "never", // it never changes its own limits
  plan: async (ctx, { action, level }) => {
    const def = getAction(action);
    if (!def || def.internal) throw notFound("Action");
    if (!allowedLevels(def).includes(level)) {
      throw new HttpError("bad_request", `${action} can be set to ${allowedLevels(def).join(" or ")}`, { allowed: allowedLevels(def) });
    }
    const rows = await ctx.db.select().from(schema.assistantPolicy)
      .where(and(eq(schema.assistantPolicy.studioId, ctx.actor.studioId), eq(schema.assistantPolicy.action, action))).limit(1);
    const current = rows[0] as Snapshot | undefined;
    if (current) return { writes: [updateWrite(ctx, policyEntity, current, { level, deletedAt: null })] };
    return { writes: [insertWrite(ctx, policyEntity, { id: newId(), action, level })] };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

export const propose = defineAction({
  name: "assistant.propose",
  description: "Leave a confirm card for the person the assistant is helping",
  input: z.object({
    action: z.string(),
    input: z.record(z.string(), z.unknown()),
    summary: z.string(),
    details: z.array(z.object({ label: z.string(), value: z.string() })),
    level: z.enum(["confirm", "always_confirm"]),
  }),
  permission: "assistant:use",
  risk: "auto",
  internal: true,
  plan: async (ctx, p) => ({
    writes: [insertWrite(ctx, pendingEntity, {
      id: newId(), userId: ctx.actor.userId, ...p, status: "pending", expiresAt: inSeconds(PROPOSAL_TTL), activityId: null,
    })],
  }),
  respond: (_c, a) => a[0] as Snapshot,
});

export const resolve = defineAction({
  name: "assistant.resolve",
  description: "Mark a confirm card confirmed or cancelled",
  input: z.object({ id: Id, status: z.enum(["confirmed", "cancelled"]), activityId: z.string().nullable() }),
  permission: "assistant:use",
  risk: "auto",
  internal: true,
  plan: async (ctx, { id, status, activityId }) => {
    const before = await getRecord(ctx.db, pendingEntity, ctx.actor.studioId, id);
    if (before.status !== "pending") throw new HttpError("version_conflict", `This card was already ${before.status}`);
    return { writes: [updateWrite(ctx, pendingEntity, before, { status, activityId })] };
  },
  respond: (_c, a) => a[0] as Snapshot,
});

export const appendMessages = defineAction({
  name: "assistant.append",
  description: "Add turns to the assistant's conversation",
  input: z.object({
    threadId: Id,
    app: z.string().nullable(),
    messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.unknown() })).min(1),
  }),
  permission: "assistant:use",
  risk: "auto",
  internal: true,
  plan: async (ctx, { threadId, app, messages }) => ({
    writes: messages.map((m) => insertWrite(ctx, messageEntity, {
      id: newId(), userId: ctx.actor.userId, threadId, role: m.role, content: m.content ?? null, app,
    })),
  }),
  respond: (_c, a) => ({ ids: a.map((r) => (r as Snapshot).id) }),
});

// ------------------------------------------------------- card lines
// What a confirm card says the action will do, written here from the input
// itself, so a card can't say one thing and do another (the model's own
// summary is shown too, but these lines are the truth).

const words = (field: string) => field.replace(/Cents$/, "").replace(/Id$/, "").replace(/([A-Z])/g, " $1").toLowerCase().trim();
const LABELS: Record<string, string> = {
  title: "Piece", priceCents: "Price", soldOn: "Date sold", paymentMethod: "Paid by", showId: "Show",
  artworkId: "Artwork", clientId: "Client", feeCents: "Booth fee", startsOn: "Starts", endsOn: "Ends",
};
const label = (field: string) => LABELS[field] ?? words(field).replace(/^./, (c) => c.toUpperCase());

const money = (cents: number, currency = "USD") =>
  `${(cents / 100).toLocaleString("en-US", { style: "currency", currency })}`;

const LINKS: Record<string, string> = { showId: "show", artworkId: "artwork", clientId: "client" };

/** A record's name as a person would say it. */
export const nameOf = (r: Snapshot) => String(r.name ?? r.title ?? r.id);

async function valueText(ctx: ActionCtx, field: string, v: unknown, currency?: string): Promise<string> {
  if (v === null || v === undefined || v === "") return "not recorded";
  if (/Cents$/.test(field) && typeof v === "number") return money(v, currency);
  const linked = LINKS[field];
  if (linked && typeof v === "string") {
    const rec = await findRecord(ctx.db, getEntity(linked)!, ctx.actor.studioId, v, { withDeleted: true });
    if (!rec) throw notFound(label(field));
    return nameOf(rec);
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

async function fieldLines(ctx: ActionCtx, fields: Snapshot, currency?: string) {
  const lines = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === "id" || k === "version") continue;
    if (k === "currency" && v === "USD") continue; // the studio's currency: saying so is noise
    if (k === "meta" && v && typeof v === "object") {
      for (const [mk, mv] of Object.entries(v as Snapshot)) lines.push({ label: label(mk), value: await valueText(ctx, mk, mv, currency) });
      continue;
    }
    // A sale's price is per piece: with a quantity, say so ("2 × Price $90" read as $90 total).
    const name = k === "priceCents" && "quantity" in fields ? "Price each" : label(k);
    lines.push({ label: name, value: await valueText(ctx, k, v, currency) });
  }
  return lines;
}

export async function cardLines(ctx: ActionCtx, def: ActionDef, input: Snapshot) {
  const [type, verb] = def.name.split(".") as [string, string];
  const entity: EntityDef | undefined = getEntity(type);
  const lines: { label: string; value: string }[] = [{ label: "Action", value: def.description.split(".")[0]! }];
  if (entity && verb === "create") {
    const currency = typeof input.currency === "string" ? input.currency : undefined;
    lines.push(...(await fieldLines(ctx, input, currency)));
    return lines;
  }
  if (entity && typeof input.id === "string") {
    const rec = await getRecord(ctx.db, entity, ctx.actor.studioId, input.id, { withDeleted: verb === "restore" });
    lines.push({ label: type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), value: nameOf(rec) });
    const patch = input.patch as Snapshot | undefined;
    if (patch) {
      for (const line of await fieldLines(ctx, patch, (rec.currency as string | undefined) ?? undefined)) {
        const field = Object.keys(patch).find((k) => label(k) === line.label);
        const was = field ? await valueText(ctx, field, rec[field], rec.currency as string | undefined).catch(() => "") : "";
        lines.push({ label: line.label, value: was && was !== line.value ? `${was} → ${line.value}` : line.value });
      }
    }
    return lines;
  }
  lines.push(...(await fieldLines(ctx, input)));
  return lines;
}
