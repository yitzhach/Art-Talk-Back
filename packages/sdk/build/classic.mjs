// Builds @studio/sdk as one classic script that publishes window.StudioSDK, for
// apps with no build step (the Show Tracker, D-039). Apps live in their own repos
// (D-042) and check the output in as a vendored file:
//   pnpm --filter @studio/sdk bundle:classic -- --out <app>/tracker/studio-sdk.js
//   ... --check --out <file>   fails if <file> is not what this source builds to.
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const at = args.indexOf("--out");
const out = resolve(process.env.INIT_CWD || process.cwd(), at >= 0 ? args[at + 1] : "dist/studio-sdk.js");
const entry = fileURLToPath(new URL("../src/browser.ts", import.meta.url));

const result = await build({
  entryPoints: [entry],
  absWorkingDir: fileURLToPath(new URL("../../..", import.meta.url)), // stable path comments
  bundle: true,
  format: "iife",
  globalName: "StudioSDK",
  target: "es2020",
  platform: "browser",
  legalComments: "inline",
  write: false,
  banner: { js: "/* @studio/sdk for classic scripts. Generated from yitzhach/Art-Talk-Back packages/sdk (bundle:classic): do not edit. */" },
});
const code = result.outputFiles[0].text;

if (args.includes("--check")) {
  if (readFileSync(out, "utf8") !== code) {
    console.error(`${out} is out of date: rebuild it with bundle:classic`);
    process.exit(1);
  }
  console.log(`${out} is up to date`);
} else {
  writeFileSync(out, code);
  console.log(`wrote ${out} (${code.length} bytes)`);
}
