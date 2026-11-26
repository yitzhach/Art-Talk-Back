// Owner updates without a browser sign-in (D-183). Reads one update file from owner-updates/ and makes each
// change through the studio's own API, as the studio's owner, so every change goes through the same actions,
// checks and activity log as the Studio app. The workflow "Owner update" mints a short session for the run
// straight in D1 (only someone with the repo's Cloudflare token can) and deletes it afterwards.
//
// Usage: node scripts/owner-update/run.mjs <update.json>
// Env:   SITE_ORIGIN (e.g. https://studio-site-staging.bobdylan2000.workers.dev), STUDIO_SESSION (the session token)
//
// An update file:
// { "target": "staging", "studio": "isaac-anderson-art-sbtwkm", "steps": [ ... ] }
// Steps (a show is named by its id, its page address, or its exact name):
//   {"op": "show.create", "fields": {"name", "venue", "city", "startsOn", "endsOn", "booth"}}
//   {"op": "show.update", "show": "...", "fields": {...only the fields to change...}}
//   {"op": "show.page", "show": "...", "change": {"description"?, "slug"?, "published"?}}
//   {"op": "show.add_photo", "show": "...", "file": "owner-updates/files/x.jpg", "first"?: true, "title"?: "..."}
//   {"op": "show.photo_order", "show": "...", "first": "<title of a photo already on the page>"}
//   {"op": "show.add_work", "show": "...", "work": "<artwork id or exact title>"}
//   {"op": "show.remove_work", "show": "...", "work": "<artwork id or exact title>"}
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import sharp from "sharp";

const ORIGIN = process.env.SITE_ORIGIN?.replace(/\/+$/, "");
const TOKEN = process.env.STUDIO_SESSION;
const WIDTHS = [480, 960, 1600];

export class ApiError extends Error {
  constructor(status, code, message) {
    super(`${status} ${code}: ${message}`);
    this.status = status;
  }
}

