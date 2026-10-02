import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every large card preview shows the whole printed card frame. A preview used to crop it: a box
// that clipped the corners (overflow hidden with an 8px radius), an object-fit cover into a 3:4 box,
// or a scale(1.075) that cut the border as the field does. jsdom does not lay out or paint, so these
// tests read the source.

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** The body of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.>]/g, "\\$&");
  const start = css.search(new RegExp(`^${escaped}\\s*\\{`, "m"));
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

const globals = read("app/globals.css");

// Components that put the card-frame class on the box that holds the art (the rule is global).
const FRAMED = [
  "src/components/duel/deck-card-preview.tsx",
  "src/components/decks/card-preview.tsx",
  "src/components/duel/inspector.tsx",
  "src/components/duel/pile-viewer.tsx",
  "src/components/draft/card-preview.tsx",
  "src/components/draft/draft-card-preview.tsx",
  "src/components/draft/card-hover-popup.tsx",
];

// The CSS modules of those components, for the rules of the art box and its image.
const MODULES: Record<string, string[]> = {
  "src/components/duel/deck-card-preview.module.css": [".art"],
  "src/components/decks/card-preview.module.css": [".art", ".art > img"],
  "src/components/duel/inspector.module.css": [".art", ".artBack"],
  "src/components/duel/pile-viewer.module.css": [".previewArt", ".previewBack"],
};

describe("card-frame rule", () => {
  it("shows the true card ratio, the whole image and a hairline radius", () => {
    const frame = rule(globals, ".card-frame");
    expect(frame).toMatch(/aspect-ratio:\s*421\s*\/\s*614/);
    expect(frame).not.toMatch(/overflow:\s*(hidden|clip)/);
    const radius = Number(/border-radius:\s*(\d+(?:\.\d+)?)px/.exec(frame)?.[1]);
    expect(radius).toBeLessThanOrEqual(3);

    const image = rule(globals, ".card-frame > img");
    expect(image).toMatch(/object-fit:\s*contain/);
    expect(image).not.toMatch(/object-fit:\s*cover/);
    expect(image).toMatch(/transform:\s*none/);
  });

  it.each(FRAMED)("%s uses the rule on its art box", (path) => {
    expect(read(path)).toContain("card-frame");
  });

  it.each(Object.entries(MODULES))("%s does not clip, crop or scale the card", (path, selectors) => {
    const css = read(path);
    for (const selector of selectors) {
      const body = rule(css, selector);
      expect(body, selector).not.toMatch(/overflow:\s*(hidden|clip)/);
      expect(body, selector).not.toMatch(/object-fit:\s*cover/);
      expect(body, selector).not.toMatch(/transform:\s*scale/);
      expect(body, selector).not.toMatch(/box-shadow:[^;]*\binset\b/);
      for (const [, px] of body.matchAll(/border-radius:\s*(\d+(?:\.\d+)?)px/g)) {
        expect(Number(px), `${selector} radius`).toBeLessThanOrEqual(3);
      }
    }
    // No rule on the image inside the art box may crop or scale it (the pile grid tiles are thumbnails).
    expect(css).not.toMatch(/\.previewArt\s+img/);
    if (!path.includes("pile-viewer")) expect(css).not.toMatch(/\.art\s+img\s*\{[^}]*(scale|object-fit:\s*cover)/);
  });

  it("keeps the Tailwind previews on the true ratio with an uncropped image", () => {
    const pick = read("src/components/draft/card-preview.tsx");
    expect(pick).not.toMatch(/aspect-\[3\/4\]|object-cover|overflow-hidden/);
    const side = read("src/components/draft/draft-card-preview.tsx");
    expect(side).not.toMatch(/overflow-hidden|rounded-(lg|xl)\b[^"]*bg-bg-elevated"\s*>/);
    const popup = read("src/components/draft/card-hover-popup.tsx");
    expect(popup).not.toMatch(/aspect-\[3\/4\]|rounded-t-xl/);
  });
});
