import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const duelDir = resolve(__dirname, "..", "public", "duel");
const kinds = ["main", "extra"] as const;

describe("original card back assets", () => {
  for (const kind of kinds) {
    const svgPath = resolve(duelDir, `card-back-${kind}.svg`);
    const webpPath = resolve(duelDir, `card-back-${kind}-hd.webp`);

    it(`${kind}: SVG source and WebP render exist`, () => {
      expect(existsSync(svgPath)).toBe(true);
      expect(existsSync(webpPath)).toBe(true);
    });

    it(`${kind}: WebP has the 421:614 card aspect at 1394x2031`, async () => {
      const meta = await sharp(webpPath).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(1394);
      expect(meta.height).toBe(2031);
      expect(Math.abs(meta.width! / meta.height! - 421 / 614)).toBeLessThan(0.001);
    });

    it(`${kind}: SVG is 421:614 with no text and no official marks`, () => {
      const svg = readFileSync(svgPath, "utf8");
      expect(svg).toContain('viewBox="0 0 421 614"');
      expect(svg).not.toMatch(/<text[\s>]|<tspan[\s>]|<image[\s>]|<foreignObject[\s>]/i);
      expect(svg).not.toMatch(/konami|yu-?gi-?oh/i);
    });
  }

  it("the 3D effects load the same SVG as the field card back", () => {
    const src = readFileSync(resolve(__dirname, "..", "src/components/duel/fx3d/effects/wipes/common.ts"), "utf8");
    expect(src).toContain('"/duel/card-back-main.svg"');
  });
});