export function makeApi(origin, token, fetchImpl = fetch) {
  async function request(method, path, body, version) {
    const headers = { accept: "application/json", cookie: `studio_session=${token}`, "user-agent": "owner-update" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (version !== undefined) headers["if-match"] = String(version);
    const res = await fetchImpl(`${origin}/v1${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined;
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
    if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? text.slice(0, 200));
    return data;
  }
  return {
    get: (p) => request("GET", p),
    post: (p, b, v) => request("POST", p, b ?? {}, v),
    patch: (p, b, v) => request("PATCH", p, b, v),
    async put(url, bytes, contentType) {
      const res = await fetchImpl(url, { method: "PUT", body: bytes, headers: { "content-type": contentType } });
      if (!res.ok) throw new ApiError(res.status, "upload", `Upload failed`);
    },
  };
}

const enc = encodeURIComponent;

async function all(api, path) {
  const out = [];
  let cursor = null;
  do {
    const page = await api.get(`${path}?limit=200${cursor ? "&cursor=" + enc(cursor) : ""}`);
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

/** A show by id, page address or exact name; exactly one must match. */
export async function findShow(api, ref) {
  const shows = await all(api, "/shows");
  const hits = shows.filter((s) => s.id === ref || s.meta?.publicPage?.slug === ref || s.name === ref);
  if (hits.length !== 1) throw new Error(`${hits.length ? "More than one show" : "No show"} matches "${ref}"`);
  return api.get(`/shows/${enc(hits[0].id)}`);
}

async function findWork(api, ref) {
  const works = await all(api, "/artworks");
  const hits = works.filter((w) => w.id === ref || w.title === ref);
  if (hits.length !== 1) throw new Error(`${hits.length ? "More than one work" : "No work"} matches "${ref}"`);
  return hits[0];
}

const pageOf = (s) => s.meta?.publicPage ?? { published: false, slug: null, description: null, photos: [] };

const TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/** The original plus WebP copies at 480/960/1600 (never upscaled), as the Studio makes them. */
export async function prepare(bytes, name) {
  const contentType = TYPES[extname(name).toLowerCase()];
  if (!contentType) throw new Error(`${name}: only JPEG, PNG or WebP`);
  const img = sharp(bytes).rotate();
  const { width, height } = await img.metadata();
  const sizes = [];
  for (const slot of WIDTHS) {
    const w = Math.min(slot, width);
    if (sizes.some((s) => s.realWidth === w)) continue;
    sizes.push({ width: slot, realWidth: w, blob: await sharp(bytes).rotate().resize({ width: w }).webp({ quality: 82 }).toBuffer() });
  }
  return { name, contentType, original: bytes, pixels: { width, height }, sizes };
}

async function addPhoto(api, show, step, readBytes) {
  const name = basename(step.file);
  const p = await prepare(await readBytes(step.file), name);
  let work = await api.post("/artworks", { title: step.title ?? `${show.name} booth`, kind: "site_photo", status: "not_for_sale" });
  const up = await api.post("/files/upload-url", {
    name, contentType: p.contentType, size: p.original.length, kind: "photo",
    sizes: p.sizes.map((s) => ({ width: s.width, size: s.blob.length })), pixels: p.pixels,
  });
  await api.put(up.uploadUrl, p.original, p.contentType);
  for (const s of p.sizes) {
    const link = up.sizeUrls.find((u) => u.width === s.width);
    if (!link) throw new Error(`No upload link for the ${s.width}px copy`);
    await api.put(link.uploadUrl, s.blob, "image/webp");
  }
  await api.post(`/files/${enc(up.file.id)}/attach`, { entityType: "artwork", entityId: work.id });
  work = await api.patch(`/artworks/${enc(work.id)}`, { primaryFileId: up.file.id }, work.version);
  await api.post(`/artworks/${enc(work.id)}/publish`, {}, work.version);
  const page = pageOf(show);
  const photos = step.first ? [work.id, ...page.photos] : [...page.photos, work.id];
  await api.post("/actions/show.set_page", { showId: show.id, version: show.version, photos });
  return `added photo ${name}${step.first ? " (first)" : ""}`;
}

export async function runStep(api, step, readBytes) {
  switch (step.op) {
    case "show.create": {
      const s = await api.post("/shows", { ...step.fields, status: "accepted" });
      return `created show ${s.name} (${s.id})`;
    }
    case "show.update": {
      const s = await findShow(api, step.show);
      await api.patch(`/shows/${enc(s.id)}`, step.fields, s.version);
      return `updated ${Object.keys(step.fields).join(", ")} on ${s.name}`;
    }
    case "show.page": {
      const s = await findShow(api, step.show);
      await api.post("/actions/show.set_page", { showId: s.id, version: s.version, ...step.change });
      return `page change on ${s.name}: ${Object.keys(step.change).join(", ")}`;
    }
    case "show.add_photo":
      return addPhoto(api, await findShow(api, step.show), step, readBytes);
    case "show.photo_order": {
      const s = await findShow(api, step.show);
      const photos = pageOf(s).photos;
      const works = await all(api, "/artworks");
      const id = works.find((w) => photos.includes(w.id) && w.title === step.first)?.id;
      if (!id) throw new Error(`No photo titled "${step.first}" on ${s.name}`);
      await api.post("/actions/show.set_page", { showId: s.id, version: s.version, photos: [id, ...photos.filter((x) => x !== id)] });
      return `"${step.first}" is now the first photo on ${s.name}`;
    }
    case "show.add_work": {
      const [s, w] = [await findShow(api, step.show), await findWork(api, step.work)];
      await api.post("/actions/show.add_artwork", { showId: s.id, artworkId: w.id });
      return `added ${w.title} to ${s.name}`;
    }
    case "show.remove_work": {
      const [s, w] = [await findShow(api, step.show), await findWork(api, step.work)];
      await api.post("/actions/show.remove_artwork", { showId: s.id, artworkId: w.id });
      return `took ${w.title} off ${s.name}`;
    }
    default:
      throw new Error(`Unknown step "${step.op}"`);
  }
}

export function checkUpdate(u, target) {
  if (!u || typeof u !== "object" || !Array.isArray(u.steps) || !u.steps.length) throw new Error("The update needs steps");
  if (u.target !== target) throw new Error(`The update is for "${u.target}", this run is for "${target}"`);
  if (!/^[a-z0-9-]+$/.test(u.studio ?? "")) throw new Error("The update needs the studio's slug");
}

async function main() {
  const file = process.argv[2];
  if (!ORIGIN || !TOKEN || !file) throw new Error("Needs SITE_ORIGIN, STUDIO_SESSION and an update file");
  const update = JSON.parse(await readFile(file, "utf8"));
  checkUpdate(update, process.env.TARGET);
  const api = makeApi(ORIGIN, TOKEN);
  for (const [i, step] of update.steps.entries()) {
    const done = await runStep(api, step, (p) => readFile(p));
    console.log(`${i + 1}. ${done}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
