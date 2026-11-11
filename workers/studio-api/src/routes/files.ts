import { AttachRequest, FilePatch, FileRecord, FileReorder, ImageWidth, MAX_FILE_BYTES, UploadRequest } from "@studio/core";
import { createRoute } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { fileEntity, getRecord } from "../actions/records";
import { type Snapshot } from "../actions/runner";
import { fileSizes, publicFile, sizeKey } from "../actions/files";
import { requirePermission } from "../auth/permissions";
import { requireActor } from "../auth/session";
import { HttpError, notFound } from "../lib/errors";
import { signFileLink, verifyFileLink } from "../lib/signing";
import { sniffImage, stripMetadata } from "../lib/strip";
import { IdempotencyHeader, IfMatchHeader, PathId, body, errors, ifMatch, json, newApp, run, send } from "./common";

export const fileRoutes = newApp();

/**
 * Types a browser may show in place: pictures, sound, video, PDFs and plain text.
 * Anything else (HTML, SVG, XML, scripts) downloads instead, because it could run
 * script on the app's origin (D-051).
 */
const INLINE_SAFE = /^(image\/(jpeg|png|gif|webp|avif|heic|heif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf|text\/plain)(;|$)/;

const Link = z.object({ url: z.string(), expiresAt: z.string() });
const SignedQuery = z.object({
  exp: z.string().optional(), sig: z.string().optional(),
  w: z.string().optional().meta({ description: "One of the picture's WebP copies (480, 960 or 1600), D-106" }),
});
const FileOut = FileRecord.meta({ id: "FileRecord" });

/** The width a signed link names, or null for the original; undefined if it isn't a width at all. */
function widthOf(w: string | undefined): number | null | undefined {
  if (w === undefined) return null;
  const n = Number(w);
  return ImageWidth.safeParse(n).success ? n : undefined;
}

fileRoutes.openapi(
  createRoute({
    method: "post", path: "/files/upload-url", tags: ["files"], summary: "Create a pending file and a signed upload link",
    request: { headers: IdempotencyHeader, body: body(UploadRequest) },
    responses: {
      200: json(z.object({
        file: FileOut, uploadUrl: z.string(), expiresAt: z.string(),
        sizeUrls: z.array(z.object({ width: ImageWidth, uploadUrl: z.string() })).meta({ description: "One link per requested size; empty without sizes" }),
      }), "PUT the bytes to uploadUrl (and each size to its link), then call attach"),
      400: errors[400], 403: errors[403],
    },
  }),
  async (c) => {
    const { result } = await run<Snapshot>(c, "file.upload", c.req.valid("json"));
    const origin = new URL(c.req.url).origin;
    const link = await signFileLink(c.env.SIGNING_KEY, origin, "PUT", result.id as string);
    const sizeUrls = await Promise.all(fileSizes(result).map(async (s) => ({
      width: s.width, uploadUrl: (await signFileLink(c.env.SIGNING_KEY, origin, "PUT", result.id as string, Date.now(), s.width)).url,
    })));
    return send(c, { file: publicFile(result), uploadUrl: link.url, expiresAt: link.expiresAt, sizeUrls });
  },
);

fileRoutes.openapi(
  createRoute({
    method: "patch", path: "/files/{id}", tags: ["files"], summary: "Change a file's alt text, place or lock",
    request: { params: PathId, headers: IfMatchHeader.extend(IdempotencyHeader.shape), body: body(FilePatch) },
    responses: { 200: json(FileOut), 400: errors[400], 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const { result } = await run<Snapshot>(c, "file.update", { id: c.req.valid("param").id, version: ifMatch(c), patch: c.req.valid("json") });
    return send(c, publicFile(result));
  },
);

fileRoutes.openapi(
  createRoute({
    method: "post", path: "/files/reorder", tags: ["files"], summary: "Put a work's pictures in order; the first is its cover",
    request: { headers: IdempotencyHeader, body: body(FileReorder) },
    responses: { 200: json(z.object({ records: z.array(z.record(z.string(), z.unknown())) })), 400: errors[400], 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const { result } = await run<{ records: Snapshot[] }>(c, "file.reorder", c.req.valid("json"));
    return send(c, { records: result.records.map((r) => ("r2Key" in r ? publicFile(r) : r)) });
  },
);

fileRoutes.openapi(
  createRoute({
    method: "post", path: "/files/{id}/attach", tags: ["files"], summary: "Confirm the upload landed and link it to a record",
    request: { params: PathId, headers: IdempotencyHeader, body: body(AttachRequest) },
    responses: { 200: json(FileOut), 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const { result } = await run(c, "file.attach", { ...c.req.valid("json"), id: c.req.valid("param").id });
    return send(c, result);
  },
);

fileRoutes.openapi(
  createRoute({
    method: "get", path: "/files/{id}/download-url", tags: ["files"], summary: "Get a signed download link",
    request: { params: PathId, query: z.object({ width: z.coerce.number().pipe(ImageWidth).optional().meta({ description: "A WebP copy instead of the original (D-106)" }) }) },
    responses: { 200: json(Link), 404: errors[404], 409: errors[409] },
  }),
  async (c) => {
    const actor = requireActor(c);
    requirePermission(actor.role, "files:read");
    const file = await getRecord(drizzle(c.env.DB), fileEntity, actor.studioId, c.req.valid("param").id);
    if (file.status !== "ready") throw new HttpError("version_conflict", "The upload hasn't been attached yet");
    const { width } = c.req.valid("query");
    if (width && !fileSizes(file).some((s) => s.width === width)) throw notFound("Size");
    return send(c, await signFileLink(c.env.SIGNING_KEY, new URL(c.req.url).origin, "GET", file.id as string, Date.now(), width));
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
    const { exp, sig, w } = c.req.valid("query");
    const width = widthOf(w);
    if (width === undefined || !(await verifyFileLink(c.env.SIGNING_KEY, "PUT", id, exp, sig, Date.now(), width ?? undefined))) throw notFound("File");
    const file = await c.env.DB.prepare("SELECT r2_key, size, content_type, status, meta FROM files WHERE id = ? AND deleted_at IS NULL")
      .bind(id).first<{ r2_key: string; size: number; content_type: string | null; status: string; meta: string }>();
    if (!file || file.status !== "pending") throw notFound("File");
    if (width) {
      // A WebP copy (D-106): exactly the declared bytes, and really WebP, since public pages serve it.
      const declared = fileSizes({ meta: JSON.parse(file.meta) }).find((s) => s.width === width);
      if (!declared) throw notFound("Size");
      if (Number(c.req.header("Content-Length") ?? NaN) !== declared.size) throw new HttpError("bad_request", `Send exactly ${declared.size} bytes`);
      const bytes = new Uint8Array(await c.req.raw.arrayBuffer());
      if (bytes.length !== declared.size) throw new HttpError("bad_request", `Send exactly ${declared.size} bytes`);
      if (sniffImage(bytes) !== "image/webp") throw new HttpError("bad_request", "A size must be a WebP picture");
      // Public pages serve sizes as stored, so hidden metadata goes now (D-094).
      await c.env.FILES.put(sizeKey(file.r2_key, width), stripMetadata(bytes, "image/webp"), { httpMetadata: { contentType: "image/webp" } });
      return c.body(null, 204);
    }
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
    const { exp, sig, w } = c.req.valid("query");
    const width = widthOf(w);
    if (width === undefined || !(await verifyFileLink(c.env.SIGNING_KEY, "GET", id, exp, sig, Date.now(), width ?? undefined))) throw notFound("File");
    const file = await c.env.DB.prepare("SELECT r2_key, name, content_type FROM files WHERE id = ? AND status = 'ready' AND deleted_at IS NULL")
      .bind(id).first<{ r2_key: string; name: string; content_type: string | null }>();
    const obj = file && (await c.env.FILES.get(width ? sizeKey(file.r2_key, width) : file.r2_key));
    if (!file || !obj) throw notFound("File");
    const type = (width ? "image/webp" : file.content_type ?? "application/octet-stream").toLowerCase();
    const inline = INLINE_SAFE.test(type);
    return new Response(obj.body, {
      headers: {
        "content-type": type,
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${file.name.replace(/[^\x20-\x7e]|"/g, "_")}"`,
        "cache-control": "private, max-age=600",
        // Files are served from the apps' own origin (D-039): nothing in one may run as the page (D-051).
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  },
);
