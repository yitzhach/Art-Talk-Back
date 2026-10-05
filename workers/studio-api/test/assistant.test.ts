// Phase 3: the assistant proposes, studio-api decides (D-045, D-046).
import { env } from "cloudflare:test";
import { newId } from "@studio/core";
import { describe, expect, it } from "vitest";
import { getAction } from "../src/actions/runner";
import { assistantLevel } from "../src/actions/runner";
import { ASSISTANT, call, makeStudio, rowCount } from "./helpers";

const act = (cookie: string, action: string, input: Record<string, unknown>, summary = "Do it") =>
  call("/v1/assistant/act", { method: "POST", cookie, headers: ASSISTANT, json: { action, input, summary } });

async function studioWithShow() {
  const a = await makeStudio();
  const show = (await call("/v1/shows", { method: "POST", cookie: a.cookie, json: { name: "Winter Park Sidewalk Art Festival", city: "Winter Park" } })).data;
  return { a, show };
}

describe("the level that applies (D-045)", () => {
  const def = (name: string) => getAction(name)!;
  it("is the registry's, unless the studio chose one", () => {
    expect(assistantLevel(def("show.create"), null)).toBe("auto");
    expect(assistantLevel(def("sale.create"), null)).toBe("confirm");
    expect(assistantLevel(def("sale.create"), "auto")).toBe("auto");
    expect(assistantLevel(def("show.create"), "never")).toBe("never");
  });
  it("never lowers always_confirm, and setting money is at least confirm", () => {
    expect(assistantLevel(def("sale.delete"), "auto")).toBe("always_confirm");
    expect(assistantLevel(def("sale.delete"), "never")).toBe("never");
    expect(assistantLevel(def("show.create"), null, { name: "X", feeCents: 65000 })).toBe("confirm");
    expect(assistantLevel(def("show.update"), null, { id: newId(), version: 1, patch: { meta: { juryFeeCents: 3500 } } })).toBe("confirm");
    expect(assistantLevel(def("assistant_policy.set"), "auto")).toBe("never");
  });
});

