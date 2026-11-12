// The visitor assistant's eval set against the real model (Site 3.0 stage 3, gate items 1 and 2). Needs
// ANTHROPIC_API_KEY, and AI_GATEWAY_URL/AI_GATEWAY_TOKEN to go through the gateway. Spends real money: one short turn
// per case. Prints what a chat costs.
//   pnpm --filter @studio/assistant eval:visitor              report only
//   pnpm --filter @studio/assistant eval:visitor -- --record  also write evals/visitor-cases.recorded.json
import { writeFileSync } from "node:fs";
import { startServer } from "../../../packages/sdk/test/server";
import { costMillicents } from "../../studio-api/src/routes/visitors";
import { anthropicModel } from "../src/model";
import { KEY } from "../test/harness";
import { seedStudio } from "../test/visitor-fixture";
import { isSlot, loadVisitorCases, runVisitorCase } from "./visitor-runner";

const file = loadVisitorCases();
const record = process.argv.includes("--record");
const modelId = process.env.VISITOR_MODEL || "claude-haiku-5-5";
const dollars = (millicents: number) => `$${(millicents / 100_000).toFixed(4)}`;

const server = await startServer({ ASSISTANT_KEY: KEY });
const model = anthropicModel({
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, AI_GATEWAY_URL: process.env.AI_GATEWAY_URL ?? "",
  AI_GATEWAY_TOKEN: process.env.AI_GATEWAY_TOKEN,
} as never);
const settings = { model: modelId, output_config: { effort: "low" as const } };
const costs: number[] = [];
let passed = 0, ran = 0, skipped = 0;
let dbCost = 0, dbTurns = 0;
try {
  // A budget the eval can't reach, so the cap never stops a case.
  const fx = await seedStudio(server, { budgetCents: 1_000_000 });
  for (const c of file.cases) {
    if (isSlot(c)) { skipped++; console.log(`SKIP  ${c.id} (slot for Isaac's question)`); continue; }
    ran++;
    const r = await runVisitorCase(server, fx, c, model, settings);
    if (r.pass) passed++;
    const cost = costMillicents(modelId, r.usage);
    costs.push(cost);
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${c.id}${r.failures.length ? `\n      ${r.failures.join("\n      ")}` : ""}`);
    console.log(`      raw: ${r.rawText.replace(/\s+/g, " ").slice(0, 300)}`);
    console.log(`      final: ${r.finalText.replace(/\s+/g, " ").slice(0, 300)}`);
    console.log(`      cards: ${r.cards.join(", ") || "none"}${r.askArtist ? "  (asks the artist)" : ""}  tokens in/out/cacheR/cacheW: ${r.usage.inputTokens}/${r.usage.outputTokens}/${r.usage.cacheReadTokens}/${r.usage.cacheWriteTokens}  ${dollars(cost)}`);
    if (record) c.replay = r.replay;
  }
  const usage = await server.DB.prepare("SELECT SUM(turns) AS turns, SUM(cost_millicents) AS cost FROM assistant_usage WHERE studio_id = ?")
    .bind(fx.studioId).first<{ turns: number | null; cost: number | null }>();
  dbTurns = Number(usage?.turns ?? 0);
  dbCost = Number(usage?.cost ?? 0);
} finally {
  await server.dispose();
}
if (record) {
  writeFileSync(new URL("./visitor-cases.recorded.json", import.meta.url), `${JSON.stringify(file, null, 2)}\n`);
  console.log("\nrecorded replays written to evals/visitor-cases.recorded.json (copy it over visitor-cases.json to use it)");
}
const total = costs.reduce((a, b) => a + b, 0);
const mean = costs.length ? total / costs.length : 0;
console.log(`\ncost (model ${modelId}), from the studio's assistant_usage: ${dollars(dbCost)} over ${dbTurns} turns`);
console.log(`cost per chat (one turn), from each case's tokens: mean ${dollars(mean)}, max ${dollars(Math.max(0, ...costs))}, total ${dollars(total)}`);
console.log(`projected chats per $10: ${mean > 0 ? Math.floor(1_000_000 / mean) : "n/a"}`);
console.log(`\n${passed}/${ran} cases passed, ${skipped} skipped (slots for Isaac)`);
process.exit(passed === ran ? 0 : 1);
