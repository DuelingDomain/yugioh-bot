// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type Root } from "postcss";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InvitePanel } from "../../src/components/draft/lobby/invite-panel";
import { PoolBreakdown } from "../../src/components/draft/pool-breakdown";
import chipStyles from "../../src/components/draft/summary/chips.module.css";
import lobbyStyles from "../../src/components/draft/lobby/lobby.module.css";

const source = (file: string) => readFileSync(path.resolve(__dirname, `../../src/${file}`), "utf8");
const summary = postcss.parse(source("components/draft/summary/summary.module.css"));
const chips = postcss.parse(source("components/draft/summary/chips.module.css"));
const lobby = postcss.parse(source("components/draft/lobby/lobby.module.css"));

/** Inspect the rules that apply to a given .ms size container; jsdom has no layout engine. */
function declarations(root: Root, selector: string | string[], width = 1440): Record<string, string> {
  const values: Record<string, string> = {};
  const selectors = Array.isArray(selector) ? selector : [selector];
  root.walkRules((rule) => {
    if (!rule.selectors.some((candidate) => selectors.includes(candidate))) return;
    for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
      if (parent.type !== "atrule") continue;
      if (parent.name === "media") return;
      if (parent.name === "container") {
        const limit = /\((max|min)-width:\s*(\d+)px\)/.exec(parent.params);
        if (!limit) throw new Error(`Unsupported container query: ${parent.params}`);
        if (limit[1] === "max" ? width > Number(limit[2]) : width < Number(limit[2])) return;
      }
    }
    rule.walkDecls((declaration) => { values[declaration.prop] = declaration.value; });
  });
  return values;
}

describe("draft layout rules", () => {
  it("keeps the chips under the tally on the left and the levels chart on the right at 1440px", () => {
    expect(declarations(summary, ".poolHead", 1440)["grid-template-columns"]).toBe("minmax(0, 1fr) minmax(0, 330px)");
    expect(declarations(summary, ".poolHead > .tally", 1440)["grid-area"]).toBe("1 / 1");
    expect(declarations(summary, ".poolHead > .chipRow", 1440)["grid-area"]).toBe("2 / 1");
    expect(declarations(summary, ".poolHead > .lv", 1440)["grid-area"]).toBe("1 / 2 / 3 / 3");
  });

  it("stacks the tally, chip rows and levels in DOM order at 390px using the size container", () => {
    expect(declarations(summary, ".poolHead", 390)["grid-template-columns"]).toBe("minmax(0, 1fr)");
    for (const child of [".tally", ".chipRow", ".lv"]) {
      expect(declarations(summary, `.poolHead > ${child}`, 390)["grid-area"]).toBe("auto");
    }
  });

  it("lets both chip rows wrap and shrink within their column", () => {
    for (const selector of [".row", ".list"]) {
      expect(declarations(chips, selector)["flex-wrap"]).toBe("wrap");
      expect(declarations(chips, selector)["min-width"]).toBe("0");
    }
  });

  it("renders small plain row labels, round 7px dots and bold counts", () => {
    render(<PoolBreakdown variant="sheet" cards={[{
      id: 1, name: "Monster", type: "Normal Monster", attribute: "DARK", frameType: "normal",
      effectText: "", imageUrl: "", imageUrlSmall: "",
    }]} />);
    const attributes = screen.getByRole("list", { name: "Attributes drafted" });
    expect(attributes.previousElementSibling).toHaveClass(chipStyles.label);
    expect(attributes.firstElementChild!.firstElementChild).toHaveClass(chipStyles.dot);
    expect(declarations(chips, ".label")).toMatchObject({ color: "var(--ink-3)", "font-size": "12px" });
    expect(declarations(chips, ".dot")).toMatchObject({ width: "7px", height: "7px", "border-radius": "50%" });
    expect(declarations(chips, ".list b").font).toBe("600 14px/1 var(--f-num)");
  });

  it("places theme shortfalls below the counts with and without a card fan", () => {
    expect(declarations(lobby, ".th")["grid-template-areas"]).toBe('"fan n x" "fan m x" "fan p p" "fan a a"');
    expect(declarations(lobby, ".th[data-nofan]")["grid-template-areas"]).toBe('"n x" "m x" "p p" "a a"');
    expect(declarations(lobby, ".thProblems")).toMatchObject({ "grid-area": "p", "min-width": "0" });
    expect(declarations(lobby, ".themes")["grid-template-columns"]).toBe("repeat(auto-fill, minmax(min(100%, 300px), 1fr))");
    expect(declarations(lobby, ".shortfall")).toMatchObject({ "font-size": "12.5px", "overflow-wrap": "anywhere" });
    expect(declarations(lobby, '.shortfall[data-kind="main"]').color).toBe("var(--loss-ink)");
    expect(declarations(lobby, '.shortfall[data-kind="extra"]').color).toBe("var(--chain-ink)");
    expect(declarations(lobby, ".shortfall::before")).toMatchObject({ width: "5px", height: "5px", "border-radius": "50%", background: "currentColor" });
  });

  it("gives main shortfalls a red border that wins over the Extra warning border", () => {
    expect(declarations(lobby, ".th[data-bad]")["border-color"]).toBe("rgb(228 90 77 / 0.45)");
    expect(declarations(lobby, [".th[data-warn]", ".th[data-bad]"])["border-color"]).toBe("rgb(228 90 77 / 0.45)");
  });

  it("keeps the Discord join code on one line", () => {
    render(<InvitePanel slug="s" />);
    expect(screen.getByText("/draft join")).toHaveClass("cmd", lobbyStyles.joinCommand);
    expect(declarations(lobby, ".joinCommand")["white-space"]).toBe("nowrap");
  });
});
