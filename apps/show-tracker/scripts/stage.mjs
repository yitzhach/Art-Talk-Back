// Assembles dist/: just the files the app needs (not tests, scripts or
// node_modules), the built SDK bundle, and a studio-config.js that points the
// app at its own origin, where /v1 is forwarded to studio-api (worker.js).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = `${root}dist/`;
if (!existsSync(`${root}studio-sdk.js`)) throw new Error("studio-sdk.js is missing: run `pnpm --filter @studio/show-tracker build` first");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
const ship = /\.(html|js|css|json|webmanifest|png)$/;
for (const f of readdirSync(root)) {
  if (!ship.test(f) || /^(worker|package|tsconfig)|\.d\.|\.config\.|^wrangler/.test(f) || f.endsWith(".tmp.mjs")) continue;
  cpSync(`${root}${f}`, `${dist}${f}`);
}
writeFileSync(`${dist}studio-config.js`, "/* Written by scripts/stage.mjs: the API is on this app's own origin. */\nwindow.StudioConfig = { apiUrl: location.origin };\n");
console.log(`staged ${readdirSync(dist).length} files in dist/`);
