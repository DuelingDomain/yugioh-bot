// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The stylesheet rule that hides the chain tower is run against real DOM: the CSS module's :global() wrappers are
// removed and `.tower` becomes a test id, so jsdom evaluates the very selector the room ships.
const hudCss = readFileSync(resolve(import.meta.dirname, "../../src/components/duel/table/grid-hud.module.css"), "utf8");
const hideRule = /\n(:global\(\[data-duel-fx-speed-root\]\):not[^{]*\.tower) \{ display: none; \}/.exec(hudCss);

function towerHidden(front: string): boolean {
  document.body.innerHTML = `
    <div data-duel-fx-speed-root>${front}<div data-testid="tower"></div></div>`;
  return getComputedStyle(document.querySelector('[data-testid="tower"]')!).display === "none";
}

const frontWith = (panel: string, attrs = "") => `<div data-chain-front="true" ${attrs}>${panel}</div>`;
const panel = (shape: string) => `<section data-chain-panel="true" data-shape="${shape}"></section>`;

describe("the rule that hides the chain tower", () => {
  afterEach(() => { document.head.querySelectorAll("style").forEach((node) => node.remove()); });

  it("keys on the panel element and the pile viewer", () => {
    expect(hideRule, "the tower rule").not.toBeNull();
    expect(hideRule![1]).toContain('[data-chain-panel][data-shape="wide"]');
    expect(hideRule![1]).toContain('[data-chain-panel][data-shape="narrow"]');
    expect(hideRule![1]).toContain("[data-pile-viewer]");
    expect(hideRule![1]).not.toContain("data-size");
  });

  const install = () => {
    const style = document.createElement("style");
    style.textContent = `${hideRule![1].replace(/:global\(((?:[^()]|\([^()]*\))*)\)/g, "$1").replace(/\.tower$/, '[data-testid="tower"]')} { display: none; }`;
    document.head.append(style);
  };

  it("hides the tower while the wide or narrow panel is on screen", () => {
    install();
    expect(towerHidden(frontWith(panel("wide"), 'data-size="wide"'))).toBe(true);
    expect(towerHidden(frontWith(panel("narrow"), 'data-size="narrow"'))).toBe(true);
  });

  it("keeps the tower in the strip form, before the first link and while the room is not measured", () => {
    install();
    expect(towerHidden(frontWith('<div data-chain-panel="true" data-chain-strip-wrap="true"></div>', 'data-size="strip"'))).toBe(false);
    // The size is still "wide" but no panel was drawn yet (no paced link): the chain shows in the tower.
    expect(towerHidden(frontWith("", 'data-size="wide"'))).toBe(false);
    expect(towerHidden(frontWith(panel("wide"), 'data-size="wide" data-room-ready="false"'))).toBe(false);
  });

  it("keeps the tower while the Graveyard viewer hides the front layer", () => {
    install();
    expect(towerHidden(frontWith(panel("wide"), 'data-size="wide" data-suspended="true"'))).toBe(false);
    expect(towerHidden(`${frontWith(panel("wide"), 'data-size="wide"')}<div data-pile-viewer="true"></div>`)).toBe(false);
  });
});
