import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The duel layer order is one scale of --duel-z-* tokens (app/globals.css). These tests read the
// stylesheets, because jsdom does not lay out or stack anything.

const web = fileURLToPath(new URL("../../", import.meta.url));
const duel = join(web, "src/components/duel");
const read = (path: string) => readFileSync(path, "utf8");
const duelCss = (name: string) => read(join(duel, name));

function tokens(): Record<string, number> {
  const css = read(join(web, "app/globals.css"));
  const out: Record<string, number> = {};
  for (const match of css.matchAll(/--duel-z-([a-z-]+):\s*(\d+)\s*;/g)) out[match[1]] = Number(match[2]);
  return out;
}

/** The first z-index declared by a top-level rule that has `selector` (a class) in its selector list. */
function zOf(css: string, selector: string): string | null {
  const re = new RegExp(`^(?:[^\\n{}]*,\\s*)?${selector.replace(".", "\\.")}\\s*[,{]`, "gm");
  for (const match of css.matchAll(re)) {
    const body = css.slice(match.index, css.indexOf("}", match.index));
    const z = /z-index:\s*([^;]+);/.exec(body)?.[1].trim();
    if (z) return z;
  }
  return null;
}

describe("duel layer tokens", () => {
  it("order the layers: board < board FX < prompts < menus < modals < result", () => {
    const t = tokens();
    const order = ["board", "fx", "fx-front", "prompt", "prompt-front", "tooltip", "menu", "confirm", "modal", "result"];
    expect(Object.keys(t)).toEqual(order);
    for (let i = 1; i < order.length; i++) expect(t[order[i]], `${order[i]} above ${order[i - 1]}`).toBeGreaterThan(t[order[i - 1]]);
  });

  it("keep every board FX layer below the prompt layers", () => {
    const t = tokens();
    expect(t["fx-front"]).toBeLessThan(t.prompt);
    // Room for a sublayer under a token without a clash with the next one.
    expect(t.prompt - t["fx-front"]).toBeGreaterThan(1);
  });
});

describe("duel layers use the tokens", () => {
  const cases: Array<readonly [file: string, selector: string, expected: string]> = [
    // Board FX: the aim arrow and attack play, equip link lines, chain badges, card flights, banners, Deck Master return.
    ["battle-fx.module.css", ".layer", "var(--duel-z-fx-front)"],
    ["equip-fx.module.css", ".layer", "var(--duel-z-fx)"],
    ["chain-fx.module.css", ".layer", "var(--duel-z-fx)"],
    ["move-fx.module.css", ".layer", "var(--duel-z-fx)"],
    ["summon-fx.module.css", ".layer", "var(--duel-z-fx)"],
    ["position-fx.module.css", ".layer", "var(--duel-z-fx)"],
    ["feedback.module.css", ".overlay", "var(--duel-z-fx-front)"],
    ["master-return-fx.module.css", ".layer", "var(--duel-z-fx-front)"],
    // What the player reads or clicks.
    ["prompt-center.module.css", ".layer", "var(--duel-z-prompt)"],
    ["pile-viewer.module.css", ".root", "var(--duel-z-prompt-front)"],
    ["room.module.css", ".promptDock", "var(--duel-z-prompt)"],
    ["room.module.css", ".board", "var(--duel-z-board)"],
    // Portals above the board.
    ["room.module.css", ".cardMenu", "var(--duel-z-menu)"],
    ["room.module.css", ".cardTooltip", "var(--duel-z-tooltip)"],
    ["battle-fx.module.css", ".confirm", "var(--duel-z-confirm)"],
    ["series.module.css", ".sideSheet", "var(--duel-z-modal)"],
    ["duel-result.module.css", ".root", "var(--duel-z-result)"],
  ];

  it.each(cases)("%s %s", (file, selector, expected) => {
    expect(zOf(duelCss(file), selector)).toBe(expected);
  });

  it("leaves no raw z-index of 10 or more in the duel stylesheets (lab chrome aside)", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(duel).filter((file) => file.endsWith(".css"))) {
      read(join(duel, name)).split("\n").forEach((line, index) => {
        if (/z-index:\s*\d{2,}\b/.test(line)) offenders.push(`${name}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("does not render board FX in a portal at the page root", () => {
    // A fixed layer in a root portal sits above the whole board stacking context, prompts included.
    for (const file of ["battle-fx.tsx", "master-return-fx.tsx"]) {
      expect(read(join(duel, file)), file).not.toMatch(/createPortal|document\.body\.appendChild/);
    }
    expect(read(join(duel, "destroy-fx.tsx"))).not.toMatch(/document\.body\.appendChild/);
  });
});
