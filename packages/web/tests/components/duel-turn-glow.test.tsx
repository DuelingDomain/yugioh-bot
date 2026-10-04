// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelEngineView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("@/components/duel/fx3d/loader", () => ({ loadFx3d: async () => null }));

import { DuelField } from "@/components/duel/field";
import { newBoard } from "@/components/duel/fx-lab/board";
import { resetPhaseBeats } from "@/components/duel/phase-beats";

afterEach(() => { cleanup(); resetPhaseBeats(); });

function view(extra: Partial<DuelEngineView> = {}): DuelEngineView {
  return { revision: 1, turn: 1, turnSeat: 0, phase: "main1", seats: newBoard().seats,
    prompt: null, chain: [], events: [], log: [], result: null, ...extra };
}
function field(engine: DuelEngineView, mySeat: number | null = 0) {
  return <DuelField engine={engine} mySeat={mySeat} masterRule={5} reducedMotion
    legalKeys={new Set()} selectedKeys={new Set()} onActivate={() => {}} onInspect={() => {}}
    bottomName="Yugi" topName="Kaiba" />;
}
const glow = (container: HTMLElement, side: "top" | "bottom") =>
  container.querySelector<HTMLElement>(`[data-turn-glow][data-side="${side}"]`)!;

describe("turn light", () => {
  it("lights only the bottom glow on your turn", () => {
    const { container } = render(field(view({ turnSeat: 0 })));
    expect(glow(container, "bottom").getAttribute("data-turn")).toBe("true");
    expect(glow(container, "top").getAttribute("data-turn")).toBe("false");
  });

  it("lights only the top glow on the opponent's turn, and follows a change of turn", () => {
    const { container, rerender } = render(field(view({ turnSeat: 1 })));
    expect(glow(container, "top").getAttribute("data-turn")).toBe("true");
    expect(glow(container, "bottom").getAttribute("data-turn")).toBe("false");
    rerender(field(view({ revision: 2, turn: 2, turnSeat: 0 })));
    expect(glow(container, "bottom").getAttribute("data-turn")).toBe("true");
    expect(glow(container, "top").getAttribute("data-turn")).toBe("false");
  });

  it("follows the seat at the bottom for a player in seat 1", () => {
    const { container } = render(field(view({ turnSeat: 1 }), 1));
    expect(glow(container, "bottom").getAttribute("data-turn")).toBe("true");
  });

  it("shows no light after the duel ends", () => {
    const { container } = render(field(view({ turnSeat: 0, result: { winnerSeat: 0, reason: "lp" } })));
    expect(container.querySelectorAll('[data-turn-glow][data-turn="true"]')).toHaveLength(0);
  });

  it("draws no outline path for the turn or the priority", () => {
    const { container } = render(field(view({ turnSeat: 0, prioritySeat: 0 })));
    expect(container.querySelector("svg path")).toBeNull();
    expect(container.querySelector("[data-field-signals]")).toBeNull();
  });
});

const readCss = (name: string) =>
  readFileSync(resolve(__dirname, `../../src/components/duel/${name}`), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Every declaration body of the rules in `css` whose selector list holds `selector`, whatever the spacing or order. */
const declsIn = (css: string, selector: string): string => {
  const norm = (value: string) => value.replace(/\s+/g, " ").trim();
  const found: string[] = [];
  for (const match of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    if (match[1].split(",").some((part) => norm(part) === selector)) found.push(match[2]);
  }
  return found.join(";");
};

describe("turn light style", () => {
  const css = readCss("field.module.css");
  const decls = (selector: string) => declsIn(css, selector);
  const rgbOf = (selector: string, name: string) => decls(selector).match(new RegExp(`${name}:\\s*([\\d ]+);`))?.[1]?.trim();

  it("has no stroke, border or outline on the glow", () => {
    for (const selector of [".turnGlow", '.turnGlow[data-side="top"]', ".turnGlow::before", ".turnGlow::after"]) {
      expect(decls(selector), selector).not.toMatch(/\b(border|outline|stroke)\b/);
    }
    expect(css).not.toMatch(/\.(turnEdge|priorityEdge)/);
  });

  it("gives each side its own colour", () => {
    const top = rgbOf('.turnGlow[data-side="top"]', "--tg-rgb");
    const bottom = rgbOf(".turnGlow", "--tg-rgb");
    expect(top).toBeTruthy();
    expect(bottom).toBeTruthy();
    expect(top).not.toBe(bottom);
  });

  it("shows the response window in a hue apart from both turn colours", () => {
    const hue = (rgb: string) => {
      const [r, g, b] = rgb.split(" ").map((value) => Number(value) / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (d === 0) return 0;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const gap = (a: string, b: string) => Math.min(Math.abs(hue(a) - hue(b)), 360 - Math.abs(hue(a) - hue(b)));
    const mine = rgbOf(".turnGlow", "--tg-rgb")!;
    const theirs = rgbOf('.turnGlow[data-side="top"]', "--tg-rgb")!;
    const priority = rgbOf(".turnGlow", "--tp-rgb")!;
    expect(priority).toBeTruthy();
    expect(gap(priority, mine)).toBeGreaterThan(40);
    expect(gap(priority, theirs)).toBeGreaterThan(40);
    expect(decls(".turnGlow::after")).toContain("var(--tp-rgb)");
  });

  it("fades in 0.3 to 0.4 seconds and stops when motion is reduced", () => {
    const seconds = Number(decls(".turnGlow::before").match(/transition:\s*opacity\s+([\d.]+)s/)?.[1]);
    expect(seconds).toBeGreaterThanOrEqual(0.3);
    expect(seconds).toBeLessThanOrEqual(0.4);
    expect(decls('.felt[data-reduced-motion="true"] .turnGlow::before')).toMatch(/transition:\s*none/);
  });

  it("also stops under the system reduced-motion setting", () => {
    const media = css.slice(css.indexOf("prefers-reduced-motion: reduce)", css.indexOf(".turnGlow::after")));
    expect(media.slice(0, 400)).toMatch(/\.turnGlow::before[\s\S]*?transition:\s*none/);
  });
});

describe("no outline-like turn signal is left", () => {
  const field = readCss("field.module.css");

  it("keeps the sheet the same for every seat of a 3-way, 4-way or Tag table", () => {
    expect(declsIn(field, '.seatField[data-turn="false"]')).toBe("");
    expect(declsIn(field, ".seatField:not([data-turn])")).toBe("");
    expect(declsIn(field, '.seatField[data-turn="true"]')).not.toMatch(/--sheet/);
  });

  it("shows the turn on the legacy seat boards and seat strip as a glow, not a border", () => {
    const board = declsIn(readCss("opponent-board.module.css"), '.board[data-active="true"]');
    const item = declsIn(readCss("seat-strip.module.css"), '.item[data-turn="true"]');
    for (const rule of [board, item]) {
      expect(rule).toMatch(/box-shadow:\s*0 0 \d+px/);
      expect(rule).not.toMatch(/border|outline/);
      expect(rule).not.toMatch(/inset/);
    }
  });

  it("gives the turn mat of a seat a wide soft glow", () => {
    expect(declsIn(field, '.seatField[data-turn="true"] .sfMat')).toMatch(/0 0 \d{2,3}px -\d+px/);
  });
});
