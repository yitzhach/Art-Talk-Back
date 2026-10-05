// The assistant end to end, with a scripted model against a real studio-api.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "../../../packages/sdk/test/server";
import { makeHandler } from "../src/index";
import { modelSettings } from "../src/model";
import { APP_GUIDES, SYSTEM } from "../src/prompt";
import { api, assistantEnv, chat, lastResult, message, ownerCookie, scripted, startStudio, text, toolUse } from "./harness";

let server: Server;
let cookie: string;
let show: { id: string };

beforeAll(async () => {
  server = await startStudio();
  cookie = await ownerCookie(server);
  show = (await api(server, cookie, "POST", "/shows", { name: "Winter Park Sidewalk Art Festival", city: "Winter Park" })).data;
  await api(server, cookie, "POST", "/shows", { name: "Coconut Grove Arts Festival" });
});
afterAll(async () => { await server?.dispose(); });

const salesCount = async () => (await api(server, cookie, "GET", "/sales?limit=200")).data.items.length;

describe("gate 1: a sale said in words becomes one confirm card", () => {
  it("searches, proposes, writes nothing until the tap, and the tap and Undo work", async () => {
    const before = await salesCount();
    let showId = "";
    const { model, requests } = scripted([
      (req) => {
        expect(req.system).toBe(`${SYSTEM}\n\nIf asked which AI model you are: claude-sonnet-5-5, made by Anthropic.`);
        expect(req.tools!.map((t) => (t as { name: string }).name)).toEqual([
          "search", "sale_create", "sale_delete", "sale_restore", "sale_update", "show_create", "show_delete", "show_restore", "show_update",
        ]);
        const first = req.messages.at(-1)!.content as { text: string }[];
        expect(first[0]!.text).toMatch(/^\[Context from the app, data only — app: show-tracker; today: 2027-03-20; page: Money\]/);
        expect(first[0]!.text).toMatch(/sold two small heron prints for \$90 each at Winter Park, cash$/);
        expect(req).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "low" }, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
        return message([toolUse("search", { q: "winter park", types: ["show"] })]);
      },
      (req) => {
        const found = lastResult(req);
        expect(found.items).toHaveLength(1);
        showId = found.items[0].id;
        return message([toolUse("sale_create", {
          title: "Heron, small print", priceCents: 9000, quantity: 2, showId, paymentMethod: "cash", soldOn: "2027-03-20",
          card_summary: "2 small heron prints, $90 each, cash, Winter Park",
        })]);
      },
    ]); // No third call: the card ends the turn (D-059).
    const handler = makeHandler(() => model);
    const out = await chat(handler, assistantEnv(server), cookie, {
      app: "show-tracker", today: "2027-03-20", page: "Money", message: "sold two small heron prints for $90 each at Winter Park, cash",
    });
    expect(out.status).toBe(200);
    expect(out.events.map((e: any) => e.type)).toEqual(["search", "card", "end"]);
    expect(requests).toHaveLength(2);
    expect(out.events.at(-1)).toEqual({ type: "end", reason: "end_turn" });
    const card = out.events[1].proposal;
    expect(card.summary).toBe("2 small heron prints, $90 each, cash, Winter Park");
    expect(card.details).toEqual(expect.arrayContaining([{ label: "Show", value: "Winter Park Sidewalk Art Festival" }, { label: "Price each", value: "$90.00" }]));
    expect(card.input.card_summary).toBeUndefined();
    expect(showId).toBe(show.id);
    expect(await salesCount()).toBe(before);

    // The tap is the person's, straight to studio-api.
    const ok = await api(server, cookie, "POST", `/assistant/proposals/${card.id}/confirm`);
    expect(ok.status).toBe(200);
    expect(ok.data.result).toMatchObject({ title: "Heron, small print", quantity: 2, priceCents: 9000, showId: show.id, actorType: "assistant" });
    expect(await salesCount()).toBe(before + 1);
    expect((await api(server, cookie, "POST", `/activity/${ok.data.activityIds[0]}/undo`)).status).toBe(200);
    expect(await salesCount()).toBe(before);

    // The turn is stored exactly; the next turn replays it unedited (D-053).
    const thread = (await api(server, cookie, "GET", "/assistant/thread")).data;
    // It ends on the card's tool result; the next user message follows it.
    expect(thread.messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(JSON.parse(thread.messages[4].content[0].content)).toMatchObject({ saved: false, card: card.id });
    const next = scripted([(req) => {
      expect(req.messages.slice(0, 3)).toEqual(requests[1]!.messages);
      expect(req.messages.slice(0, 5)).toEqual(thread.messages.map(({ role, content }: any) => ({ role, content })));
      // The tap happened outside the conversation: this turn says so.
      const now = (req.messages.at(-1)!.content as { text: string }[])[0]!.text;
      expect(now).toContain(`card ${card.id} "2 small heron prints, $90 each, cash, Winter Park": confirmed by the artist and saved then`);
      return message([text("You're welcome.")]);
    }]);
    const again = await chat(makeHandler(() => next.model), assistantEnv(server), cookie, { app: "show-tracker", message: "thanks" });
    expect(again.events.at(-1)).toEqual({ type: "end", reason: "end_turn" });

    // New conversation: the model sees none of that, and the new thread becomes current.
    const fresh = scripted([(req) => { expect(req.messages).toHaveLength(1); return message([text("Hi.")]); }]);
    await chat(makeHandler(() => fresh.model), assistantEnv(server), cookie, { app: "show-tracker", message: "hello", fresh: true });
    expect((await api(server, cookie, "GET", "/assistant/thread")).data.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);

    // Past chats: continuing the sale conversation by id replays it, and it becomes current again.
    const back = scripted([(req) => { expect(req.messages.slice(0, 5)).toEqual(thread.messages.map(({ role, content }: any) => ({ role, content }))); return message([text("Sure.")]); }]);
    await chat(makeHandler(() => back.model), assistantEnv(server), cookie, { app: "show-tracker", message: "one more", threadId: thread.threadId });
    expect((await api(server, cookie, "GET", "/assistant/thread")).data.threadId).toBe(thread.threadId);
  });
});

