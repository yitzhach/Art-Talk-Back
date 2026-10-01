import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Studio, type StudioEvents } from "../src";
import { type Server, device, startServer } from "./server";

let server: Server;
let n = 0;

beforeAll(async () => { server = await startServer(); });
afterAll(async () => { await server?.dispose(); });

/** Signs a new device in as the owner (the first sign-in creates the studio). */
async function signedInDevice() {
  const d = device(server);
  const studio = await Studio.open({ baseUrl: "https://api.test", fetch: d.fetch, dbName: `device-${++n}` });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await studio.api.requestCode("owner@sdk.test");
  const code = /(\d{6})/.exec(String(log.mock.calls.at(-1)?.[0]))![1]!;
  log.mockRestore();
  await studio.api.verify("owner@sdk.test", code);
  await studio.sync();
  return { studio, net: d.net };
}

function events<K extends keyof StudioEvents>(studio: Studio, name: K) {
  const seen: StudioEvents[K][] = [];
  studio.on(name, (e) => seen.push(e));
  return seen;
}

describe("offline, then reconnect", () => {
  it("a sale logged with no signal reaches the other device", async () => {
    const phone = await signedInDevice();
    const laptop = await signedInDevice();

    // Set up while online, then the phone loses signal.
    const art = await phone.studio.create("artwork", { title: "Heron", priceCents: 120000 });
    const show = await phone.studio.create("show", { name: "Coconut Grove" });
    await phone.studio.sync();
    phone.net.online = false;

    await phone.studio.markSold(art.id!, { priceCents: 110000, showId: show.id! });
    expect((await phone.studio.get("artwork", art.id!))?.status).toBe("sold"); // shows at once
    await phone.studio.sync(); // fails quietly; stays queued
    expect(phone.studio.online).toBe(false);
    expect(await phone.studio.pendingCount()).toBe(1);

    phone.net.online = true;
    await phone.studio.sync();
    expect(await phone.studio.pendingCount()).toBe(0);

    await laptop.studio.sync();
    expect((await laptop.studio.get("artwork", art.id!))?.status).toBe("sold");
    const rows = await laptop.studio.list("show_artwork");
    expect(rows).toEqual([expect.objectContaining({ showId: show.id, outcome: "sold", soldPriceCents: 110000 })]);
  });

  it("records created offline keep their ids, and edits before the first sync fold into one change", async () => {
    const { studio, net } = await signedInDevice();
    net.online = false;
    const c = await studio.create("client", { name: "Hendersons" });
    await studio.update("client", c.id!, { notes: "Blues" });
    await studio.update("client", c.id!, { email: "ann@example.com" });
    expect(await studio.pendingCount()).toBe(1);
    net.online = true;
    await studio.sync();
    expect(await studio.get("client", c.id!)).toMatchObject({ id: c.id, name: "Hendersons", notes: "Blues", email: "ann@example.com", version: 1 });
  });

  it("deleting something that never reached the server sends nothing", async () => {
    const { studio, net } = await signedInDevice();
    net.online = false;
    const a = await studio.create("artwork", { title: "Draft" });
    await studio.remove("artwork", a.id!);
    expect(await studio.pendingCount()).toBe(0);
    expect(await studio.get("artwork", a.id!)).toBeNull();
  });

  it("a lost response is retried safely: no duplicate", async () => {
    const { studio } = await signedInDevice();
    let drop = true;
    // Same session; the server applies the push, but the reply never arrives.
    const base = (studio.api as unknown as { fetchFn: typeof fetch }).fetchFn;
    (studio.api as unknown as { fetchFn: typeof fetch }).fetchFn = async (input, init) => {
      const res = await base(input, init);
      if (drop && String(input).includes("/sync/push")) { drop = false; throw new TypeError("connection reset"); }
      return res;
    };
    const a = await studio.create("artwork", { title: "Once" });
    await studio.sync();
    expect(await studio.pendingCount()).toBe(1); // still queued: the device never heard back
    await studio.sync();
    expect(await studio.pendingCount()).toBe(0);
    const count = await server.DB.prepare("SELECT COUNT(*) AS n FROM artworks WHERE id = ?").bind(a.id).first<number>("n");
    expect(count).toBe(1);
  });
});

describe("two devices edit the same record offline", () => {
  async function both() {
    const phone = await signedInDevice();
    const laptop = await signedInDevice();
    const art = await phone.studio.create("artwork", { title: "Heron", priceCents: 1000 });
    await phone.studio.sync();
    await laptop.studio.sync();
    phone.net.online = false;
    laptop.net.online = false;
    return { phone, laptop, id: art.id! };
  }

  it("different fields: both changes land", async () => {
    const { phone, laptop, id } = await both();
    await phone.studio.update("artwork", id, { medium: "Oil" });
    await laptop.studio.update("artwork", id, { year: 2026 });
    for (const d of [laptop, phone]) { d.net.online = true; await d.studio.sync(); }
    await laptop.studio.sync();
    for (const d of [phone, laptop]) {
      expect(await d.studio.get("artwork", id)).toMatchObject({ medium: "Oil", year: 2026, version: 3 });
    }
  });

  it("same field: the first to sync wins, the other gets a review card", async () => {
    const { phone, laptop, id } = await both();
    const cards = events(phone.studio, "conflict");
    await laptop.studio.update("artwork", id, { title: "Laptop title" });
    await phone.studio.update("artwork", id, { title: "Phone title" });
    laptop.net.online = true; await laptop.studio.sync();
    phone.net.online = true; await phone.studio.sync();

    expect(cards).toEqual([expect.objectContaining({
      entityType: "artwork", entityId: id,
      conflicts: [{ field: "title", serverValue: "Laptop title", deviceValue: "Phone title" }],
    })]);
    expect((await phone.studio.get("artwork", id))?.title).toBe("Laptop title");
  });

  it("a price change from a device that's behind becomes a review card, not a silent overwrite", async () => {
    const { phone, laptop, id } = await both();
    const cards = events(phone.studio, "conflict");
    await laptop.studio.update("artwork", id, { title: "Renamed" });
    await phone.studio.update("artwork", id, { priceCents: 2500 });
    laptop.net.online = true; await laptop.studio.sync();
    phone.net.online = true; await phone.studio.sync();
    expect(cards[0]?.conflicts.map((c) => c.field)).toEqual(["priceCents"]);
    expect(await phone.studio.get("artwork", id)).toMatchObject({ priceCents: 1000, title: "Renamed" });
  });

  it("a delete on one device removes the record on the other", async () => {
    const { phone, laptop, id } = await both();
    laptop.net.online = true;
    await laptop.studio.remove("artwork", id);
    await laptop.studio.sync();
    phone.net.online = true;
    await phone.studio.sync();
    expect(await phone.studio.get("artwork", id)).toBeNull();
    expect((await phone.studio.list("artwork")).map((a) => a.id)).not.toContain(id);
  });
});

describe("background sync errors", () => {
  it("a sync that fails for a reason other than being offline (signed out) raises an error event", async () => {
    const d = device(server);
    const studio = await Studio.open({ baseUrl: "https://api.test", fetch: d.fetch, dbName: `device-${++n}` });
    const errors = events(studio, "error");
    studio.start(60_000);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect((errors[0]!.error as { status: number }).status).toBe(401);
    studio.close();
  });
});
