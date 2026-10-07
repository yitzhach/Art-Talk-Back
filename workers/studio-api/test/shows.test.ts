import { describe, expect, it } from "vitest";
import { call, makeStudio, rowCount } from "./helpers";

async function setup() {
  const a = await makeStudio();
  const art = (await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "Heron", priceCents: 120000 } })).data;
  const show = (await call("/v1/shows", { method: "POST", cookie: a.cookie, json: { name: "Coconut Grove", startsOn: "2026-02-14", feeCents: 65000 } })).data;
  const client = (await call("/v1/clients", { method: "POST", cookie: a.cookie, json: { name: "The Hendersons" } })).data;
  return { a, art, show, client };
}
const act = (cookie: string, name: string, json: unknown) => call(`/v1/actions/${name}`, { method: "POST", cookie, json });

describe("shows", () => {
  it("CRUD like other records, with dates and the fee in cents", async () => {
    const { a, show } = await setup();
    expect(show).toMatchObject({ name: "Coconut Grove", startsOn: "2026-02-14", feeCents: 65000, status: "planned", version: 1 });
    expect((await call("/v1/shows", { method: "POST", cookie: a.cookie, json: { name: "x", startsOn: "Feb 14" } })).status).toBe(400);
    const up = await call(`/v1/shows/${show.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": "1" }, json: { status: "accepted", booth: "B12" } });
    expect(up.data).toMatchObject({ status: "accepted", booth: "B12", version: 2 });
    expect((await call("/v1/shows?status=accepted", { cookie: a.cookie })).data.items).toHaveLength(1);
  });

  it("tracks which artworks went, and the show page lists them", async () => {
    const { a, art, show } = await setup();
    const added = await act(a.cookie, "show.add_artwork", { showId: show.id, artworkId: art.id });
    expect(added.data.result).toMatchObject({ outcome: "brought", showId: show.id, artworkId: art.id });
    expect((await act(a.cookie, "show.add_artwork", { showId: show.id, artworkId: art.id })).status).toBe(400);
    const detail = (await call(`/v1/shows/${show.id}`, { cookie: a.cookie })).data;
    expect(detail.artworks.map((x: any) => x.artworkId)).toEqual([art.id]);

    await act(a.cookie, "show.remove_artwork", { showId: show.id, artworkId: art.id });
    expect((await call(`/v1/shows/${show.id}`, { cookie: a.cookie })).data.artworks).toEqual([]);
  });
});

describe("artwork.mark_sold", () => {
  it("updates the artwork and the show in one batch, and records the sale", async () => {
    const { a, art, show, client } = await setup();
    await act(a.cookie, "show.add_artwork", { showId: show.id, artworkId: art.id });
    const sold = await act(a.cookie, "artwork.mark_sold", { artworkId: art.id, priceCents: 110000, showId: show.id, clientId: client.id });
    expect(sold.status).toBe(200);
    expect(sold.data.activityIds).toHaveLength(2);

    const artNow = (await call(`/v1/artworks/${art.id}`, { cookie: a.cookie })).data;
    expect(artNow).toMatchObject({ status: "sold", meta: { sale: { priceCents: 110000, clientId: client.id, showId: show.id } } });
    expect(artNow.priceCents).toBe(120000); // list price untouched
    const row = (await call(`/v1/shows/${show.id}`, { cookie: a.cookie })).data.artworks[0];
    expect(row).toMatchObject({ outcome: "sold", soldPriceCents: 110000, clientId: client.id });
    expect(row.soldAt).toBeTruthy();
  });

  it("works when the artwork wasn't listed at the show yet, and without a show", async () => {
    const { a, art, show } = await setup();
    expect((await act(a.cookie, "artwork.mark_sold", { artworkId: art.id, priceCents: 5000, showId: show.id })).status).toBe(200);
    expect((await call(`/v1/shows/${show.id}`, { cookie: a.cookie })).data.artworks[0].outcome).toBe("sold");

    const other = (await call("/v1/artworks", { method: "POST", cookie: a.cookie, json: { title: "Egret" } })).data;
    const res = await act(a.cookie, "artwork.mark_sold", { artworkId: other.id, priceCents: 9000 });
    expect(res.data.result.showArtwork).toBeNull();
  });

  it("refuses to sell twice, a stale version, money as a decimal, and a sold artwork's removal", async () => {
    const { a, art, show } = await setup();
    expect((await act(a.cookie, "artwork.mark_sold", { artworkId: art.id, priceCents: 1, version: 9 })).status).toBe(409);
    expect((await act(a.cookie, "artwork.mark_sold", { artworkId: art.id, priceCents: 10.5 })).status).toBe(400);
    await act(a.cookie, "artwork.mark_sold", { artworkId: art.id, priceCents: 1000, showId: show.id });
    expect((await act(a.cookie, "artwork.mark_sold", { artworkId: art.id, priceCents: 1000 })).status).toBe(409);
    expect((await act(a.cookie, "show.remove_artwork", { showId: show.id, artworkId: art.id })).status).toBe(409);
  });

  it("one undo reverts the whole sale (D-027), and undoing that puts it back", async () => {
    const { a, art, show } = await setup();
    await act(a.cookie, "show.add_artwork", { showId: show.id, artworkId: art.id });
    const sold = await act(a.cookie, "artwork.mark_sold", { artworkId: art.id, priceCents: 1000, showId: show.id });
    const undo = await call(`/v1/activity/${sold.data.activityIds[1]}/undo`, { method: "POST", cookie: a.cookie });
    expect(undo.status).toBe(200);
    expect(undo.data.activityIds).toHaveLength(2);
    expect((await call(`/v1/artworks/${art.id}`, { cookie: a.cookie })).data.status).toBe("available");
    expect((await call(`/v1/shows/${show.id}`, { cookie: a.cookie })).data.artworks[0]).toMatchObject({ outcome: "brought", soldAt: null });

    const redo = await call(`/v1/activity/${undo.data.activityIds[0]}/undo`, { method: "POST", cookie: a.cookie });
    expect(redo.status).toBe(200);
    expect((await call(`/v1/artworks/${art.id}`, { cookie: a.cookie })).data.status).toBe("sold");
  });

  it("undo of a sale is all or nothing when one record changed since", async () => {
    const { a, art, show } = await setup();
    const sold = await act(a.cookie, "artwork.mark_sold", { artworkId: art.id, priceCents: 1000, showId: show.id });
    const v = (await call(`/v1/artworks/${art.id}`, { cookie: a.cookie })).data.version;
    await call(`/v1/artworks/${art.id}`, { method: "PATCH", cookie: a.cookie, headers: { "If-Match": String(v) }, json: { title: "Renamed" } });
    expect((await call(`/v1/activity/${sold.data.activityIds[0]}/undo`, { method: "POST", cookie: a.cookie })).status).toBe(409);
    expect((await call(`/v1/shows/${show.id}`, { cookie: a.cookie })).data.artworks[0].outcome).toBe("sold");
    expect(await rowCount("SELECT COUNT(*) AS n FROM activity_log WHERE undone_at IS NOT NULL AND studio_id = ?", a.studioId)).toBe(0);
  });
});

describe("shows by date, for find_shows (D-076)", () => {
  async function seed() {
    const a = await makeStudio();
    const add = (json: Record<string, unknown>) => call("/v1/shows", { method: "POST", cookie: a.cookie, json }).then((r) => r.data);
    await add({ name: "Mount Dora", startsOn: "2026-11-07", feeCents: 45000, meta: { applyBy: "2026-10-12", url: "https://example.test/md", juryFeeCents: 3500, trackerStatus: "interested" } });
    await add({ name: "Naples", startsOn: "2027-01-10", meta: { applyBy: "2026-10-09" } });
    await add({ name: "Applied already", status: "applied", meta: { applyBy: "2026-10-10" } });
    await add({ name: "Hidden one", meta: { applyBy: "2026-10-10", hidden: true } });
    await add({ name: "Loose date", meta: { applyBy: "mid October" } });
    await add({ name: "No dates" });
    return a;
  }
  const names = (r: { data: { items: { name: string }[] } }) => r.data.items.map((s) => s.name);

  it("the week's apply-by dates, soonest first, by status; hidden and unparseable dates left out", async () => {
    const a = await seed();
    const week = await call("/v1/shows/dates?by=applyBy&from=2026-10-07&to=2026-10-14&status=planned", { cookie: a.cookie });
    expect(week.status).toBe(200);
    expect(names(week)).toEqual(["Naples", "Mount Dora"]);
    expect(week.data.items[1]).toMatchObject({
      applyBy: "2026-10-12", startsOn: "2026-11-07", url: "https://example.test/md", feeCents: 45000, juryFeeCents: 3500,
      trackerStatus: "interested", status: "planned", version: 1,
    });
    expect(names(await call("/v1/shows/dates?from=2026-10-07&to=2026-10-14&status=planned,applied", { cookie: a.cookie })))
      .toEqual(["Naples", "Applied already", "Mount Dora"]);
  });

  it("by start date; without a range every visible show comes back, undated last", async () => {
    const a = await seed();
    expect(names(await call("/v1/shows/dates?by=startsOn&from=2026-11-01", { cookie: a.cookie }))).toEqual(["Mount Dora", "Naples"]);
    const all = names(await call("/v1/shows/dates", { cookie: a.cookie }));
    expect(all.slice(0, 3)).toEqual(["Naples", "Applied already", "Mount Dora"]);
    expect(all).toHaveLength(5);
    expect(all).not.toContain("Hidden one");
  });

  it("refuses an unknown status or a date that isn't YYYY-MM-DD", async () => {
    const a = await makeStudio();
    expect((await call("/v1/shows/dates?status=interested", { cookie: a.cookie })).status).toBe(400);
    expect((await call("/v1/shows/dates?from=10/7", { cookie: a.cookie })).status).toBe(400);
  });
});
