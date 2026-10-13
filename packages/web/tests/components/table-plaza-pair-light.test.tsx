// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import postcss, { type Rule } from "postcss";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { linkIdOf } from "@/components/duel/field";
import { FFA3_FIXTURES, ffa3Variant } from "@/components/duel/table/fixtures/ffa3";
import { type TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(cleanup);

function Shell({ state }: { state: TableFixtureState }) {
  const controller = useFixtureController(state, { reducedMotion: true });
  return <TableShell controller={controller} />;
}

const paired = ffa3Variant(FFA3_FIXTURES, { out: [], pair: true });
const asSeat = (state: TableFixtureState, seat: number): TableFixtureState => ({ ...state, room: { ...state.room, mySeat: seat } }) as TableFixtureState;

const css = readFileSync(join(__dirname, "../../src/components/duel/field.module.css"), "utf8");
const rules = postcss.parse(css).nodes.filter((node): node is Rule => node.type === "rule");
const IDS = ["0-1-5", "0-1-6", "2-3-5", "2-3-6"];

describe("both cells of a linked Extra Monster Zone carry one id", () => {
  it("names a pair of cells from either seat: the lower seat first, the zone mirrored for the other", () => {
    expect(linkIdOf(0, 1, 5)).toBe("0-1-5");
    expect(linkIdOf(1, 0, 6)).toBe("0-1-5");
    expect(linkIdOf(0, 1, 6)).toBe("0-1-6");
    expect(linkIdOf(1, 0, 5)).toBe("0-1-6");
    expect(linkIdOf(2, 3, 5)).toBe("2-3-5");
    expect(linkIdOf(3, 2, 5)).toBe("2-3-6");
  });

  it("gives seat 0 zone 5 and seat 1 zone 6 the same id (and zone 6 / zone 5 the other), never one on seat 2, for any viewer", () => {
    for (const state of [paired.states.main, asSeat(paired.states.main, 1), asSeat(paired.states.main, 2), paired.states.spectator]) {
      const { container, unmount } = render(<Shell state={state} />);
      const id = (seat: number, seq: number) => container.querySelector(`[data-testid="seat-field-${seat}"] [data-link-seq="${seq}"]`)!.getAttribute("data-link-id");
      expect(id(0, 5)).toBe("0-1-5");
      expect(id(1, 6)).toBe("0-1-5");
      expect(id(0, 6)).toBe("0-1-6");
      expect(id(1, 5)).toBe("0-1-6");
      expect(container.querySelectorAll('[data-testid="seat-field-2"] [data-link-id]')).toHaveLength(0);
      // Exactly two cells share each id, so a rule on the id lights the zone you point at and its partner, nothing else.
      for (const key of ["0-1-5", "0-1-6"]) expect(container.querySelectorAll(`[data-link-id="${key}"]`)).toHaveLength(2);
      unmount();
    }
  });
});

describe("the pair light in field.module.css", () => {
  const rulesFor = (key: string, subject: string) => rules.filter((rule) => rule.selectors.some((selector) => selector.endsWith(`[data-link-id="${key}"] ${subject}`)));

  it("lights every cell of the id on hover or keyboard focus of any cell of the id, at the same strength", () => {
    for (const key of IDS) {
      const found = rulesFor(key, ".frame");
      expect(found, key).toHaveLength(1);
      const selector = found[0].selectors.find((entry) => entry.endsWith(`[data-link-id="${key}"] .frame`))!;
      // The trigger is any cell of the id (hover) or inside any cell of the id (focus-visible); the subject is every cell of the id.
      expect(selector).toContain(`:has([data-link-id="${key}"]:hover, [data-link-id="${key}"] :focus-visible)`);
      // No light that outlives a click, and no light tied to one seat.
      expect(selector).not.toMatch(/:focus-within|:focus(?!-visible)|:active/);
      expect(selector).not.toContain("data-seat-field");
      const declared = new Map<string, string>();
      found[0].walkDecls((decl) => void declared.set(decl.prop, decl.value));
      expect(declared.get("box-shadow")).toMatch(/0\.75/);
      expect(declared.get("border-color")).toBeTruthy();
      expect(declared.get("opacity")).toBe("1");
      expect(declared.get("filter")).toBe("none");
    }
  });

  it("is the same light for the four ids, and the stage can reach a partner field in another subtree", () => {
    const declarations = IDS.map((key) => rulesFor(key, ".frame")[0]).map((rule) => rule.nodes.map((node) => node.toString()).join(";"));
    expect(new Set(declarations).size).toBe(1);
    // All four ids share one rule (one declaration block): compare the rule objects themselves.
    expect(new Set(IDS.map((key) => rulesFor(key, ".frame")[0])).size).toBe(1);
    expect(rulesFor("0-1-5", ".frame")[0].selectors.every((selector) => selector.startsWith(":global([data-table-stage]):has("))).toBe(true);
  });

  it("keeps the rest tint calm and the transition off under reduced motion", () => {
    const rest = rules.find((rule) => rule.selector === ".zone[data-link] .frame")!;
    expect(rest.toString()).toMatch(/0\.4\)/);
    expect(rules.some((rule) => rule.selector === ':global([data-reduced="true"]) .zone[data-link] .frame' && /transition:\s*none/.test(rule.toString()))).toBe(true);
    const media = postcss.parse(css).nodes.filter((node) => node.type === "atrule" && /prefers-reduced-motion:\s*reduce/.test((node as postcss.AtRule).params));
    expect(media.some((node) => /\.zone\[data-link\] \.frame\s*\{\s*transition:\s*none/.test(node.toString()))).toBe(true);
  });
});
