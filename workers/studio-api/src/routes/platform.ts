// Studios on the platform (Site 3.0 stage 7, D-170…D-175). A platform admin makes a studio for an artist (its owner,
// site addresses, plan and site words in one batch) and changes its plan or addresses. An admin is a signed-in person
// whose email is in PLATFORM_ADMINS (default OWNER_EMAILS), or a request carrying PLATFORM_KEY, which the "Add a
// studio" workflow sets for one run and then replaces. The admin never becomes a member of the studio they make.
// An owner reads their own studio's plan at GET /v1/plan; only an admin changes it.
import {
  MyPlan, PlanInput, PlatformStudio, PlatformStudioCreate, PlatformStudioList, PlatformStudioPatch, SiteProfile,
  newId,
} from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { requireActor } from "../auth/session";
import { requirePermission } from "../auth/permissions";
import type { AppEnv, Env } from "../env";
import { safeEqual, sha256 } from "../lib/crypto";
import { HttpError, notFound, versionConflict } from "../lib/errors";
import { assertOneChanged } from "../actions/runner";
import { sampleWorks } from "../lib/samples";
import { nowIso } from "../lib/time";
import { IfMatchHeader, PathId, body, errors, ifMatch, json, newApp, send } from "./common";

export const platformRoutes = newApp();

/** The monthly fee a new artist's studio starts with when the form names none (D-173). */
export const DEFAULT_PRICE_CENTS = 2900;
export const DEFAULT_TRIAL_DAYS = 30;
const DAY = 86_400_000;

type Row = Record<string, unknown>;
interface Caller { userId: string | null; actorType: "user" | "system"; source: "app" | "api_key" }