describe("POST /assistant/act", () => {
  it("runs an action the assistant may do alone, logged as the assistant", async () => {
    const a = await makeStudio();
    const res = await act(a.cookie, "show.create", { name: "Coconut Grove" });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ status: "done", result: { name: "Coconut Grove", actorType: "assistant" } });
    const log = await env.DB.prepare("SELECT actor_type, source, actor_id FROM activity_log WHERE id = ?").bind(res.data.activityIds[0]).first();
    expect(log).toEqual({ actor_type: "assistant", source: "assistant", actor_id: a.userId });
  });

  it("turns a sale into a confirm card and writes nothing until the tap (gate 1)", async () => {
    const { a, show } = await studioWithShow();
    const res = await act(a.cookie, "sale.create", {
      title: "Heron, small print", priceCents: 9000, quantity: 2, showId: show.id, paymentMethod: "cash",
    }, "Two small heron prints, $90 each, cash, at Winter Park");
    expect(res.status).toBe(200);
    expect(res.data.status).toBe("needs_confirmation");
    const card = res.data.proposal;
    expect(card).toMatchObject({ action: "sale.create", level: "confirm", status: "pending", summary: "Two small heron prints, $90 each, cash, at Winter Park" });
    // The card's own lines come from the input, not from the model.
    expect(card.details).toEqual(expect.arrayContaining([
      { label: "Price", value: "$90.00" }, { label: "Quantity", value: "2" },
      { label: "Show", value: "Winter Park Sidewalk Art Festival" }, { label: "Paid by", value: "cash" },
    ]));
    expect(await rowCount("SELECT COUNT(*) AS n FROM sales WHERE studio_id = ?", a.studioId)).toBe(0);
    expect((await call("/v1/assistant/proposals", { cookie: a.cookie })).data.items.map((p: any) => p.id)).toEqual([card.id]);

    const ok = await call(`/v1/assistant/proposals/${card.id}/confirm`, { method: "POST", cookie: a.cookie });
    expect(ok.status).toBe(200);
    expect(ok.data.proposal.status).toBe("confirmed");
    expect(ok.data.result).toMatchObject({ title: "Heron, small print", priceCents: 9000, showId: show.id, actorType: "assistant" });
    // A second tap answers the same and writes nothing more.
    const again = await call(`/v1/assistant/proposals/${card.id}/confirm`, { method: "POST", cookie: a.cookie });
    expect(again.status).toBe(200);
    expect(again.data.result.id).toBe(ok.data.result.id);
    expect(await rowCount("SELECT COUNT(*) AS n FROM sales WHERE studio_id = ? AND deleted_at IS NULL", a.studioId)).toBe(1);
    // Undo from the card.
    const undo = await call(`/v1/activity/${ok.data.activityIds[0]}/undo`, { method: "POST", cookie: a.cookie });
    expect(undo.status).toBe(200);
    expect(await rowCount("SELECT COUNT(*) AS n FROM sales WHERE studio_id = ? AND deleted_at IS NULL", a.studioId)).toBe(0);
  });

  it("an edit without a version uses the current one, and a card fails if the record moves on before the tap", async () => {
    const { a, show } = await studioWithShow();
    const res = await act(a.cookie, "show.update", { id: show.id, patch: { feeCents: 70000 } });
    expect(res.data.status).toBe("needs_confirmation"); // money
    expect(res.data.proposal.input.version).toBe(1);
    expect(res.data.proposal.details).toEqual(expect.arrayContaining([{ label: "Booth fee", value: "not recorded → $700.00" }]));
    await call(`/v1/shows/${show.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { notes: "moved on" } });
    const late = await call(`/v1/assistant/proposals/${res.data.proposal.id}/confirm`, { method: "POST", cookie: a.cookie });
    expect(late.status).toBe(409);
  });

  it("names a record that isn't in the studio → 404, and no card", async () => {
    const a = await makeStudio();
    const res = await act(a.cookie, "sale.create", { title: "X", showId: newId() });
    expect(res.status).toBe(404);
    expect(await rowCount("SELECT COUNT(*) AS n FROM pending_actions WHERE studio_id = ?", a.studioId)).toBe(0);
  });

  it("refuses bad input with the validation issues, so the model can correct itself", async () => {
    const a = await makeStudio();
    const res = await act(a.cookie, "sale.create", { title: "X", priceCents: 90.5 });
    expect(res.status).toBe(400);
    expect(res.data.error.details.issues[0].path).toEqual(["priceCents"]);
  });

  it("is for the assistant only", async () => {
    const a = await makeStudio();
    const res = await call("/v1/assistant/act", { method: "POST", cookie: a.cookie, json: { action: "show.create", input: { name: "X" }, summary: "x" } });
    expect(res.status).toBe(403);
  });
});

describe("cards are the person's to answer", () => {
  it("the assistant can't confirm or cancel; another member can't see them; a cancelled card can't be confirmed", async () => {
    const { a, show } = await studioWithShow();
    const card = (await act(a.cookie, "sale.create", { title: "Heron", showId: show.id })).data.proposal;
    expect((await call(`/v1/assistant/proposals/${card.id}/confirm`, { method: "POST", cookie: a.cookie, headers: ASSISTANT })).status).toBe(403);
    expect((await call(`/v1/assistant/proposals/${card.id}/cancel`, { method: "POST", cookie: a.cookie, headers: ASSISTANT })).status).toBe(403);

    // A staff member of the same studio, signed in separately.
    const staff = await makeStudio("other", "staff");
    await env.DB.prepare("UPDATE memberships SET studio_id = ? WHERE user_id = ?").bind(a.studioId, staff.userId).run();
    await env.DB.prepare("UPDATE sessions SET studio_id = ? WHERE user_id = ?").bind(a.studioId, staff.userId).run();
    expect((await call(`/v1/assistant/proposals/${card.id}/confirm`, { method: "POST", cookie: staff.cookie })).status).toBe(404);
    expect((await call("/v1/assistant/proposals", { cookie: staff.cookie })).data.items).toEqual([]);

    const cancelled = await call(`/v1/assistant/proposals/${card.id}/cancel`, { method: "POST", cookie: a.cookie });
    expect(cancelled.data.status).toBe("cancelled");
    expect((await call(`/v1/assistant/proposals/${card.id}/confirm`, { method: "POST", cookie: a.cookie })).status).toBe(409);
    // status=all still lists it, with what happened; staff never see it.
    const all = (await call("/v1/assistant/proposals?status=all", { cookie: a.cookie })).data.items;
    expect(all.find((p: any) => p.id === card.id)).toMatchObject({ status: "cancelled" });
    expect((await call("/v1/assistant/proposals?status=all", { cookie: staff.cookie })).data.items.find((p: any) => p.id === card.id)).toBeUndefined();
    expect(await rowCount("SELECT COUNT(*) AS n FROM sales WHERE studio_id = ?", a.studioId)).toBe(0);
  });

  it("an expired card can't be confirmed", async () => {
    const { a, show } = await studioWithShow();
    const card = (await act(a.cookie, "sale.create", { title: "Heron", showId: show.id })).data.proposal;
    await env.DB.prepare("UPDATE pending_actions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(card.id).run();
    const res = await call(`/v1/assistant/proposals/${card.id}/confirm`, { method: "POST", cookie: a.cookie });
    expect(res.status).toBe(409);
    expect(res.data.error.message).toMatch(/expired/);
  });
});

describe("the assistant's limits hold on every route (gate 2)", () => {
  it("a write on a plain REST route needs the card too", async () => {
    const a = await makeStudio();
    const res = await call("/v1/sales", { method: "POST", cookie: a.cookie, headers: ASSISTANT, json: { title: "Sneaky", priceCents: 100 } });
    expect(res.status).toBe(428);
    expect(res.data.error).toMatchObject({ code: "needs_confirmation", details: { action: "sale.create", level: "confirm" } });
    const del = await call("/v1/actions/show.create", { method: "POST", cookie: a.cookie, headers: ASSISTANT, json: { name: "Fee", feeCents: 100 } });
    expect(del.status).toBe(428);
    expect(await rowCount("SELECT COUNT(*) AS n FROM sales WHERE studio_id = ?", a.studioId)).toBe(0);
  });

  it("can't push a device outbox, can't touch its own policy, and a wrong key is refused", async () => {
    const a = await makeStudio();
    const push = await call("/v1/sync/push", { method: "POST", cookie: a.cookie, headers: ASSISTANT,
      json: { ops: [{ opId: newId(), action: "sale.create", entityId: newId(), baseVersion: null, input: { title: "x" } }] } });
    expect(push.status).toBe(403);
    expect((await call("/v1/assistant/policy/sale.create", { method: "PUT", cookie: a.cookie, headers: ASSISTANT, json: { level: "auto" } })).status).toBe(403);
    expect((await call("/v1/actions/assistant_policy.set", { method: "POST", cookie: a.cookie, headers: ASSISTANT, json: { action: "sale.create", level: "auto" } })).status).toBe(403);
    const wrong = await call("/v1/shows", { method: "POST", cookie: a.cookie, headers: { "X-Studio-Assistant": "guess" }, json: { name: "x" } });
    expect(wrong.status).toBe(401);
    expect(await rowCount("SELECT COUNT(*) AS n FROM shows WHERE studio_id = ?", a.studioId)).toBe(0);
  });

  it("internal actions can't be run by name", async () => {
    const a = await makeStudio();
    const res = await call("/v1/actions/assistant.propose", { method: "POST", cookie: a.cookie,
      json: { action: "sale.create", input: {}, summary: "x", details: [], level: "confirm" } });
    expect(res.status).toBe(404);
  });

  it("an action outside the person's role is refused", async () => {
    const staff = await makeStudio("S", "staff");
    const show = (await call("/v1/shows", { method: "POST", cookie: staff.cookie, json: { name: "Grove" } })).data;
    const res = await act(staff.cookie, "show.delete", { id: show.id });
    expect(res.status).toBe(403);
  });
});

describe("policy", () => {
  it("the owner can let the assistant log sales alone, or stop it entirely", async () => {
    const { a, show } = await studioWithShow();
    const set = await call("/v1/assistant/policy/sale.create", { method: "PUT", cookie: a.cookie, json: { level: "auto" } });
    expect(set.status).toBe(200);
    const unpriced = await act(a.cookie, "sale.create", { title: "Heron", showId: show.id });
    expect(unpriced.data.status).toBe("done");
    // A price is still money: it asks.
    expect((await act(a.cookie, "sale.create", { title: "Heron", priceCents: 9000 })).data.status).toBe("needs_confirmation");

    await call("/v1/assistant/policy/sale.create", { method: "PUT", cookie: a.cookie, json: { level: "never" } });
    expect((await act(a.cookie, "sale.create", { title: "Heron" })).status).toBe(403);
    const tools = (await call("/v1/assistant/tools?app=show-tracker", { cookie: a.cookie, headers: ASSISTANT })).data.tools;
    expect(tools.map((t: any) => t.name)).not.toContain("sale_create");
    const policy = (await call("/v1/assistant/policy", { cookie: a.cookie })).data.items;
    expect(policy.find((p: any) => p.action === "sale.create")).toMatchObject({ defaultLevel: "confirm", studioLevel: "never", level: "never" });
  });

  it("always_confirm can't be lowered, and only the owner chooses", async () => {
    const a = await makeStudio();
    const res = await call("/v1/assistant/policy/sale.delete", { method: "PUT", cookie: a.cookie, json: { level: "auto" } });
    expect(res.status).toBe(400);
    expect(res.data.error.details.allowed).toEqual(["always_confirm", "never"]);
    const staff = await makeStudio("S", "staff");
    expect((await call("/v1/assistant/policy/sale.create", { method: "PUT", cookie: staff.cookie, json: { level: "auto" } })).status).toBe(403);
  });
});

describe("tools per app (gate 3)", () => {
  it("Show Tracker gets search plus the show and sale tools, nothing else", async () => {
    const a = await makeStudio();
    const res = await call("/v1/assistant/tools?app=show-tracker", { cookie: a.cookie, headers: ASSISTANT });
    expect(res.data.tools.map((t: any) => t.name)).toEqual([
      "search", "sale_create", "sale_delete", "sale_restore", "sale_update", "show_create", "show_delete", "show_restore", "show_update",
    ]);
    for (const t of res.data.tools) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(t.inputSchema.type).toBe("object");
    }
    const update = res.data.tools.find((t: any) => t.name === "sale_update");
    expect(update.inputSchema.required).toEqual(["id", "patch"]); // version filled in by studio-api
    expect(update.description).toMatch(/confirms this with one tap/);
  });

  it("the general assistant gets every tool the role allows; staff never see delete tools", async () => {
    const owner = await makeStudio();
    const all = (await call("/v1/assistant/tools", { cookie: owner.cookie })).data.tools.map((t: any) => t.name);
    expect(all).toEqual(expect.arrayContaining(["artwork_create", "client_update", "artwork_mark_sold", "settings_update", "activity_undo"]));
    expect(all.some((n: string) => n.startsWith("assistant"))).toBe(false);
    const staff = await makeStudio("S", "staff");
    const staffTools = (await call("/v1/assistant/tools", { cookie: staff.cookie })).data.tools.map((t: any) => t.name);
    expect(staffTools.some((n: string) => n.endsWith("_delete"))).toBe(false);
  });
});

describe("GET /search", () => {
  it("finds by any words, best match first, only in the caller's studio", async () => {
    const { a, show } = await studioWithShow();
    await call("/v1/shows", { method: "POST", cookie: a.cookie, json: { name: "Park City Kimball Arts Festival" } });
    await call("/v1/sales", { method: "POST", cookie: a.cookie, json: { title: "Heron, small print", priceCents: 9000, showId: show.id } });
    const other = await makeStudio("Other");
    await call("/v1/shows", { method: "POST", cookie: other.cookie, json: { name: "Winter Park Autumn Show" } });

    const res = await call("/v1/search?q=winter%20park", { cookie: a.cookie });
    expect(res.data.items).toEqual([{ type: "show", id: show.id, version: 1, label: "Winter Park Sidewalk Art Festival", detail: "Winter Park · planned" }]);
    const park = (await call("/v1/search?q=park&types=show", { cookie: a.cookie })).data.items.map((i: any) => i.label);
    expect(park).toHaveLength(2);
    expect((await call("/v1/search?q=heron", { cookie: a.cookie })).data.items[0]).toMatchObject({ type: "sale", detail: "$90.00" });
    // LIKE wildcards are just characters.
    expect((await call("/v1/search?q=%25", { cookie: a.cookie })).data.items).toEqual([]);
  });
});

describe("the conversation (D-053)", () => {
  it("is append-only, comes back exactly as stored, and starts afresh after a quiet spell", async () => {
    const a = await makeStudio();
    const t = (await call("/v1/assistant/thread", { cookie: a.cookie })).data;
    expect(t.messages).toEqual([]);
    const content = [{ type: "text", text: "sold two herons" }];
    const add = await call("/v1/assistant/thread/messages", { method: "POST", cookie: a.cookie, headers: ASSISTANT,
      json: { threadId: t.threadId, app: "show-tracker", messages: [{ role: "user", content }, { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig==" }, { type: "text", text: "Which show?" }] }] } });
    expect(add.status).toBe(200);
    const back = (await call("/v1/assistant/thread", { cookie: a.cookie })).data;
    expect(back.threadId).toBe(t.threadId);
    expect(back.messages.map((m: any) => m.content)).toEqual([content, [{ type: "thinking", thinking: "", signature: "sig==" }, { type: "text", text: "Which show?" }]]);
    // A person can read the thread but not write into the model's history.
    expect((await call("/v1/assistant/thread/messages", { method: "POST", cookie: a.cookie, json: { threadId: t.threadId, app: null, messages: [{ role: "user", content }] } })).status).toBe(403);
    await env.DB.prepare("UPDATE assistant_messages SET created_at = '2000-01-01T00:00:00.000Z'").run();
    const fresh = (await call("/v1/assistant/thread", { cookie: a.cookie })).data;
    expect(fresh.threadId).not.toBe(t.threadId);
    expect(fresh.messages).toEqual([]);
  });
});
