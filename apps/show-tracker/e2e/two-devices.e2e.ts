// Phase 2 gate, in real browsers: two profiles ("phone" and "laptop") on the
// real tracker pages, one real studio-api. Airplane mode is the browser's own
// offline switch, and the offline page opens from the service worker's cache.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Dev, type Stack, chipText, goOffline, goOnline, newDevice, nudge, startStack, synced, until } from "./stack";
import { addShow, editShow, logSale, saleRow, showRow, storeShow } from "./ui";

let stack: Stack;
const devices: Dev[] = [];
beforeAll(async () => { stack = await startStack(); });
afterAll(async () => {
  for (const d of devices) await d.ctx.close().catch(() => {});
  await stack?.stop();
});

async function pair() {
  const phone = await newDevice(stack, "phone");
  const laptop = await newDevice(stack, "laptop");
  devices.push(phone, laptop);
  return { phone, laptop };
}
const noErrors = (...ds: Dev[]) => expect(ds.flatMap((d) => d.errors)).toEqual([]);

/** A show both devices have, and their service workers ready, so offline reloads work. */
async function sharedShow(phone: Dev, laptop: Dev, name: string, fields: Record<string, string> = {}) {
  await addShow(phone.page, { name, city: "Miami", state: "FL", startDate: "2026-12-12", endDate: "2026-12-14", boothFee: "450", status: "accepted", ...fields });
  await synced(phone.page);
  await nudge(laptop.page);
  await showRow(laptop.page, name);
  await synced(laptop.page);
  for (const d of [phone, laptop]) await d.page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  return (await storeShow(phone.page, name)).id as string;
}

describe("the Phase 2 gate", () => {
  it("airplane mode, log a sale, reconnect: the other device shows it, and show, artwork and activity log agree", async () => {
    const { phone, laptop } = await pair();
    const id = await sharedShow(phone, laptop, "Gate Coconut Grove");
    await phone.page.goto(`${stack.url}/expenses.html`); // let the app shell settle into the cache
    await phone.page.waitForTimeout(1500);

    await goOffline(phone);
    await logSale(phone.page, { piece: "Heron", price: "1100", showName: "Gate Coconut Grove" }); // opens from cache, offline
    await saleRow(phone.page, "Heron"); // on screen at once
    await until(async () => /offline/i.test(await chipText(phone.page)) && /waiting/i.test(await chipText(phone.page)), 10_000, () => "chip never said offline with changes waiting");

    await goOnline(phone);
    await synced(phone.page);

    await laptop.page.goto(`${stack.url}/expenses.html`);
    await nudge(laptop.page);
    await saleRow(laptop.page, "Heron");

    // The platform's three records agree.
    const view = await laptop.page.evaluate(async () => {
      const st = (window as any).ASTStudio.studio();
      const art = (await st.list("artwork")).find((a: any) => a.title === "Heron");
      const shows = await st.list("show");
      const links = await st.list("show_artwork");
      const log = (await (await fetch(`/v1/activity?entityId=${art.id}`)).json()) as { items: Array<{ action: string }> };
      return { art, shows, links, actions: log.items.map((i) => i.action) };
    });
    const show = view.shows.find((s: any) => s.meta.trackerId === id);
    expect(view.art).toMatchObject({ status: "sold", priceCents: 110000 });
    expect(view.links).toEqual([expect.objectContaining({ showId: show.id, artworkId: view.art.id, outcome: "sold", soldPriceCents: 110000 })]);
    expect(view.actions).toContain("artwork.mark_sold");
    noErrors(phone, laptop);
  });
});