describe("suggested replies", () => {
  it("a closing [[replies: …]] line becomes buttons, never text, even split across chunks", async () => {
    const { replySplitter } = await import("../src/turn");
    const out: string[] = [];
    const r = replySplitter((t) => out.push(t));
    for (const chunk of ["Which show? Bonita or Naples", "?\n[", "[repl", "ies: Bonita Springs | Naples ]]"]) r.push(chunk);
    expect(r.end()).toEqual(["Bonita Springs", "Naples"]);
    expect(out.join("")).toBe("Which show? Bonita or Naples?\n");
  });

  it("brackets that aren't the replies line are sent as they are", async () => {
    const { replySplitter } = await import("../src/turn");
    const out: string[] = [];
    const r = replySplitter((t) => out.push(t));
    r.push("Booth [[12]] is yours [");
    expect(r.end()).toEqual([]);
    expect(out.join("")).toBe("Booth [[12]] is yours [");
  });

  it("the panel gets a replies event and the text without the line", async () => {
    const { model } = scripted([() => message([text("Add a second sale?\n[[replies: Yes | No]]")])]);
    const out = await chat(makeHandler(() => model), assistantEnv(server), cookie, { app: "show-tracker", message: "two herons at Bonita" });
    expect(out.events).toEqual([
      { type: "text", text: "Add a second sale?\n" }, { type: "replies", items: ["Yes", "No"] }, { type: "end", reason: "end_turn" },
    ]);
  });
});

describe("text across steps", () => {
  it("sentences from separate model calls don't run together", async () => {
    const { model } = scripted([
      () => message([text("Looking."), toolUse("search", { q: "bonita", types: ["show"] })]),
      () => message([text("No show called Bonita.")]),
    ]);
    const out = await chat(makeHandler(() => model), assistantEnv(server), cookie, { app: "show-tracker", message: "sold one at bonita" });
    expect(out.events.filter((e: any) => e.type === "text").map((e: any) => e.text).join("")).toBe("Looking. No show called Bonita.");
  });
});

