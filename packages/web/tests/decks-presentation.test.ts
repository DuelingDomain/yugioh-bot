import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// jsdom cannot evaluate container queries or the foundation's CSS cascade.
const editor = readFileSync(new URL("../src/components/decks/editor.module.css", import.meta.url), "utf8");
const browser = readFileSync(new URL("../src/components/decks/card-browser.module.css", import.meta.url), "utf8");
const phoneStart = editor.indexOf("@container de-editor (width < 960px)");
const desktop = editor.slice(0, phoneStart);
const phone = editor.slice(phoneStart);

describe("list rows on a phone", () => {
  it.each(["cubes/cubes.module.css", "decks/library.module.css"])("hides the Open button above the kit's .ms .sv-btn display rule (%s)", (file) => {
    const css = readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");
    expect(css).toMatch(/:global\(\.ms\)\s+:global\(\.sv-btn\)\.openBtn\s*\{[^}]*display:\s*none/);
  });
});

describe("deck editor presentation", () => {
  it("scopes both tab visibility rules to beat the foundation's .ms .seg", () => {
    expect(desktop).toMatch(/:global\(\.ms\)\s+\.de-tabs\s*\{[^}]*display:\s*none/);
    expect(phone).toMatch(/:global\(\.ms\)\s+\.de-tabs\s*\{[^}]*display:\s*grid/);
  });

  it("scopes phone button sizing and hiding to beat the kit's .ms .sv-btn", () => {
    expect(phone).toMatch(/:global\(\.ms\)\s+\.de-back\s*\{[^}]*width:\s*34px;[^}]*height:\s*44px;[^}]*padding:\s*0/);
    expect(phone).toMatch(/:global\(\.ms\)\s+:global\(\.sv-btn\)\.de-export\s*\{[^}]*display:\s*none/);
    expect(phone).toMatch(/:global\(\.ms\)\s+\.de-clear\s+:global\(\.sv-btn\.quiet\)\s*\{[^}]*width:\s*38px;[^}]*padding:\s*0/);
  });

  it("lets draft hosts fill the viewport below their measured top without a frame", () => {
    const host = /\.host\[data-pool\]\s*\{([^}]*)\}/.exec(editor)?.[1] ?? "";
    expect(host).toMatch(/height:\s*calc\(100dvh - var\(--de-top,\s*0px\)\)/);
    expect(host).toMatch(/min-height:\s*560px/);
    expect(host).toMatch(/border:\s*0/);
    expect(host).toMatch(/border-radius:\s*0/);
    expect(/\.host\s*\{([^}]*)\}/.exec(editor)?.[1]).toMatch(/height:\s*100dvh/);
  });

  it("does not cancel shell padding: a draft deck page owns its bar and the shell drops its padding", () => {
    const host = /\.host\[data-pool\]\s*\{([^}]*)\}/.exec(editor)?.[1] ?? "";
    expect(host).not.toMatch(/margin:\s*-/);
    expect(host).not.toMatch(/width:\s*calc\(100% \+/);
    expect(editor).toMatch(/\.de-menu\s*\{[^}]*display:\s*none/);
    expect(phone).toMatch(/\.de-menu\s*\{[^}]*grid-column:\s*3[^}]*display:\s*grid/);
  });

  it("switches tribute totals to a list using the chart's own width", () => {
    expect(editor).toMatch(/\.df-lv\s*\{[^}]*container:\s*de-levels\s*\/\s*inline-size/);
    expect(editor).toMatch(/\.df-totals\s*\{[^}]*display:\s*none/);
    const narrowChart = /@container de-levels \(width < 240px\)\s*\{([\s\S]*?)\n\}/.exec(editor)?.[1] ?? "";
    expect(narrowChart).toMatch(/\.df-bt\s*\{[^}]*display:\s*none/);
    expect(narrowChart).toMatch(/\.df-totals\s*\{[^}]*display:\s*grid/);
    expect(editor).toMatch(/\.df-totals li\s*\{[^}]*justify-content:\s*space-between/);
  });

  it("reserves space for the search placeholder and drops the hint in narrow fields", () => {
    expect(browser).toMatch(/\.de-lt\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(browser).toMatch(/\.de-q\s*\{[^}]*container:\s*de-search\s*\/\s*inline-size;[^}]*min-width:\s*min\(100%,\s*180px\)/);
    const narrowSearch = /@container de-search \(width < 200px\)\s*\{([\s\S]*?)\n\}/.exec(browser)?.[1] ?? "";
    expect(narrowSearch).toMatch(/\.de-q kbd\s*\{[^}]*display:\s*none/);
    expect(narrowSearch).toMatch(/:global\(\.ms\)\s+\.de-q\s+:global\(\.input\):placeholder-shown\s*\{[^}]*padding-right:\s*12px/);
  });
});
