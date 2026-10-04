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

describe("turn light style", () => {
  const css = readFileSync(resolve(__dirname, "../../src/components/duel/field.module.css"), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return start < 0 ? "" : css.slice(start, css.indexOf("}", start));
  };

  it("has no stroke, border or outline on the glow", () => {
    for (const selector of [".turnGlow", '.turnGlow[data-side="top"]', ".turnGlow::before", ".turnGlow::after"]) {
      expect(block(selector)).not.toMatch(/\b(border|outline|stroke)\b/);
    }
    expect(css).not.toMatch(/\.(turnEdge|priorityEdge)/);
  });

  it("gives each side its own colour", () => {
    const top = block('.turnGlow[data-side="top"]').match(/--tg-rgb:\s*([\d ]+);/)?.[1];
    const bottom = block(".turnGlow").match(/--tg-rgb:\s*([\d ]+);/)?.[1];
    expect(top).toBeTruthy();
    expect(bottom).toBeTruthy();
    expect(top).not.toBe(bottom);
  });

  it("fades in 0.3 to 0.4 seconds and stops when motion is reduced", () => {
    expect(block(".turnGlow::before")).toMatch(/transition: opacity 0\.3[0-9]*s/);
    expect(css).toMatch(/\.felt\[data-reduced-motion="true"\] \.turnGlow::before[\s\S]*?transition: none/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*?\.turnGlow::before/);
  });
});
