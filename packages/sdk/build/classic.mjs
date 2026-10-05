// Builds @studio/sdk as one classic script that publishes window.StudioSDK, for
// apps with no build step (the Show Tracker, D-039). Apps live in their own repos
// (D-042) and check the output in as a vendored file:
//   pnpm --filter @studio/sdk bundle:classic -- --out <app>/tracker/studio-sdk.js
//   ... --check --out <file>   fails if <file> is not what this source builds to.
import { bundle } from "./bundle.mjs";

await bundle({
  name: "bundle:classic",
  defaultOut: "dist/studio-sdk.js",
  options: { format: "iife", globalName: "StudioSDK" },
  banner: "/* @studio/sdk for classic scripts. Generated from yitzhach/Art-Talk-Back packages/sdk (bundle:classic): do not edit. */",
});