const emails = (list: string | undefined) => (list ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isPlatformAdmin = (env: Env, email: string) =>
  emails(env.PLATFORM_ADMINS || env.OWNER_EMAILS).includes(email.toLowerCase());

/** Who may make and change studios: an admin's session or the one-run key. The assistant never may. */
async function platformCaller(c: Context<AppEnv>): Promise<Caller> {
  const key = c.req.header("X-Platform-Key");
  if (key !== undefined) {
    const real = c.env.PLATFORM_KEY ?? "";
    if (real.length < 32 || !safeEqual(await sha256(key), await sha256(real))) throw new HttpError("unauthenticated", "Unknown platform key");
    return { userId: null, actorType: "system", source: "api_key" };
  }
  const auth = c.get("auth");
  if (!auth) throw new HttpError("unauthenticated", "Sign in first");
  if (auth.viaAssistant || !isPlatformAdmin(c.env, auth.email)) throw new HttpError("forbidden", "Only the platform's admins can do this");
  return { userId: auth.userId, actorType: "user", source: "app" };
}

const planOf = (r: Row) => ({
  status: r.plan_status as z.infer<typeof PlatformStudio>["plan"]["status"],
  priceCents: r.plan_price_cents == null ? null : Number(r.plan_price_cents),
  currency: r.plan_currency as string,
  trialEndsAt: (r.plan_trial_ends_at as string | null) ?? null,
});

/** The plan columns a PlanInput sets, on top of `base`. */
function planFields(input: z.infer<typeof PlanInput>, base: ReturnType<typeof planOf>, now: string) {
  const plan = { ...base };
  if (input.status) plan.status = input.status;
  if (input.priceCents !== undefined) plan.priceCents = input.priceCents;
  if (input.currency) plan.currency = input.currency;
  if (input.trialEndsAt !== undefined) plan.trialEndsAt = input.trialEndsAt;
  if (input.trialDays !== undefined) plan.trialEndsAt = input.trialDays ? new Date(Date.parse(now) + input.trialDays * DAY).toISOString() : null;
  return plan;
}

async function takenHosts(env: Env, hosts: string[], exceptStudio?: string): Promise<string[]> {
  if (!hosts.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT hostname, studio_id FROM site_hosts WHERE deleted_at IS NULL AND hostname IN (${hosts.map(() => "?").join(",")})`,
  ).bind(...hosts).all<Row>();
  return results.filter((r) => r.studio_id !== exceptStudio).map((r) => r.hostname as string);
}

async function studiosView(env: Env, ids?: string[]): Promise<z.infer<typeof PlatformStudio>[]> {
  const where = ids ? `AND s.id IN (${ids.map(() => "?").join(",")})` : "";
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.slug, s.plan_status, s.plan_price_cents, s.plan_currency, s.plan_trial_ends_at, s.created_at, s.version,
       (SELECT group_concat(h.hostname, ' ') FROM site_hosts h WHERE h.studio_id = s.id AND h.deleted_at IS NULL) AS hosts,
       (SELECT group_concat(u.email, ' ') FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.studio_id = s.id AND m.role = 'owner' AND m.deleted_at IS NULL) AS owners,
       (SELECT COUNT(*) FROM artworks a WHERE a.studio_id = s.id AND a.deleted_at IS NULL AND a.kind = 'work') AS works
     FROM studios s WHERE s.deleted_at IS NULL ${where} ORDER BY s.created_at, s.id`,
  ).bind(...(ids ?? [])).all<Row>();
  const split = (v: unknown) => (typeof v === "string" && v ? v.split(" ").sort() : []);
  return results.map((r) => ({
    id: r.id as string, name: r.name as string, slug: r.slug as string, hostnames: split(r.hosts), plan: planOf(r),
    owners: split(r.owners), works: Number(r.works), createdAt: r.created_at as string, version: Number(r.version),
  }));
}

const logStmt = (env: Env, caller: Caller, studioId: string, action: string, entityType: string, entityId: string, before: unknown, after: unknown, now: string, jobId: string | null) =>
  env.DB.prepare(
    `INSERT INTO activity_log (id, studio_id, actor_id, actor_type, source, action, entity_type, entity_id, before, after, job_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(newId(), studioId, caller.userId, caller.actorType, caller.source, action, entityType, entityId,
    before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), jobId, now);

const hostStmt = (env: Env, caller: Caller, studioId: string, hostname: string, now: string) => {
  const id = newId();
  return {
    id,
    stmt: env.DB.prepare(
      "INSERT INTO site_hosts (id, studio_id, hostname, created_at, updated_at, created_by, actor_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, studioId, hostname, now, now, caller.userId, caller.actorType),
  };
};

// ------------------------------------------------------------------ routes

platformRoutes.openapi(
  createRoute({
    method: "get", path: "/platform/studios", tags: ["platform"], summary: "Every studio on the platform (platform admins)",
    responses: { 200: json(PlatformStudioList), 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    await platformCaller(c);
    return send(c, { items: await studiosView(c.env) });
  },
);

platformRoutes.openapi(
  createRoute({
    method: "post", path: "/platform/studios", tags: ["platform"],
    summary: "Make a studio for an artist: owner, site addresses, template, plan, optional sample works (platform admins)",
    request: { body: body(PlatformStudioCreate) },
    responses: { 201: json(PlatformStudio), 400: errors[400], 401: errors[401], 403: errors[403], 409: errors[409] },
  }),
  async (c) => {
    const caller = await platformCaller(c);
    const input = c.req.valid("json");
    const env = c.env;
    const now = nowIso();
    const hosts = [...new Set(input.hostnames)];
    const taken = await takenHosts(env, hosts);
    if (taken.length) throw new HttpError("version_conflict", `Already another studio's address: ${taken.join(", ")}`, { hostnames: taken });

    const studioId = newId();
    const slug = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "studio"}-${studioId.slice(-6).toLowerCase()}`;
    const status = input.plan.status ?? "trial";
    const plan = planFields(
      { trialDays: status === "trial" ? DEFAULT_TRIAL_DAYS : 0, ...input.plan, status },
      { status, priceCents: status === "comped" || status === "test" ? null : DEFAULT_PRICE_CENTS, currency: "USD", trialEndsAt: null },
      now,
    );
    const site = SiteProfile.parse({ name: input.name, template: input.template });
    const jobId = newId();

    const owner = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(input.ownerEmail).first<Row>();
    const ownerId = (owner?.id as string | undefined) ?? newId();
    const samples = input.samples ? await sampleWorks(env, studioId, caller.userId, now) : [];
    const added = hosts.map((h) => ({ h, ...hostStmt(env, caller, studioId, h, now) }));

    const studioAfter = { id: studioId, name: input.name, slug, plan, hostnames: hosts, owner: input.ownerEmail, template: input.template, samples: samples.length / 2 };
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO studios (id, name, slug, created_at, updated_at, created_by, actor_type, plan_status, plan_price_cents, plan_currency, plan_trial_ends_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(studioId, input.name, slug, now, now, caller.userId, caller.actorType, plan.status, plan.priceCents, plan.currency, plan.trialEndsAt),
      ...(owner ? [] : [env.DB.prepare("INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(ownerId, input.ownerEmail, now, now)]),
      env.DB.prepare(
        "INSERT INTO memberships (id, studio_id, user_id, role, created_at, updated_at, created_by, actor_type) VALUES (?, ?, ?, 'owner', ?, ?, ?, ?)",
      ).bind(newId(), studioId, ownerId, now, now, caller.userId, caller.actorType),
      env.DB.prepare(
        "INSERT INTO studio_settings (studio_id, created_at, updated_at, created_by, actor_type, meta) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(studioId, now, now, caller.userId, caller.actorType, JSON.stringify({ site })),
      ...added.map((a) => a.stmt),
      ...samples.map((s) => env.DB.prepare(s.sql).bind(...s.params)),
      ...(samples.length ? [env.DB.prepare("UPDATE studios SET catalogue_version = catalogue_version + 1 WHERE id = ?").bind(studioId)] : []),
      logStmt(env, caller, studioId, "studio.create", "studio", studioId, null, studioAfter, now, jobId),
      ...added.map((a) => logStmt(env, caller, studioId, "site_host.add", "site_host", a.id, null, { id: a.id, hostname: a.h }, now, jobId)),
      ...samples.map((s) => logStmt(env, caller, studioId, s.table === "files" ? "file.sample" : "artwork.sample", s.table === "files" ? "file" : "artwork", s.id, null, s.after, now, jobId)),
    ]);
    return send(c, (await studiosView(env, [studioId]))[0], 201);
  },
);

platformRoutes.openapi(
  createRoute({
    method: "patch", path: "/platform/studios/{id}", tags: ["platform"],
    summary: "Change a studio's name, plan or site addresses (platform admins; If-Match: the studio's version)",
    request: { params: PathId, headers: IfMatchHeader, body: body(PlatformStudioPatch) },
    responses: { 200: json(PlatformStudio), 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const caller = await platformCaller(c);
    const { id } = c.req.valid("param");
    const patch = c.req.valid("json");
    const version = ifMatch(c);
    const env = c.env;
    const now = nowIso();
    const row = await env.DB.prepare("SELECT * FROM studios WHERE id = ? AND deleted_at IS NULL").bind(id).first<Row>();
    if (!row) throw notFound("Studio");
    if (Number(row.version) !== version) throw versionConflict();

    const add = [...new Set(patch.addHostnames ?? [])];
    const remove = [...new Set(patch.removeHostnames ?? [])].filter((h) => !add.includes(h));
    const taken = await takenHosts(env, add, id);
    if (taken.length) throw new HttpError("version_conflict", `Already another studio's address: ${taken.join(", ")}`, { hostnames: taken });
    const { results: mine } = await env.DB.prepare("SELECT id, hostname FROM site_hosts WHERE studio_id = ? AND deleted_at IS NULL").bind(id).all<Row>();
    const have = new Map(mine.map((r) => [r.hostname as string, r.id as string]));

    const before = { name: row.name, plan: planOf(row) };
    const plan = patch.plan ? planFields(patch.plan, planOf(row), now) : planOf(row);
    const after = { name: patch.name ?? (row.name as string), plan };
    const jobId = newId();
    const stmts: D1PreparedStatement[] = [
      env.DB.prepare(
        `UPDATE studios SET name = ?, plan_status = ?, plan_price_cents = ?, plan_currency = ?, plan_trial_ends_at = ?,
           catalogue_version = catalogue_version + 1, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`,
      ).bind(after.name, plan.status, plan.priceCents, plan.currency, plan.trialEndsAt, now, id, version),
      // A stale version changes no row: the assertion then fails and rolls the batch back (runner.ts).
      assertOneChanged(env.DB),
      logStmt(env, caller, id, "studio.update", "studio", id, before, after, now, jobId),
    ];
    for (const h of add.filter((x) => !have.has(x))) {
      const a = hostStmt(env, caller, id, h, now);
      stmts.push(a.stmt, logStmt(env, caller, id, "site_host.add", "site_host", a.id, null, { id: a.id, hostname: h }, now, jobId));
    }
    for (const h of remove) {
      const hostId = have.get(h);
      if (!hostId) continue;
      stmts.push(
        env.DB.prepare("UPDATE site_hosts SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").bind(now, now, hostId),
        logStmt(env, caller, id, "site_host.remove", "site_host", hostId, { id: hostId, hostname: h }, null, now, jobId),
      );
    }
    try {
      await env.DB.batch(stmts);
    } catch (e) {
      if (/NOT NULL/i.test(String(e))) throw versionConflict();
      throw e;
    }
    return send(c, (await studiosView(env, [id]))[0]);
  },
);

platformRoutes.openapi(
  createRoute({
    method: "get", path: "/plan", tags: ["platform"], summary: "This studio's plan and site addresses (read-only for the studio)",
    responses: { 200: json(MyPlan), 401: errors[401], 403: errors[403] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "settings:read");
    const [view] = await studiosView(c.env, [actor.studioId]);
    if (!view) throw notFound("Studio");
    return send(c, { ...view.plan, hostnames: view.hostnames });
  },
);

