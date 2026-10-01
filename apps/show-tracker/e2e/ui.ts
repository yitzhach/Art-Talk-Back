// Things the artist does, through the tracker's real screens.
import type { Page } from "playwright-core";

export interface ShowFields {
  name?: string; city?: string; state?: string; startDate?: string; endDate?: string; boothFee?: string; status?: string;
}
const FIELD_ID: Record<keyof ShowFields, string> = {
  name: "f_name", city: "f_city", state: "f_state", startDate: "f_startDate", endDate: "f_endDate", boothFee: "f_boothFee", status: "f_status",
};

async function fillForm(page: Page, fields: ShowFields) {
  for (const [k, v] of Object.entries(fields) as [keyof ShowFields, string][]) {
    if (k === "status") await page.selectOption(`#${FIELD_ID[k]}`, v);
    else await page.fill(`#${FIELD_ID[k]}`, v);
  }
  await page.click("#btnSave");
  // Saved = the drawer closed (the page writes, then closes), and the mirror to the studio has queued it.
  await page.waitForSelector("#drawer", { state: "hidden" });
  await page.evaluate(() => (window as any).ASTStudio?._flush());
}

export async function addShow(page: Page, fields: ShowFields & { name: string }) {
  await page.goto(new URL("index.html", page.url()).href);
  await page.click("#btnAdd");
  await fillForm(page, fields);
  await page.waitForFunction((n) => document.querySelector("#showList")!.textContent!.includes(n), fields.name);
}

export async function editShow(page: Page, name: string, fields: ShowFields) {
  await page.locator(".show-row", { hasText: name }).locator(".row-main").click();
  await fillForm(page, fields);
}

export const showRow = (page: Page, name: string) =>
  page.waitForFunction((n) => document.querySelector("#showList")!.textContent!.includes(n), name, { timeout: 20_000 });

/** The Money page's "Add sale" form. */
export async function logSale(page: Page, sale: { piece: string; price: string; showName?: string }) {
  await page.goto(new URL("expenses.html", page.url()).href);
  await page.waitForSelector("#saleAdd");
  await page.click("#saleAdd");
  await page.fill("#saPiece", sale.piece);
  await page.fill("#saPrice", sale.price);
  if (sale.showName) {
    const label = (await page.$$eval("#saShow option", (o) => o.map((x) => x.textContent!))).find((t) => t.includes(sale.showName!));
    if (!label) throw new Error(`no show called ${sale.showName} in the sale form`);
    await page.selectOption("#saShow", { label });
  }
  await page.click("#saSave");
}

export const saleRow = (page: Page, piece: string) =>
  page.waitForFunction((p) => document.querySelector("#saleList")!.textContent!.includes(p), piece, { timeout: 20_000 });

/** Read straight from the tracker's own store (what any screen would draw from). */
export const storeShow = (page: Page, name: string) =>
  page.evaluate(async (n) => (await (window as any).AST.Store.list()).find((s: any) => s.name === n) ?? null, name);
