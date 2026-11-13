// The visitor assistant (Site 3.0 stage 3, card B): a real studio-api in-process, a scripted model, no key, no network.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "../../../packages/sdk/test/server";
import { makeHandler } from "../src/index";
import { checkReply, readMarkers } from "../src/visitor";
import { type DigestWork, colourName, digestLine } from "../src/visitor-prompt";
import { assistantEnv, message, scripted, startStudio, text, toolUse } from "./harness";
import { type Fixture, seedStudio, visitorRequest } from "./visitor-fixture";

let server: Server;
let fx: Fixture;

beforeAll(async () => {
  server = await startStudio();
  fx = await seedStudio(server);
});
afterAll(async () => { await server?.dispose(); });

const ask = async (steps: Parameters<typeof scripted>[0], body: Record<string, unknown>, key?: string) => {
  const m = scripted(steps);
  const handler = makeHandler(() => m.model);
  const res = await handler.fetch(visitorRequest(fx.slug, body, key), assistantEnv(server), { waitUntil: () => {} } as unknown as ExecutionContext);
  return { status: res.status, data: (await res.json()) as any, requests: m.requests };
};
const rows = async (sql: string, ...args: unknown[]) => (await server.DB.prepare(sql).bind(...args).all<Record<string, unknown>>()).results;

