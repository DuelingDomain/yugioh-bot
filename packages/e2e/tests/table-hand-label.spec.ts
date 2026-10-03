import { test, expect } from "@playwright/test";

for (const format of ["ffa3", "ffa4"]) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    test(`${format}: six-card hand leaves the own field name clear at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      const response = await page.goto(`/dev/table-preview/${format}?fixture=review&state=main&reduced=1`);
      expect(response?.ok()).toBe(true);
      await expect(page.locator("[data-table-stage]")).toHaveAttribute("data-ready", "true");
      await page.evaluate(() => document.fonts.ready);
      const own = page.locator('[data-seat-field="0"]');
      const name = own.locator("[data-seat-name]");
      const cards = own.locator('[data-hand-seat="0"] [data-kind="hand"] [data-card-art]');
      await expect(name).toHaveText("E2E Alice");
      await expect(name).toBeInViewport({ ratio: 1 });
      await expect(cards).toHaveCount(6);
      const label = await name.boundingBox();
      expect(label).not.toBeNull();
      for (const card of await cards.all()) {
        const art = await card.boundingBox();
        expect(art).not.toBeNull();
        const overlaps = label!.x < art!.x + art!.width
          && art!.x < label!.x + label!.width
          && label!.y < art!.y + art!.height
          && art!.y < label!.y + label!.height;
        expect(overlaps, `field name overlaps a hand card: ${JSON.stringify({ label, art })}`).toBe(false);
      }
      expect(errors).toEqual([]);
      await info.attach("hand-label", { body: await page.screenshot(), contentType: "image/png" });
    });
  }
}
