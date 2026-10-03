// The eval set in replay mode (D-047): every case, against the recorded model
// replies, on a real studio-api. Live runs: `pnpm --filter @studio/assistant eval:live`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "../../../packages/sdk/test/server";
import { startServer } from "../../../packages/sdk/test/server";
import { evalOwners, loadCases, replayModel, runCase } from "../evals/runner";
import { KEY } from "./harness";

const file = loadCases();
let server: Server;
beforeAll(async () => { server = await startServer({ ASSISTANT_KEY: KEY, OWNER_EMAILS: evalOwners(file) }); });
afterAll(async () => { await server?.dispose(); });

describe("eval set, replayed", () => {
  it("has at least one case per outcome, and every case is marked with where it came from", () => {
    expect(new Set(file.cases.map((c) => c.expect.outcome))).toEqual(new Set(["card", "answer"]));
    for (const c of file.cases) expect(["placeholder", "isaac"]).toContain(c.source);
  });

  it.each(file.cases.map((c, n) => [c.id, n] as const))("%s", async (_id, n) => {
    const c = file.cases[n]!;
    const r = await runCase(server, file, c, n, (refs) => replayModel(c.replay, refs));
    expect(r.failures).toEqual([]);
  });

  it("the checks catch a wrong answer (a replay that logs the sale at the wrong show fails)", async () => {
    const c = structuredClone(file.cases[0]!);
    c.replay[1]![0]!.input = { ...(c.replay[1]![0]!.input as object), showId: "$show:Coconut Grove Arts Festival" };
    const r = await runCase(server, file, c, 0, (refs) => replayModel(c.replay, refs));
    expect(r.pass).toBe(false);
    expect(r.failures[0]).toMatch(/expected a sale_create call: showId/);
  });
});
