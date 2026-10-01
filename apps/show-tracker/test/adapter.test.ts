// The Show Tracker's real scripts on two simulated devices, against the real
// studio-api (local D1). Covers the Phase 2 gate flow and the merge rules.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Server, startServer } from "../../../packages/sdk/test/server";
import { type TrackerDevice, trackerDevice } from "./device";

let server: Server;
beforeAll(async () => { server = await startServer(); });
afterAll(async () => { await server?.dispose(); });

const FIELDS = { city: "Miami", state: "FL", startDate: "2026-12-12", endDate: "2026-12-14" };

async function pair() {
  const phone = await trackerDevice(server);
  const laptop = await trackerDevice(server);
  return { phone, laptop };
}
const shows = (d: TrackerDevice) => d.AST.Store.list() as Promise<Array<Record<string, any>>>;
const sales = (d: TrackerDevice) => d.AST.Store.listSales() as Promise<Array<Record<string, any>>>;
const studioRecords = (d: TrackerDevice, type: string) => d.ST.studio().list(type) as Promise<Array<Record<string, any>>>;

/** Add a show on `from`, settle both devices, return it. */
async function sharedShow(from: TrackerDevice, to: TrackerDevice, extra: Record<string, unknown> = {}) {
  const show = await from.AST.Store.upsert({ name: "Coconut Grove", boothFee: 450, status: "accepted", ...FIELDS, ...extra });
  await from.settle();
  await to.settle();
  return show;
}

describe("shows", () => {
  it("a show added on one device appears on the other, with every tracker field intact", async () => {
    const { phone, laptop } = await pair();
    const show = await sharedShow(phone, laptop, { rating: 7, hidden: true, juryFee: 35, status: "waitlist", lat: 25.7, lng: -80.2 });
    const [got] = (await shows(laptop)).filter((s) => s.id === show.id);
    expect(got).toMatchObject({
      id: show.id, name: "Coconut Grove", city: "Miami", state: "FL", boothFee: 450, juryFee: 35, rating: 7,
      hidden: true, status: "waitlist", startDate: "2026-12-12", endDate: "2026-12-14", lat: 25.7, lng: -80.2, grossSales: null,
    });
    // The platform sees an ordinary show, in its own units.
    const rec = (await studioRecords(laptop, "show")).find((s) => s.meta.trackerId === show.id)!;
    expect(rec).toMatchObject({ name: "Coconut Grove", feeCents: 45000, status: "applied", startsOn: "2026-12-12" });
  });

  it("an edit syncs; different fields edited offline on two devices both land", async () => {
    const { phone, laptop } = await pair();
    const show = await sharedShow(phone, laptop);
    phone.net.online = false; laptop.net.online = false;
    await phone.AST.Store.upsert({ ...show, name: "Coconut Grove Arts Festival" });
    await laptop.AST.Store.upsert({ ...show, boothFee: 500 });
    await phone.settle(); await laptop.settle();
    laptop.net.online = true; await laptop.settle();
    phone.net.online = true; await phone.settle(); await laptop.settle();
    for (const d of [phone, laptop]) {
      expect((await shows(d)).find((s) => s.id === show.id)).toMatchObject({ name: "Coconut Grove Arts Festival", boothFee: 500 });
    }
    expect(phone.ST.Reviews.list()).toEqual([]);
  });

  it("the same field edited offline on two devices: the server keeps the first, the second gets a review card, and 'use mine' re-applies", async () => {
    const { phone, laptop } = await pair();
    const show = await sharedShow(phone, laptop);
    phone.net.online = false; laptop.net.online = false;
    await laptop.AST.Store.upsert({ ...show, boothFee: 500 });
    await phone.AST.Store.upsert({ ...show, boothFee: 650 });
    await phone.settle(); await laptop.settle();
    laptop.net.online = true; await laptop.settle();
    phone.net.online = true; await phone.settle();

    const [card] = phone.ST.Reviews.list();
    expect(card).toMatchObject({ label: "Coconut Grove", entityType: "show" });
    expect(card.conflicts).toEqual([{ field: "feeCents", label: "Booth fee", serverValue: 50000, deviceValue: 65000 }]);
    expect((await shows(phone)).find((s) => s.id === show.id)?.boothFee).toBe(500); // theirs, on screen

    await phone.ST.useMine(card.id);
    await phone.settle(); await laptop.settle();
    expect(phone.ST.Reviews.list()).toEqual([]);
    for (const d of [phone, laptop]) expect((await shows(d)).find((s) => s.id === show.id)?.boothFee).toBe(650);
  });

  it("a delete on one device removes the show on the other", async () => {
    const { phone, laptop } = await pair();
    const show = await sharedShow(phone, laptop);
    await phone.AST.Store.remove(show.id);
    await phone.settle(); await laptop.settle();
    expect((await shows(laptop)).map((s) => s.id)).not.toContain(show.id);
  });

  it("a fresh device on the demo season takes the studio's real one, and never uploads the demo", async () => {
    const owner = await trackerDevice(server);
    const demo = await trackerDevice(server, { signedIn: false });
    expect(demo.AST.LocalStore.isPristineSeed()).toBe(true);
    const seedCount = (await shows(demo)).length;
    expect(seedCount).toBeGreaterThan(0);

    await owner.settle();
    const before = (await studioRecords(owner, "show")).length;
    expect(before).toBeGreaterThan(0); // earlier tests left real shows in the studio
    await demo.connect();
    await demo.settle(); await owner.settle();
    expect((await studioRecords(owner, "show")).length).toBe(before); // the demo season didn't go up

    const real = await owner.AST.Store.upsert({ name: "Only Real Show", ...FIELDS });
    await owner.settle(); await demo.settle();
    expect((await shows(demo)).map((s) => s.name)).toEqual((await shows(owner)).map((s) => s.name));
    expect((await shows(demo)).some((s) => s.id === real.id)).toBe(true);
    expect(demo.AST.LocalStore.isPristineSeed()).toBe(false);
  });
});

