// The visitor assistant's eval set in replay mode (Site 3.0 stage 3, gate items 1 and 2): every case with a recorded
// replay runs against it and must pass; cases without one are listed as not recorded. Live runs and recording:
// `pnpm --filter @studio/assistant eval:visitor [-- --record]`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "../../../packages/sdk/test/server";
import { isSlot, loadVisitorCases, runVisitorCase, visitorReplayModel, type VisitorCase } from "../evals/visitor-runner";
import { startStudio } from "./harness";
import { type Fixture, seedStudio } from "./visitor-fixture";

const file = loadVisitorCases();
let server: Server;
let fx: Fixture;
beforeAll(async () => { server = await startStudio(); fx = await seedStudio(server); });
afterAll(async () => { await server?.dispose(); });

const synthetic = (id: string, question: string, expectation: VisitorCase["expect"], text: string): VisitorCase => ({
  id, source: "coverage", topic: "self-test", question, expect: expectation, replay: [[{ type: "text", text }]],
});
const run = (c: VisitorCase) => runVisitorCase(server, fx, c, visitorReplayModel(c.replay!));

describe("visitor eval set, replayed", () => {
  it("is well formed: unique ids, at least 32 coverage cases, the 22 slots for Isaac", () => {
    expect(new Set(file.cases.map((c) => c.id)).size).toBe(file.cases.length);
    expect(file.cases.filter((c) => c.source === "coverage").length).toBeGreaterThanOrEqual(32);
    expect(file.cases.filter((c) => c.source === "isaac-slot").map((c) => c.topic)).toHaveLength(22);
    for (const c of file.cases.filter((c) => !isSlot(c))) expect(c.question.length).toBeLessThanOrEqual(1000);
  });

  for (const c of file.cases) {
    if (isSlot(c)) it.skip(`${c.id} (slot for Isaac's question)`, () => {});
    else if (!c.replay) it.skip(`${c.id} (not recorded)`, () => {});
    else it(c.id, async () => { expect((await run(c)).failures).toEqual([]); });
  }
});

describe("the graders bite", () => {
  it("a good recorded answer passes", async () => {
    const r = await run(synthetic("good", "How much is Heron at Dusk?", { cards: { include: ["heron-at-dusk"] }, textIncludes: ["$2,400"] },
      "Heron at Dusk is $2,400.\n[[works: heron-at-dusk]]"));
    expect(r.failures).toEqual([]);
    expect(r.cards).toEqual(["heron-at-dusk"]);
  });

  it("a wrong price and a card outside the catalogue fail (a) and (b), reading the raw text", async () => {
    const r = await run(synthetic("bad-price", "How much is Heron at Dusk?", {}, "Heron at Dusk is $1,900 [[works: heron-at-dusk | moonlit-bay]]"));
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.startsWith("(a)") && f.includes("moonlit-bay"))).toBe(true);
    expect(r.failures.some((f) => f.startsWith("(b)"))).toBe(true);
    // The visitor never saw them (the reply check cleaned it), which is why the grader reads the raw output.
    expect(r.finalText).not.toContain("1,900");
    expect(r.cards).toEqual(["heron-at-dusk"]);
  });

  it("an invented quoted title fails (c)", async () => {
    const r = await run(synthetic("bad-title", "Anything like a harbour?", {}, "Try “Moonlit Bay” by Isaac."));
    expect(r.failures.some((f) => f.startsWith("(c)"))).toBe(true);
  });

  it("ignoring a needed handoff fails (d)", async () => {
    const r = await run(synthetic("no-handoff", "What's your return policy?", { askArtist: true }, "You can return anything within 30 days."));
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.startsWith("(d)"))).toBe(true);
  });

  it('the word "affordable" fails (e)', async () => {
    const r = await run(synthetic("affordable", "Anything cheap?", {}, "Small Study in Gold is an affordable choice.\n[[works: small-study-gold]]"));
    expect(r.failures.some((f) => f.startsWith("(e)"))).toBe(true);
  });

  it("the case's own expectations fail (f)", async () => {
    const r = await run(synthetic("expect", "How big is Tidewater Blue?", { textIncludes: ["48"], textExcludes: ["huge"], cards: { none: true } },
      "It's huge.\n[[works: tidewater-blue]]"));
    expect(r.failures.filter((f) => f.startsWith("(f)")).length).toBe(3);
  });

  it("a case with a seeded history sends the model the chat so far", async () => {
    const c: VisitorCase = { ...synthetic("history", "how big is the second one?", { textIncludes: ["24"] }, "Heron at Dusk is 24 × 36 in."),
      history: [{ role: "user", text: "Something blue?" }, { role: "assistant", text: "Two ideas.\n[[works: tidewater-blue | heron-at-dusk]]" }] };
    const r = await run(c);
    expect(r.failures).toEqual([]);
  });
});
