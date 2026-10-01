// "Import my existing data": the tracker's saved localStorage (fixtures in the
// real shapes) goes up once, through the SDK's outbox and /v1/sync/push.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Server, startServer } from "../../../packages/sdk/test/server";
import { type TrackerDevice, trackerDevice } from "./device";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
const V11 = fixture("ledger-v11.json");
const OLD_ARRAY = fixture("ledger-v0-array.json");
const DB_KEY = "artShowTracker.db";

let server: Server;
beforeEach(async () => { server = await startServer(); });
afterEach(async () => { await server?.dispose(); });

const records = (d: TrackerDevice, type: string) => d.ST.studio().list(type) as Promise<Array<Record<string, any>>>;
const count = async (table: string) => (await server.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
const shows = (d: TrackerDevice) => d.AST.Store.list() as Promise<Array<Record<string, any>>>;
const sales = (d: TrackerDevice) => d.AST.Store.listSales() as Promise<Array<Record<string, any>>>;

async function existingDevice(db = V11) {
  const d = await trackerDevice(server, { signedIn: false, localStorage: { [DB_KEY]: db } });
  await d.connect();
  return d;
}

describe("import", () => {
  it("previews, then uploads the live shows and sales once; contacts, expenses and deleted rows stay behind", async () => {
    const phone = await existingDevice();
    expect(await phone.ST.importPreview()).toMatchObject({ demo: false, shows: 4, sales: 3, skipped: 1, doneAt: null });

    const res = await phone.ST.importExisting();
    expect(res).toMatchObject({ imported: { shows: 4, sales: 3 }, linked: { shows: 0, sales: 0 }, skipped: 1, already: 0 });
    await phone.settle();
    expect(phone.ST.status().pending).toBe(0);

    expect(await count("shows")).toBe(4);
    expect(await count("artworks")).toBe(3);
    const platformShows = await records(phone, "show");
    expect(platformShows.map((s) => s.name).sort()).toEqual(
      ["Coconut Grove Arts Festival", "Naples National Art Festival", "Studio open house", "Winter Park Sidewalk Art Festival"],
    );
    const everything = JSON.stringify([platformShows, await records(phone, "artwork")]);
    for (const left of ["A. Collector", "collector@example.test", "Booth fee", "Show I deleted", "Mistaken entry", "Nowhere"]) {
      expect(everything).not.toContain(left);
    }

    // The sales landed as the platform expects them.
    const art = Object.fromEntries((await records(phone, "artwork")).map((a) => [a.title, a]));
    const winterPark = platformShows.find((s) => s.name.startsWith("Winter Park"))!;
    expect(art["Heron at Dusk"]).toMatchObject({ status: "sold", priceCents: 110000 });
    expect(art["Heron at Dusk"].meta.sale).toMatchObject({ priceCents: 110000, showId: winterPark.id });
    expect(art["Gift print"]).toMatchObject({ status: "sold", priceCents: null }); // unpriced, never $0
    expect(art["Studio sale: Egret"]).toMatchObject({ status: "sold", priceCents: 24050 });
    expect(await records(phone, "show_artwork")).toEqual([expect.objectContaining({ showId: winterPark.id, outcome: "sold", soldPriceCents: 110000 })]);

    // Nothing was changed on the device it came from.
    expect((await shows(phone)).length).toBe(5); // 4 + the unnamed one, still here
    expect((await phone.AST.Store.listContacts()).length).toBe(1);
    expect(await phone.ST.importPreview()).toMatchObject({ shows: 0, sales: 0 });
  });

  it("a second device picks up every field the tracker has, not just the ones the platform knows", async () => {
    const phone = await existingDevice();
    await phone.ST.importExisting();
    await phone.settle();

    const laptop = await trackerDevice(server); // fresh install on the demo season
    await laptop.settle();
    const byName = Object.fromEntries((await shows(laptop)).map((s) => [s.name, s]));
    expect(Object.keys(byName).sort()).toEqual(
      ["Coconut Grove Arts Festival", "Naples National Art Festival", "Studio open house", "Winter Park Sidewalk Art Festival"],
    );
    expect(byName["Coconut Grove Arts Festival"]).toMatchObject({
      id: "6f1d6f50-3b0e-4a43-9c0a-1d0b9a3f7a01", status: "applied", rating: 8, juryFee: 40, boothFee: 650, routeNumber: "3",
      applyBy: "2026-10-15", lat: 25.7276, lng: -80.2417, catalogueId: "cat-coconut-grove", source: "catalogue",
      notes: "Jury results by Nov 20. Corner booths sell first.",
    });
    expect(byName["Winter Park Sidewalk Art Festival"]).toMatchObject({ status: "accepted", grossSales: 8200, boothFee: 395 });
    expect(byName["Naples National Art Festival"]).toMatchObject({ status: "waitlist", hidden: true, isAlternate: true, boothFee: null, url: "https://example.test/naples" });
    expect(byName["Studio open house"]).toMatchObject({ id: "id-lq3k9x-4f7a2b10", source: "manual", boothFee: null, startDate: "" });

    const bySale = Object.fromEntries((await sales(laptop)).map((s) => [s.piece, s]));
    expect(Object.keys(bySale).sort()).toEqual(["Gift print", "Heron at Dusk", "Studio sale: Egret"]);
    expect(bySale["Heron at Dusk"]).toMatchObject({ price: 1100, size: "24 x 36 in", medium: "Oil on panel", paymentMethod: "card", showId: "6f1d6f50-3b0e-4a43-9c0a-1d0b9a3f7a02" });
    expect(bySale["Gift print"]).toMatchObject({ price: null, notes: "Given to the organiser." });
    expect(bySale["Studio sale: Egret"]).toMatchObject({ price: 240.5, quantity: 2, showId: "" });
    expect(await laptop.AST.Store.listContacts()).toEqual([]);
  });

  it("running it twice creates nothing new, even after the page is reopened", async () => {
    const phone = await existingDevice();
    await phone.ST.importExisting();
    await phone.settle();
    const before = { shows: await count("shows"), artworks: await count("artworks"), log: await count("activity_log") };

    expect(await phone.ST.importExisting()).toMatchObject({ imported: { shows: 0, sales: 0 }, already: 7 });
    await phone.restart();
    expect(await phone.ST.importExisting()).toMatchObject({ imported: { shows: 0, sales: 0 }, already: 7 });
    await phone.settle();

    expect({ shows: await count("shows"), artworks: await count("artworks"), log: await count("activity_log") }).toEqual(before);
    expect(phone.ST.status().pending).toBe(0);
    expect((await phone.ST.importPreview()).doneAt).not.toBeNull();
  });

  it("two devices that already shared ids (the old sync) link up instead of doubling", async () => {
    const phone = await existingDevice();
    const laptop = await existingDevice(); // same saved data, same ids
    await phone.ST.importExisting();
    await phone.settle();
    await laptop.settle(); // pulls the phone's copy first

    const res = await laptop.ST.importExisting();
    expect(res.imported).toEqual({ shows: 0, sales: 0 });
    await laptop.settle(); await phone.settle();
    expect(await count("shows")).toBe(4);
    expect(await count("artworks")).toBe(3);
    expect((await shows(laptop)).length).toBe(5);
  });

  it("importing the moment the page opens still can't double anything up: it checks the studio first", async () => {
    const phone = await existingDevice();
    await phone.ST.importExisting();
    await phone.settle();
    const laptop = await existingDevice(); // just opened: hasn't pulled yet
    const res = await laptop.ST.importExisting();
    expect(res.imported).toEqual({ shows: 0, sales: 0 });
    expect(res.linked.shows + res.already).toBeGreaterThanOrEqual(4);
    await laptop.settle(); await phone.settle();
    expect(await count("shows")).toBe(4);
    expect(await count("artworks")).toBe(3);
  });

  it("offline, it refuses rather than guess what the studio already has", async () => {
    const phone = await existingDevice();
    phone.net.online = false;
    await expect(phone.ST.importExisting()).rejects.toThrow(/connection/i);
    expect(await count("shows")).toBe(0);
    phone.net.online = true;
    await expect(phone.ST.importExisting()).resolves.toMatchObject({ imported: { shows: 4, sales: 3 } });
  });

  it("an old pre-versioning save (a bare list of shows) imports with its ids and statuses", async () => {
    const d = await existingDevice(OLD_ARRAY);
    expect(await d.ST.importPreview()).toMatchObject({ shows: 2, sales: 0 });
    await d.ST.importExisting();
    await d.settle();
    const other = await trackerDevice(server);
    await other.settle();
    const got = Object.fromEntries((await shows(other)).map((s) => [s.id, s]));
    expect(got["old-1"]).toMatchObject({ name: "Mount Dora Arts Festival", status: "accepted", boothFee: 300, rating: 7 });
    expect(got["old-2"]).toMatchObject({ name: "Gasparilla Festival of the Arts", status: "interested", boothFee: 450 });
  });

  it("a device that still has only the demo season has nothing to import", async () => {
    const d = await trackerDevice(server);
    expect(await d.ST.importPreview()).toMatchObject({ demo: true, shows: 0, sales: 0 });
    expect(await d.ST.importExisting()).toMatchObject({ demo: true, imported: { shows: 0, sales: 0 } });
    await d.settle();
    expect(await count("shows")).toBe(0);
  });

  it("needs a signed-in studio", async () => {
    const d = await trackerDevice(server, { signedIn: false, localStorage: { [DB_KEY]: V11 } });
    await expect(d.ST.importExisting()).rejects.toThrow(/sign in/i);
  });
});
