// The eval set against the real model (D-047). Needs ANTHROPIC_API_KEY, and
// AI_GATEWAY_URL to go through the gateway. Spends real money: about one short
// turn per case.
//   pnpm --filter @studio/assistant eval:live              report only
//   pnpm --filter @studio/assistant eval:live -- --record  also rewrite each case's replay
import { writeFileSync } from "node:fs";
import { startServer } from "../../../packages/sdk/test/server";
import { anthropicModel } from "../src/model";
import { KEY } from "../test/harness";
import { evalOwners, loadCases, runCase } from "./runner";

const file = loadCases();
const record = process.argv.includes("--record");
const server = await startServer({ ASSISTANT_KEY: KEY, OWNER_EMAILS: evalOwners(file) });
const model = anthropicModel({
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, AI_GATEWAY_URL: process.env.AI_GATEWAY_URL ?? "",
  AI_GATEWAY_TOKEN: process.env.AI_GATEWAY_TOKEN,
} as never);
let passed = 0;
try {
  for (const [n, c] of file.cases.entries()) {
    const r = await runCase(server, file, c, n, () => model);
    if (r.pass) passed++;
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${c.id}${r.failures.length ? `\n      ${r.failures.join("\n      ")}` : ""}`);
    console.log(`      calls: ${r.calls.map((x) => x.tool).join(" → ") || "none"}`);
    if (record) c.replay = r.replies;
  }
} finally {
  await server.dispose();
}
if (record) writeFileSync(new URL("./cases.json", import.meta.url), `${JSON.stringify(file, null, 2)}\n`);
console.log(`\n${passed}/${file.cases.length} cases passed`);
process.exit(passed === file.cases.length ? 0 : 1);
