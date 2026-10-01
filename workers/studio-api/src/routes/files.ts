import { AttachRequest, FileRecord, MAX_FILE_BYTES, UploadRequest } from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { fileEntity, getRecord } from "../actions/records";
import { type Snapshot } from "../actions/runner";
import { publicFile } from "../actions/files";
import { requirePermission } from "../auth/permissions";
import { requireActor } from "../auth/session";
import { HttpError, notFound } from "../lib/errors";
import { signFileLink, verifyFileLink } from "../lib/signing";
import { IdempotencyHeader, PathId, body, errors, json, newApp, run, send } from "./common";

export const fileRoutes = newApp();

const Link = z.object({ url: z.string(), expiresAt: z.string() });
const SignedQuery = z.object({ exp: z.string().optional(), sig: z.string().optional() });

fileRoutes.openapi(
  createRoute({
    method: "post", path: "/files/upload-url", tags: ["files"], summary: "Create a pending file and a signed upload link",
    request: { headers: IdempotencyHeader, body: body(UploadRequest) },
    responses: {
      200: json(z.object({ file: FileRecord, uploadUrl: z.string(), expiresAt: z.string() }), "PUT the bytes to uploadUrl, then call attach"),
      400: errors[400], 403: errors[403],
    },
  }),
  async (c) => {
    const { result } = await run<Snapshot>(c, "file.upload", c.req.valid("json"));
    const link = await signFileLink(c.env.SIGNING_KEY, new URL(c.req.url).origin, "PUT", result.id as string);
    return send(c, { file: publicFile(result), uploadUrl: link.url, expiresAt: link.expiresAt });
  },
);

fileRoutes.openapi(
  createRoute({
    method: "post", path: "/files/{id}/attach", tags: ["files"], summary: "Confirm the upload landed and link it to a record",
    request: { params: PathId, headers: IdempotencyHeader, body: body(AttachRequest) },
    responses: { 200: json(FileRecord), 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const { result } = await run(c, "file.attach", { ...c.req.valid("json"), id: c.req.valid("param").id });
    return send(c, result);
  },
);

fileRoutes.openapi(
  createRoute({
    method: "get", path: "/files/{id}/download-url", tags: ["files"], summary: "Get a signed download link",
    request: { params: PathId },
    responses: { 200: json(Link), 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "files:read");
    const file = await getRecord(drizzle(c.env.DB), fileEntity, actor.studioId, c.req.valid("param").id);
    if (file.status !== "ready") throw new HttpError("version_conflict", "The upload hasn't been attached yet");
    return send(c, await signFileLink(c.env.SIGNING_KEY, new URL(c.req.url).origin, "GET", file.id as string));
  },
);

// The two routes the signed links point at. The signature is the permission:
// no session needed, so a phone can upload straight from the share sheet.

fileRoutes.openapi(
  createRoute({
    method: "put", path: "/files/{id}/content", tags: ["files"], summary: "Upload the bytes (signed link)",
    security: [],
    request: { params: PathId, query: SignedQuery },
    responses: { 204: { description: "Stored" }, 400: errors[400], 404: errors[404] },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { exp, sig } = c.req.valid("query");
    if (!(await verifyFileLink(c.env.SIGNING_KEY, "PUT", id, exp, sig))) throw notFound("File");
    const file = await c.env.DB.prepare("SELECT r2_key, size, content_type, status FROM files WHERE id = ? AND deleted_at IS NULL")
      .bind(id).first<{ r2_key: string; size: number; content_type: string | null; status: string }>();
    if (!file || file.status !== "pending") throw notFound("File");
    const declared = Number(c.req.header("Content-Length") ?? NaN);
    if (!c.req.raw.body || declared !== file.size || declared > MAX_FILE_BYTES) {
      throw new HttpError("bad_request", `Send exactly ${file.size} bytes`);
    }
    const stored = await c.env.FILES.put(file.r2_key, c.req.raw.body, {
      httpMetadata: { contentType: file.content_type ?? "application/octet-stream" },
    });
    if (stored.size !== file.size) {
      await c.env.FILES.delete(file.r2_key);
      throw new HttpError("bad_request", `Send exactly ${file.size} bytes`);
    }
    return c.body(null, 204);
  },
);

fileRoutes.openapi(
  createRoute({
    method: "get", path: "/files/{id}/content", tags: ["files"], summary: "Download the bytes (signed link)",
    security: [],
    request: { params: PathId, query: SignedQuery },
    responses: { 200: { description: "The file" }, 404: errors[404] },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { exp, sig } = c.req.valid("query");
    if (!(await verifyFileLink(c.env.SIGNING_KEY, "GET", id, exp, sig))) throw notFound("File");
    const file = await c.env.DB.prepare("SELECT r2_key, name, content_type FROM files WHERE id = ? AND status = 'ready' AND deleted_at IS NULL")
      .bind(id).first<{ r2_key: string; name: string; content_type: string | null }>();
    const obj = file && (await c.env.FILES.get(file.r2_key));
    if (!file || !obj) throw notFound("File");
    return new Response(obj.body, {
      headers: {
        "content-type": file.content_type ?? "application/octet-stream",
        "content-disposition": `inline; filename="${file.name.replace(/[^\x20-\x7e]|"/g, "_")}"`,
        "cache-control": "private, max-age=600",
      },
    });
  },
);