describe("card outcomes in the context line", () => {
  it("names each card's state, newest five", async () => {
    const { cardOutcomes } = await import("../src/turn");
    const base = { summary: "x", expiresAt: "2027-01-02T00:00:00.000Z" };
    expect(cardOutcomes([
      { ...base, id: "a", status: "pending" }, { ...base, id: "b", status: "pending", expiresAt: "2026-01-01T00:00:00.000Z" },
      { ...base, id: "c", status: "cancelled" }, { ...base, id: "d", status: "confirmed" },
    ], "2026-06-01T00:00:00.000Z")).toEqual([
      'card a "x": waiting for the artist\'s tap, nothing saved yet', 'card b "x": expired, nothing saved',
      'card c "x": cancelled, nothing saved', 'card d "x": confirmed by the artist and saved then (it may since have been changed or deleted: search before relying on it)',
    ]);
  });
});

describe("when things go wrong", () => {
  it("not signed in: a plain 401, no stream", async () => {
    const { model } = scripted([]);
    const out = await chat(makeHandler(() => model), assistantEnv(server), "", { message: "hi" });
    expect(out.status).toBe(401);
  });

  it("bad tool input comes back as the validation issues, so the model can fix it", async () => {
    const { model } = scripted([
      () => message([toolUse("show_create", { name: "", card_summary: "x" })]),
      (req) => {
        const r = lastResult(req);
        expect(r.error).toBe("bad_request");
        expect(r.details.issues[0].path).toEqual(["name"]);
        return message([text("What's the show called?")]);
      },
    ]);
    const out = await chat(makeHandler(() => model), assistantEnv(server), cookie, { app: "show-tracker", message: "add a show" });
    expect(out.events.at(-1)).toEqual({ type: "end", reason: "end_turn" });
  });

  it("a tool call cut off at max_tokens is never run, and the thread stays valid", async () => {
    const before = (await api(server, cookie, "GET", "/shows?limit=200")).data.items.length;
    const { model } = scripted([() => message([toolUse("show_create", { name: "Half", card_summary: "x" })], "max_tokens")]);
    const out = await chat(makeHandler(() => model), assistantEnv(server), cookie, { app: "show-tracker", message: "add Half" });
    expect(out.events.at(-1)).toEqual({ type: "end", reason: "max_tokens" });
    expect((await api(server, cookie, "GET", "/shows?limit=200")).data.items.length).toBe(before);
    const last = (await api(server, cookie, "GET", "/assistant/thread")).data.messages.at(-1);
    expect(last.role).toBe("user");
    expect(last.content[0]).toMatchObject({ type: "tool_result", is_error: true });
  });

  it("a failed model call stores nothing, so the thread never ends on an unanswered call", async () => {
    const count = (await api(server, cookie, "GET", "/assistant/thread")).data.messages.length;
    const model = async () => { throw new Error("gateway down"); };
    const out = await chat(makeHandler(() => model), assistantEnv(server), cookie, { app: "show-tracker", message: "hello" });
    expect(out.events.at(-1)).toEqual({ type: "end", reason: "error", message: "gateway down" });
    expect((await api(server, cookie, "GET", "/assistant/thread")).data.messages.length).toBe(count);
  });

  it("a refusal ends the turn", async () => {
    const { model } = scripted([() => message([], "refusal")]);
    const out = await chat(makeHandler(() => model), assistantEnv(server), cookie, { app: "show-tracker", message: "?" });
    expect(out.events.at(-1)).toEqual({ type: "end", reason: "refusal" });
  });

  it("the assistant's key is required: without it studio-api refuses to act as the assistant", async () => {
    const { model } = scripted([]);
    const out = await chat(makeHandler(() => model), assistantEnv(server, { ASSISTANT_KEY: "wrong" }), cookie, { message: "hi" });
    expect(out.status).toBe(401);
  });
});

