// Serves the tracker and forwards /v1/* to a studio-api, on ONE origin, the
// way the deployed app will (so the session cookie and no CORS just work).
//   node scripts/dev-server.mjs [port] [apiUrl]      (SOLO=1 to leave studio sync switched off)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml",
};

/** Starts the server; resolves with `{ close, port }`. `solo` leaves studio sync switched off. */
export function startDevServer({ port, api, solo = false }) {
  api = api.replace(/\/$/, "");
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname.startsWith("/v1/")) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const headers = { ...req.headers }; delete headers.host;
        const up = await fetch(api + url.pathname + url.search, {
          method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: "manual",
        });
        const out = {};
        up.headers.forEach((v, k) => { if (k !== "content-encoding" && k !== "content-length" && k !== "transfer-encoding") out[k] = v; });
        const setCookie = up.headers.getSetCookie();
        if (setCookie.length) out["set-cookie"] = setCookie;
        res.writeHead(up.status, out);
        res.end(Buffer.from(await up.arrayBuffer()));
        return;
      }
      if (url.pathname === "/studio-config.js" && !solo) {
        // Same origin as this server: that's where /v1 is proxied.
        res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-cache" });
        res.end("window.StudioConfig = { apiUrl: location.origin };");
        return;
      }
      let file = normalize(join(root, url.pathname === "/" ? "index.html" : url.pathname));
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve({ port, close: () => new Promise((done) => server.close(() => done())) }));
  });
}

// CLI: node scripts/dev-server.mjs [port] [apiUrl]   (SOLO=1 leaves studio sync off)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 8765);
  const api = process.argv[3] ?? process.env.API_URL ?? "http://localhost:8787";
  await startDevServer({ port, api, solo: !!process.env.SOLO });
  console.log(`show-tracker on http://localhost:${port} -> ${api}`);
}
