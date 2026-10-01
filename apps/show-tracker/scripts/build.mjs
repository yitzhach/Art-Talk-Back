// Bundles the Studio SDK into one classic script (studio-sdk.js, global
// `StudioSDK`) so the tracker's no-build, classic-script pages can use it.
// The tracker's own files are served as they are.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

await build({
  entryPoints: [fileURLToPath(new URL("../../../packages/sdk/src/index.ts", import.meta.url))],
  outfile: `${root}studio-sdk.js`,
  bundle: true,
  format: "iife",
  globalName: "StudioSDK",
  target: "es2020",
  minify: true,
  legalComments: "none",
});
console.log("built studio-sdk.js");