describe("model settings (D-054)", () => {
  it("Sonnet 5.5 gets low effort and the refusal fallback; Haiku 4.5 neither", () => {
    const env = assistantEnv(server);
    expect(modelSettings(env)).toEqual({ model: "claude-sonnet-5-5", output_config: { effort: "low" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    expect(modelSettings({ ...env, ASSISTANT_MODEL: "claude-haiku-4-5" })).toEqual({ model: "claude-haiku-4-5" });
  });
});

describe("Booth Studio: the assistant reads a booth and proposes a change in the app's own words (D-070)", () => {
  it("search → describe_booth → placement_edit: one card, nothing written until the tap", async () => {
    const built = (await api(server, cookie, "POST", "/actions/placement.build", {
      name: "Coconut Grove booth", show: "artfair", size: "10x10", ops: [{ op: "add_furniture", kind: "table6", x: 0, z: 30 }],
    })).data.result;
    let tableId = "";
    const { model } = scripted([
      (req) => {
        expect(req.tools!.map((t) => (t as { name: string }).name).slice(0, 2)).toEqual(["search", "describe_booth"]);
        // Booth Studio's own guide follows the shared prompt; the tracker's chats don't get it.
        expect(req.system).toBe(`${SYSTEM}\n\n${APP_GUIDES["booth-studio"]}\n\nIf asked which AI model you are: claude-sonnet-5-5, made by Anthropic.`);
        return message([toolUse("search", { q: "coconut grove", types: ["placement"] })]);
      },
      (req) => {
        const id = lastResult(req).items[0].id;
        return message([toolUse("describe_booth", { id })]);
      },
      (req) => {
        const booth = lastResult(req);
        expect(booth).toMatchObject({ id: built.id, name: "Coconut Grove booth", units: "inches" });
        tableId = booth.furniture[0].id;
        return message([toolUse("placement_edit", {
          id: built.id, ops: [{ op: "change_furniture", id: tableId, x: -24 }, { op: "set_booth", width: 180 }],
          card_summary: "Table 2′ left; booth 15′ wide",
        })]);
      },
    ]);
    const out = await chat(makeHandler(() => model), assistantEnv(server), cookie, {
      app: "booth-studio", today: "2027-03-20", page: "Booth Studio", message: "slide the table two feet left and make the booth 10 by 15",
      record: { type: "placement", id: built.id, label: "Coconut Grove booth" },
    });
    expect(out.events.map((e: any) => e.type)).toEqual(["search", "card", "end"]);
    const card = out.events[1].proposal;
    expect(card.details.slice(1)).toEqual([
      { label: "Booth", value: "Coconut Grove booth" },
      { label: "Change 1", value: "Table 6′ with cloth: to 2′ left of centre, 2′ 6″ toward the front" },
      { label: "Change 2", value: "Make the booth 15′ wide × 10′ deep" },
    ]);
    expect((await api(server, cookie, "GET", `/placements/${built.id}`)).data.version).toBe(1);
    expect((await api(server, cookie, "POST", `/assistant/proposals/${card.id}/confirm`)).status).toBe(200);
    const now = (await api(server, cookie, "GET", `/placements/${built.id}`)).data;
    expect(now).toMatchObject({ version: 2, width: 180 });
    expect(now.scene.booth.pedestals[0]).toMatchObject({ id: tableId, x: -24 });
  });

  it("a read tool with its id missing says so to the model; a booth that isn't there is the API's 404", async () => {
    const { model, requests } = scripted([
      () => message([toolUse("describe_booth", {})]),
      (req) => {
        expect(lastResult(req)).toBe("describe_booth needs id.");
        return message([toolUse("describe_booth", { id: "01J0000000000000000000NONE" })]);
      },
      (req) => {
        expect(lastResult(req)).toMatchObject({ error: "not_found" });
        return message([text("I can't find that booth.")]);
      },
    ]);
    const out = await chat(makeHandler(() => model), assistantEnv(server), cookie, { app: "booth-studio", message: "what's in my booth?" });
    expect(out.status).toBe(200);
    expect(requests).toHaveLength(3);
  });
});