describe("conflicts", () => {
  it("different fields edited offline on two devices both land; no review card", async () => {
    const { phone, laptop } = await pair();
    const id = await sharedShow(phone, laptop, "Merge Festival");
    await goOffline(phone); await goOffline(laptop);
    await editShow(phone.page, "Merge Festival", { name: "Merge Festival 2027" });
    await editShow(laptop.page, "Merge Festival", { boothFee: "500" });
    await goOnline(laptop); await synced(laptop.page);
    await goOnline(phone); await synced(phone.page);
    await nudge(laptop.page); await synced(laptop.page);

    for (const d of [phone, laptop]) {
      await until(async () => {
        const s = await d.page.evaluate(async (i) => (await (window as any).AST.Store.get(i)), id);
        return s?.name === "Merge Festival 2027" && s?.boothFee === 500;
      }, 20_000, () => `${d.name} never saw both edits`);
      expect(await chipText(d.page)).not.toMatch(/to review/i);
    }
    noErrors(phone, laptop);
  });

  it("the same field edited offline on two devices: the server keeps the first, the second gets a review card, 'Use mine' converges", async () => {
    const { phone, laptop } = await pair();
    const id = await sharedShow(phone, laptop, "Conflict Festival");
    await goOffline(phone); await goOffline(laptop);
    await editShow(laptop.page, "Conflict Festival", { boothFee: "500" });
    await editShow(phone.page, "Conflict Festival", { boothFee: "650" });
    await goOnline(laptop); await synced(laptop.page);
    await goOnline(phone);
    await until(async () => /1 to review/i.test(await chipText(phone.page)), 20_000, () => "no review card appeared on the phone");

    await phone.page.locator(".studio-chip").click();
    const card = phone.page.locator(".studio-card");
    await expect(card.innerText()).resolves.toMatch(/Conflict Festival/);
    await expect(card.innerText()).resolves.toMatch(/Booth fee: kept \$500\.00 from the other device; you had \$650\.00/i);
    expect((await storeShow(phone.page, "Conflict Festival")).boothFee).toBe(500); // theirs, on screen

    await card.locator("[data-act=mine]").click();
    await until(async () => !/to review/i.test(await chipText(phone.page)), 10_000, () => "card never cleared");
    await synced(phone.page);
    await nudge(laptop.page); await synced(laptop.page);
    for (const d of [phone, laptop]) {
      await until(async () => (await d.page.evaluate(async (i) => (await (window as any).AST.Store.get(i)).boothFee, id)) === 650, 20_000, () => `${d.name} did not end on 650`);
    }
    noErrors(phone, laptop);
  });
});

describe("an edit made while a pull is in flight", () => {
  it("is not overwritten by what the pull brings, and reaches the server afterwards", async () => {
    const { phone, laptop } = await pair();
    const id = await sharedShow(phone, laptop, "Midflight Festival");

    // The laptop renames the show and sends it.
    await editShow(laptop.page, "Midflight Festival", { name: "Midflight Festival (renamed)" });
    await synced(laptop.page);

    // The phone starts a sync, but its pull is held up on the network (and so is the push that follows)...
    const gate = () => { let open!: () => void; const opened = new Promise<void>((r) => { open = r; }); return { opened, open, hits: 0 }; };
    const pull = gate(), push = gate();
    await phone.page.route("**/v1/sync/pull*", async (route) => { pull.hits++; await pull.opened; await route.continue(); });
    await phone.page.route("**/v1/sync/push", async (route) => { push.hits++; await push.opened; await route.continue(); });
    await nudge(phone.page);
    await until(() => pull.hits > 0, 10_000, () => "the pull never started");

    // ...and meanwhile the artist edits another field on the phone.
    await phone.page.evaluate(async (i) => {
      const AST = (window as any).AST;
      await AST.Store.upsert({ ...(await AST.Store.get(i)), city: "Tampa" });
    }, id);
    await phone.page.evaluate(() => (window as any).ASTStudio._flush());

    // The pull lands (it carries the laptop's rename). The unsent edit must still be there.
    pull.open();
    await until(() => push.hits > 0, 15_000, () => "the push never followed the pull");
    expect((await storeShow(phone.page, "Midflight Festival"))?.city).toBe("Tampa");
    expect(await phone.page.evaluate(() => (window as any).ASTStudio.status().pending)).toBeGreaterThan(0);

    // Let the push through: now both changes exist, on both devices, with no review card.
    push.open();
    await synced(phone.page);
    await nudge(laptop.page); await synced(laptop.page);
    for (const d of [phone, laptop]) {
      await until(async () => {
        const s = await d.page.evaluate(async (i) => (await (window as any).AST.Store.get(i)), id);
        return s?.name === "Midflight Festival (renamed)" && s?.city === "Tampa";
      }, 20_000, () => `${d.name} lost one of the edits`);
      expect(await chipText(d.page)).not.toMatch(/to review/i);
    }
    noErrors(phone, laptop);
  });
});
