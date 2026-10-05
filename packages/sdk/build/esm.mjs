// Builds @studio/sdk as one ES module, for apps with a bundler (Booth Studio,
// Vite, D-066). Same source and exports as bundle:classic; apps import it:
//   pnpm --filter @studio/sdk bundle:esm -- --out <app>/src/vendor/studio-sdk.js
//   ... --check --out <file>   fails if <file> is not what this source builds to.
import { bundle } from "./bundle.mjs";

await bundle({
  name: "bundle:esm",
  defaultOut: "dist/studio-sdk.mjs",
  options: { format: "esm" },
  banner: "/* @studio/sdk as an ES module. Generated from yitzhach/Art-Talk-Back packages/sdk (bundle:esm): do not edit. */",
});
