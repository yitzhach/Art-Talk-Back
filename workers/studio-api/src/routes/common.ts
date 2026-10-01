import { isId } from "@studio/core";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { requireActor } from "../auth/session";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/errors";
import { type RunOptions, getAction, runAction } from "../actions/runner";

export const ErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.record(z.string(), z.unknown()).optional() }),
}).meta({ id: "Error" });

const err = (description: string) => ({ description, content: { "application/json": { schema: ErrorBody } } });
export const errors = {
  400: err("Invalid input"),
  401: err("Not signed in"),
  403: err("Not allowed for your role"),
  404: err("Not found (or in another studio)"),
  409: err("The record changed since you loaded it"),
} as const;

export const json = <T extends z.ZodType>(schema: T, description = "OK") => ({
  description,
  content: { "application/json": { schema } },
});
export const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

export const IfMatchHeader = z.object({ "if-match": z.string().optional().meta({ description: "Record version the change was based on" }) });
export const IdempotencyHeader = z.object({ "idempotency-key": z.string().optional().meta({ description: "Optional ULID; a repeat returns the first result" }) });
export const PathId = z.object({ id: z.string().meta({ param: { name: "id", in: "path" } }) });
export const PageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function newApp() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: { code: "bad_request", message: "Invalid input", details: { issues: result.error.issues } } }, 400);
      }
    },
  });
}

/** The version from If-Match; edits and deletes must say which version they saw. */
export function ifMatch(c: Context): number {
  const raw = c.req.header("If-Match")?.replace(/^W\//, "").replace(/"/g, "");
  if (!raw || !/^\d+$/.test(raw)) throw new HttpError("bad_request", "Send If-Match: <version> with edits and deletes");
  return Number(raw);
}

export function opId(c: Context): string | null {
  const key = c.req.header("Idempotency-Key");
  if (key === undefined) return null;
  if (!isId(key)) throw new HttpError("bad_request", "Idempotency-Key must be a ULID");
  return key;
}

/** Runs a registered action as the signed-in caller. */
export async function run<R = unknown>(c: Context<AppEnv>, name: string, input: unknown, extra: Partial<RunOptions> = {}) {
  const def = getAction(name);
  if (!def) throw new HttpError("not_found", `No action named ${name}`);
  return runAction<R>(def as never, input, {
    env: c.env, actor: requireActor(c), origin: new URL(c.req.url).origin, opId: opId(c), ...extra,
  });
}

/**
 * Records leave the database already in their API shape (Drizzle maps the
 * columns), so typed handlers send them through this one cast instead of
 * re-validating every response. The API tests check the real shapes.
 */
export const send = (c: Context, data: unknown, status: 200 | 201 = 200): never => c.json(data as never, status) as never;
