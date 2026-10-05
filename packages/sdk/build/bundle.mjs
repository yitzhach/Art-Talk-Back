// Shared by bundle:classic and bundle:esm: one build of src/browser.ts, written
// to --out, or with --check compared with what is already there. Apps live in
// their own repos (D-042) and check the output in as a vendored file; their CI
// and ours run --check so a stale copy fails (D-064).
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function bundle({ name, defaultOut, options, banner }) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--out");
  const out = resolve(process.env.INIT_CWD || process.cwd(), at >= 0 ? args[at + 1] : defaultOut);
  const entry = fileURLToPath(new URL("../src/browser.ts", import.meta.url));

  const result = await build({
    entryPoints: [entry],
    absWorkingDir: fileURLToPath(new URL("../../..", import.meta.url)), // stable path comments
    bundle: true,
    target: "es2020",
    platform: "browser",
    legalComments: "inline",
    write: false,
    banner: { js: banner },
    ...options,
  });
  const code = result.outputFiles[0].text;

  if (args.includes("--check")) {
    let current = null;
    try { current = readFileSync(out, "utf8"); } catch {}
    if (current !== code) {
      console.error(`${out} is out of date: rebuild it with ${name}`);
      process.exit(1);
    }
    console.log(`${out} is up to date`);
  } else {
    writeFileSync(out, code);
    console.log(`wrote ${out} (${code.length} bytes)`);
  }
}