describe("a visitor's question", () => {
  it("answers from the catalogue: cards only for real works, recorded with its cost", async () => {
    const r = await ask([() => message([text("Tidewater Blue is the big blue one, $6,800.\n[[works: tidewater-blue | made-up-piece | heron-at-dusk]]\n[[replies: Show me smaller | Anything in gold?]]")])],
      { message: "something blue for a big wall" }, "a".repeat(32));
    expect(r.status).toBe(200);
    expect(r.data.limited).toBeNull();
    expect(r.data.text).toBe("Tidewater Blue is the big blue one, $6,800.");
    expect(r.data.works.map((w: DigestWork) => w.slug)).toEqual(["tidewater-blue", "heron-at-dusk"]);
    expect(r.data.works[0]).toMatchObject({ title: "Tidewater Blue", width: 48, height: 60, priceCents: 680000, status: "available" });
    expect(r.data.works[0].image).toMatch(/^\/v1\/public\/studios\/.+\/images\/[0-9A-Z]{26}\/480\.webp$/);
    expect(r.data.replies).toEqual(["Show me smaller", "Anything in gold?"]);
    expect(r.data.askArtist).toBe(false);
    const msgs = await rows("SELECT role, text, works, meta FROM visitor_messages WHERE thread_id = ? ORDER BY created_at", r.data.threadId);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(JSON.parse(String(msgs[1]!.works))).toEqual(["tidewater-blue", "heron-at-dusk"]);
    // The made-up slug was caught.
    expect(JSON.parse(String(msgs[1]!.meta)).fixed).toBe(1);
    expect((await rows("SELECT turns FROM assistant_usage WHERE studio_id = ?", fx.studioId))[0]!.turns).toBeGreaterThanOrEqual(1);
  });

  it("sends the model the rules, the studio's words and the public catalogue only, on Haiku 5.5 with one read tool", async () => {
    const r = await ask([() => message([text("Hello.")])], { message: "hi", piece: "heron-at-dusk" }, "b".repeat(32));
    const req = r.requests[0]!;
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.output_config).toEqual({ effort: "low" });
    expect(req.tools!.map((t: any) => t.name)).toEqual(["get_work"]);
    expect(req.cache_control).toEqual({ type: "ephemeral" });
    const system = (req.system as { text: string }[]).map((b) => b.text).join("\n");
    expect(system).toContain("Never use the word \"affordable\"");
    expect(system).toContain("The artist is called: Isaac");
    expect(system).toContain("Most commissions run $2,000–$15,000");
    expect(system).toContain("heron-at-dusk | Heron at Dusk | oil and plaster on panel | 2025 | 36 × 24 in | $2,400");
    expect(system).toContain("quiet-harbour | Quiet Harbour");
    expect(system).toMatch(/quiet-harbour[^\n]*sold \(no price/);
    expect(system).not.toContain("$1,200");
    expect(system).not.toContain("Secret Draft");
    const user = JSON.stringify(req.messages.at(-1));
    expect(user).toContain("the visitor is looking at: heron-at-dusk");
  });

  it("keeps the conversation: the second turn sees the first, cards named", async () => {
    const key = "c".repeat(32);
    await ask([() => message([text("Here's one in gold.\n[[works: small-study-gold]]")])], { message: "anything in gold?" }, key);
    const r = await ask([() => message([text("It's 10 × 10 in.")])], { message: "how big is it?" }, key);
    const msgs = r.requests[0]!.messages;
    expect(msgs.map((m: any) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(msgs[0]!.content).toBe("anything in gold?");
    expect(msgs[1]!.content).toContain("[[works: small-study-gold]]");
    // New chat starts empty.
    const fresh = await ask([() => message([text("Hi.")])], { message: "hello", fresh: true }, key);
    expect(fresh.requests[0]!.messages).toHaveLength(1);
  });

  it("reads a piece's full record with get_work, public fields only", async () => {
    const r = await ask([
      () => message([toolUse("get_work", { slug: "standing-form-3" })]),
      (req) => {
        const results = (req.messages.at(-1)!.content as any[]);
        const got = JSON.parse(results[0].content);
        expect(got).toMatchObject({ slug: "standing-form-3", size: "40 × 14 × 12 in", price: "$4,500", medium: "cast plaster and steel" });
        expect(got.description).toContain("for indoors");
        expect(JSON.stringify(got)).not.toMatch(/"id"|inventory|notes/);
        return message([text("It's cast plaster on a steel base, made for indoors.\n[[works: standing-form-3]]")]);
      },
    ], { message: "can the white sculpture go outside?" }, "d".repeat(32));
    expect(r.data.works.map((w: DigestWork) => w.slug)).toEqual(["standing-form-3"]);
  });

  it("refuses a slug that isn't in the catalogue", async () => {
    const r = await ask([
      (req) => message([toolUse("get_work", { slug: "secret-draft" })]),
      (req) => {
        const res = (req.messages.at(-1)!.content as any[])[0];
        expect(res.is_error).toBe(true);
        return message([text("I can't find that one.")]);
      },
    ], { message: "tell me about the secret draft" }, "e".repeat(32));
    expect(r.status).toBe(200);
  });
});

describe("the check before a reply is shown (D-135)", () => {
  it("replaces a wrong price, a sold piece's price and an invented one; keeps listed prices and the studio's own figures", async () => {
    const r = await ask([() => message([text("Heron at Dusk is $1,800. Quiet Harbour was $1,200. Commissions run $2,000–$15,000. Tidewater Blue is $6,800. Everything is $10.")])],
      { message: "prices?" }, "f".repeat(32));
    expect(r.data.text).toBe("Heron at Dusk is price on request. Quiet Harbour was price on request. Commissions run $2,000–$15,000. Tidewater Blue is $6,800. Everything is price on request.");
    expect(r.data.askArtist).toBe(true);
  });

  it("allows an amount the visitor said", () => {
    const cat = [{ slug: "a", title: "Alpha", status: "available", priceCents: 50000 } as DigestWork];
    expect(checkReply({ text: "Under $3,000, Alpha is $500.", works: [] }, cat, "anything under $3,000?").text).toBe("Under $3,000, Alpha is $500.");
    expect(checkReply({ text: "Alpha is $3k.", works: [] }, cat, "").text).toBe("Alpha is price on request.");
  });

  it("flags a quoted title that isn't a work", () => {
    const cat = [{ slug: "a", title: "Alpha", status: "available", priceCents: null } as DigestWork];
    const c = checkReply({ text: "Try “Moonlit Bay” or “Alpha”.", works: [] }, cat, "");
    expect(c.inventedTitles).toEqual(["Moonlit Bay"]);
    expect(c.fixed).toBe(1);
  });

  it("reads the control lines", () => {
    expect(readMarkers("I'll leave that to Isaac.\n[[ask_artist]]\n[[replies: Text him | Email him]]")).toEqual({
      text: "I'll leave that to Isaac.", works: [], replies: ["Text him", "Email him"], askArtist: true,
    });
  });
});

describe("limits come from studio-api (D-130, D-136)", () => {
  it("at the budget the model isn't called and the sheet becomes search", async () => {
    const s2 = await startStudio();
    try {
      const f2 = await seedStudio(s2, { budgetCents: 0 });
      const m = scripted([]);
      const res = await makeHandler(() => m.model).fetch(visitorRequest(f2.slug, { message: "hi" }), assistantEnv(s2), {} as ExecutionContext);
      const data = (await res.json()) as any;
      expect(data.limited).toBe("budget");
      expect(data.text).toContain("Isaac");
      expect(m.requests).toHaveLength(0);
    } finally { await s2.dispose(); }
  });

  it("refuses requests without a studio or a visitor key", async () => {
    const handler = makeHandler(() => scripted([]).model);
    const bad = new Request("https://studio-assistant/assistant/visitor", { method: "POST", headers: { "content-type": "application/json", "x-studio-slug": fx.slug }, body: JSON.stringify({ message: "hi" }) });
    expect((await handler.fetch(bad, assistantEnv(server), {} as ExecutionContext)).status).toBe(400);
    const long = await handler.fetch(visitorRequest(fx.slug, { message: "x".repeat(1001) }), assistantEnv(server), {} as ExecutionContext);
    expect(long.status).toBe(400);
  });
});

describe("a failed answer (D-178)", () => {
  it("tells the visitor to try again and counts it for the studio's daily error email", async () => {
    const before = Number((await rows("SELECT COALESCE(SUM(n), 0) AS n FROM error_counts WHERE studio_id = ? AND kind = 'assistant'", fx.studioId))[0]!.n);
    const m = scripted([() => { throw new Error("model down"); }]);
    const res = await makeHandler(() => m.model).fetch(visitorRequest(fx.slug, { message: "anything blue?" }, "f".repeat(32), "198.51.100.7"),
      assistantEnv(server), { waitUntil: () => {} } as unknown as ExecutionContext);
    const data = (await res.json()) as any;
    expect(res.status, JSON.stringify(data)).toBe(502);
    expect(data.error.code).toBe("unavailable");
    const after = Number((await rows("SELECT COALESCE(SUM(n), 0) AS n FROM error_counts WHERE studio_id = ? AND kind = 'assistant'", fx.studioId))[0]!.n);
    expect(after).toBe(before + 1);
  });
});

describe("the digest line", () => {
  it("names colours in words and never shows a price that isn't listed", () => {
    expect(colourName("#2f5fb3")).toBe("blue");
    expect(colourName("#a7462a")).toBe("rust");
    const line = digestLine({ slug: "x", title: "X", medium: null, year: null, width: 10, height: 12, depth: null, sizeUnit: "in", status: "sold",
      priceCents: 9999, currency: "USD", collection: null, tags: [], palette: [{ hex: "#2f5fb3", share: 5000 }], blurb: null, image: null });
    expect(line).toContain("12 × 10 in");
    expect(line).toContain("blue");
    expect(line).not.toContain("99.99");
  });
});