describe("nothing is lost on the way", () => {
  it("a long note, a blank piece name and sub-cent junk survive the round trip; a show with no name waits", async () => {
    const { phone, laptop } = await pair();
    const notes = "x".repeat(6000);
    const show = await phone.AST.Store.upsert({ name: "Long Notes Show", notes, ...FIELDS });
    const sale = await phone.AST.Store.upsertSale({ piece: "", price: 12.5, notes: "y".repeat(5200) });
    const unnamed = await phone.AST.Store.upsert({ name: "", ...FIELDS });
    await phone.settle(); await laptop.settle();
    expect((await shows(laptop)).find((s) => s.id === show.id)?.notes).toBe(notes);
    expect((await sales(laptop)).find((x) => x.id === sale.id)).toMatchObject({ piece: "", price: 12.5, notes: "y".repeat(5200) });
    expect((await shows(laptop)).map((s) => s.id)).not.toContain(unnamed.id);
    expect((await shows(phone)).map((s) => s.id)).toContain(unnamed.id); // still on the phone
  });
});

describe("sales: the Phase 2 gate flow", () => {
  it("a sale logged offline at a show reaches the other device; show, artwork and activity log agree", async () => {
    const { phone, laptop } = await pair();
    const show = await sharedShow(phone, laptop);

    phone.net.online = false;
    const sale = await phone.AST.Store.upsertSale({ showId: show.id, piece: "Heron", price: 1100, medium: "Oil", date: "2026-12-13" });
    await phone.settle();
    expect(phone.ST.status().pending).toBeGreaterThan(0); // queued, not lost
    expect((await sales(phone)).map((s) => s.id)).toContain(sale.id); // already on screen

    phone.net.online = true;
    await phone.settle(); await laptop.settle();
    expect(phone.ST.status().pending).toBe(0);

    const got = (await sales(laptop)).find((s) => s.id === sale.id);
    expect(got).toMatchObject({ showId: show.id, piece: "Heron", price: 1100, medium: "Oil", date: "2026-12-13" });

    // Platform records agree.
    const art = (await studioRecords(laptop, "artwork")).find((a) => a.meta.trackerId === sale.id)!;
    expect(art).toMatchObject({ title: "Heron", status: "sold", priceCents: 110000 });
    expect(art.meta.sale).toMatchObject({ priceCents: 110000, showId: (await studioRecords(laptop, "show")).find((s) => s.meta.trackerId === show.id)!.id });
    const links = await studioRecords(laptop, "show_artwork");
    expect(links).toEqual([expect.objectContaining({ artworkId: art.id, outcome: "sold", soldPriceCents: 110000 })]);

    const rows = await server.DB.prepare("SELECT action, entity_type FROM activity_log WHERE entity_id = ?").bind(art.id).all<{ action: string }>();
    expect(rows.results.map((r) => r.action)).toContain("artwork.mark_sold");
  });

  it("a sale on a show that has never synced creates the show first", async () => {
    const { phone, laptop } = await pair();
    const show = await phone.AST.Store.upsert({ name: "Brand New Show", ...FIELDS });
    const sale = await phone.AST.Store.upsertSale({ showId: show.id, piece: "Egret", price: 800 });
    await phone.settle(); await laptop.settle();
    expect((await shows(laptop)).map((s) => s.id)).toContain(show.id);
    expect((await sales(laptop)).map((s) => s.id)).toContain(sale.id);
  });

  it("an unpriced sale stays unpriced (never $0) and still syncs", async () => {
    const { phone, laptop } = await pair();
    const sale = await phone.AST.Store.upsertSale({ piece: "Gift print", price: null });
    await phone.settle(); await laptop.settle();
    const got = (await sales(laptop)).find((s) => s.id === sale.id)!;
    expect(got.price).toBeNull();
    const art = (await studioRecords(laptop, "artwork")).find((a) => a.meta.trackerId === sale.id)!;
    expect(art).toMatchObject({ status: "sold", priceCents: null });
  });

  it("editing a sale's price updates the artwork and its recorded sale on the other device", async () => {
    const { phone, laptop } = await pair();
    const show = await sharedShow(phone, laptop);
    const sale = await phone.AST.Store.upsertSale({ showId: show.id, piece: "Heron", price: 1100 });
    await phone.settle(); await laptop.settle();
    await phone.AST.Store.upsertSale({ ...sale, price: 1000 });
    await phone.settle(); await laptop.settle();
    expect((await sales(laptop)).find((s) => s.id === sale.id)?.price).toBe(1000);
    const art = (await studioRecords(laptop, "artwork")).find((a) => a.meta.trackerId === sale.id)!;
    expect(art).toMatchObject({ priceCents: 100000 });
    expect(art.meta.sale.priceCents).toBe(100000);
  });

  it("deleting a sale removes it on the other device", async () => {
    const { phone, laptop } = await pair();
    const sale = await phone.AST.Store.upsertSale({ piece: "Heron", price: 1100 });
    await phone.settle(); await laptop.settle();
    await phone.AST.Store.removeSale(sale.id);
    await phone.settle(); await laptop.settle();
    expect((await sales(laptop)).map((s) => s.id)).not.toContain(sale.id);
  });
});

describe("what stays on the device", () => {
  it("contacts, expenses and applications never reach the studio", async () => {
    const { phone, laptop } = await pair();
    await phone.AST.Store.upsertContact({ name: "A Collector", email: "c@example.test" });
    await phone.AST.Store.upsertExpense({ label: "Gas", amount: 40 });
    await phone.settle(); await laptop.settle();
    expect(await laptop.AST.Store.listContacts()).toEqual([]);
    expect(await laptop.AST.Store.listExpenses()).toEqual([]);
    expect(JSON.stringify(await studioRecords(laptop, "artwork"))).not.toContain("A Collector");
  });
});
