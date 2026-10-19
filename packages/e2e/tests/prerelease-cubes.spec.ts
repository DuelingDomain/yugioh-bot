import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { duelDataDir, dbPath } from "../stack/env.mjs";
import { authFile } from "../helpers/players";

test.use({ storageState: authFile("p1") });
test.skip(process.env.E2E_PRERELEASE_CATALOG !== "1", "Run with the no-YGOPRODeck pre-release fixture.");

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`pre-release cube search, imports, images and deck browser at ${viewport.width}x${viewport.height}`, async ({ page, request }, info) => {
    const engine = new Database(join(duelDataDir, "cards.cdb"), { readonly: true });
    const previews = engine.prepare(`select d.id,t.name,d.type from datas d join texts t using(id)
      where (d.ot & 256)!=0 and d.alias=0 and (d.type & 16384)=0 order by d.id`).all() as Array<{ id: number; name: string; type: number }>;
    engine.close();
    const app = new Database(dbPath, { readonly: true });
    const publishedNames = new Set((app.prepare("select lower(trim(name)) as name from card_catalog where catalog_source='api'").all() as Array<{ name: string }>).map(card => card.name));
    app.close();
    const unlisted = previews.filter(card => !publishedNames.has(card.name.trim().toLowerCase()));
    const main = unlisted.find(card => !(card.type & (0x40 | 0x2000 | 0x800000 | 0x4000000)))!;
    const extra = unlisted.find(card => card.type & (0x40 | 0x2000 | 0x800000 | 0x4000000))!;
    expect(main).toBeDefined(); expect(extra).toBeDefined();
    const response = await request.post("/api/cubes", { data: { name: `Preview ${viewport.width} ${Date.now()}`, kind: "blank" } });
    expect(response.status()).toBe(201);
    const { cube } = await response.json();
    const resolved = await request.post("/api/cards/resolve", { data: { fuzzyName: main.name, includeExtra: true } });
    expect(resolved.status(), await resolved.text()).toBe(200);
    expect((await resolved.json()).cards.some((card: { id: number; prerelease: boolean }) => card.id === main.id && card.prerelease)).toBe(true);
    await page.setViewportSize(viewport);
    await page.goto(`/cubes/${cube.id}`);
    if (viewport.width < 700) await page.getByRole("button", { name: "Add cards", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Card name", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Card name", exact: true }).fill(main.name);
    const result = page.getByTestId("card-search-result").filter({ hasText: main.name });
    await expect(result).toHaveCount(1);
    await expect(result.getByText("Pre-release", { exact: true })).toBeVisible();
    const screenshot = async (name: string) => {
      const output = process.env.E2E_SCREENSHOT_DIR ?? info.outputDir;
      mkdirSync(output, { recursive: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await sharp(await page.screenshot({ fullPage: true })).webp({ quality: 85 }).toFile(join(output, `${name}-${viewport.width}x${viewport.height}.webp`));
    };
    await expect(result.locator("img")).toHaveJSProperty("complete", true);
    await screenshot("cube-search");
    await result.click();
    await expect.poll(async () => (await (await request.get(`/api/cubes/${cube.id}`)).json()).pools.main.length).toBe(1);
    // Name, raw passcode and YDK imports all use real CDB metadata, with API cardinfo reporting no match.
    for (const data of [
      { op: "importList", text: `2 ${main.name}\n1 ${extra.name}` },
      { op: "import", codes: [main.id, extra.id] },
      { op: "importYdk", text: `#created by prerelease e2e\n#main\n${main.id}\n#extra\n${extra.id}\n!side\n` },
    ]) {
      const imported = await request.post(`/api/cubes/${cube.id}/cards`, { data });
      expect(imported.status(), await imported.text()).toBe(200);
      const payload = await imported.json();
      expect(payload.unknown ?? payload.unknownIds ?? []).toEqual([]);
      expect(payload.pools.extra.map((card: { catalogCardId: number }) => card.catalogCardId)).toContain(extra.id);
      expect(payload.cards.find((card: { id: number }) => card.id === extra.id).prerelease).toBe(true);
    }
    for (const variant of ["full", "small", "cropped"]) {
      const image = await request.get(`/api/cards/${main.id}/image?variant=${variant}`);
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toBe("image/jpeg");
      expect((await image.body()).length).toBeGreaterThan(100);
    }
    await page.goto(`/cubes/${cube.id}`);
    await expect(page.getByRole("button", { name: new RegExp(`^${main.name},`) })).toBeVisible();
    await expect(page.getByText("Pre-release", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("The card search did not work.", { exact: true })).not.toBeVisible();
    await screenshot("cube-editor");
    await page.goto("/decks/new");
    if (viewport.width < 700) await page.getByRole("tab", { name: "Cards", exact: true }).click();
    await page.getByPlaceholder("Search cards", { exact: true }).fill(main.name);
    await page.getByRole("button", { name: "Card list with details", exact: true }).click();
    const deckResult = page.getByRole("button", { name: main.name, exact: true });
    await expect(deckResult).toBeVisible();
    await expect(deckResult.getByText("Pre-release", { exact: true })).toBeVisible();
    await screenshot("deck-search");
    const db = new Database(dbPath, { readonly: true });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });
}
