// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DeckCardInfo } from "@yugidraft/shared/duels";
import { TYPE_LINK, TYPE_MONSTER, TYPE_SPELL } from "../../src/components/duel/constants";
import { MonsterLevelsChart, mainMonsterLevels } from "../../src/components/decks/levels-chart";
import { DeckSizeMeter } from "../../src/components/decks/size-meter";
import { copyProblemText } from "../../src/components/decks/deck-check";
import styles from "../../src/components/decks/editor.module.css";

describe("deck size meter", () => {
  it.each([
    ["Main", 41, 40, 60, "in", "Main 41 cards. Tables want 40 to 60."],
    ["Main", 33, 40, 60, "short", "Main 33 cards. Tables want 40 to 60."],
    ["Main", 61, 40, 60, "over", "Main 61 cards. Tables want 40 to 60."],
    ["Extra", 17, 0, 15, "over", "Extra 17 cards. Tables want up to 15."],
    ["Extra", 1, 0, 15, "in", "Extra 1 card. Tables want up to 15."],
    ["Main", 58, 60, 60, "short", "Main 58 cards. Tables want exactly 60."],
    ["Main", 60, 60, 60, "in", "Main 60 cards. Tables want exactly 60."],
    ["Main", 29, 30, 60, "short", "Main 29 cards. Tables want 30 to 60."],
  ] as const)("labels %s at %i and gives it the %s state", (title, count, minimum, maximum, state, label) => {
    render(<DeckSizeMeter title={title} count={count} minimum={minimum} maximum={maximum} />);
    const meter = screen.getByRole("meter", { name: label });
    expect(meter).toHaveAttribute("data-state", state);
    expect(meter).toHaveAttribute("aria-valuenow", String(count));
    // The two ticks mark the legal range on a bar that ends at the larger of the maximum and the count.
    const top = Math.max(maximum, count);
    const ticks = Array.from(meter.querySelectorAll<HTMLElement>(".sv-size-tick"), (tick) => tick.style.left);
    expect(ticks).toEqual([`${(minimum / top) * 100}%`, `${(maximum / top) * 100}%`]);
  });
});

function monster(code: number, level: number, type = TYPE_MONSTER): DeckCardInfo {
  return { code, name: `Card ${code}`, type, level, description: "", attack: 0, defense: 0, attribute: 0, race: "", alias: 0, setcodes: [], lscale: 0, rscale: 0, arrows: 0, ot: 3 };
}

describe("main deck monster levels", () => {
  it("groups levels 1–4, 5–6 and 7+, counts copies, and excludes Links and non-monsters", () => {
    const cards = [monster(1, 1), monster(4, 4), monster(5, 5), monster(6, 6), monster(7, 7), monster(8, 8), monster(9, 12), monster(10, 0, TYPE_MONSTER | TYPE_LINK), monster(11, 3, TYPE_MONSTER | TYPE_LINK), monster(12, 8, TYPE_SPELL), monster(13, 0)];
    const catalog = new Map(cards.map((card) => [card.code, card]));
    const codes = [1, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 999];
    expect(mainMonsterLevels(codes, catalog)).toEqual([2, 0, 0, 1, 1, 1, 1, 2]);
    render(<MonsterLevelsChart codes={codes} catalog={catalog} />);
    const chart = screen.getByRole("img", { name: /3 need no tribute, 2 need one tribute, 3 need two tributes/ });
    expect(chart).toHaveAccessibleName(/Level 8\+: 2/);
    const bands = within(chart.querySelector<HTMLElement>(`.${styles["df-lv-c"]}`)!);
    expect(bands.getByText("No tribute")).toHaveTextContent("No tribute 3");
    expect(bands.getByText("1 tribute")).toHaveTextContent("1 tribute 2");
    expect(bands.getByText("2 tributes")).toHaveTextContent("2 tributes 3");
  });

  it("provides three visual tribute totals below the bars without repeating the accessible label", () => {
    const cards = [monster(1, 4), monster(2, 5), monster(3, 8)];
    render(<MonsterLevelsChart codes={[1, 1, 2, 3, 3, 3]} catalog={new Map(cards.map((card) => [card.code, card]))} />);
    const chart = screen.getByRole("img", { name: /2 need no tribute, 1 need one tribute, 3 need two tributes/ });
    const totals = within(chart).getByRole("list", { hidden: true });
    expect(totals).toHaveAttribute("aria-hidden", "true");
    expect(within(totals).getAllByRole("listitem", { hidden: true }).map((item) => item.textContent)).toEqual([
      "No tribute 2", "1 tribute 1", "2 tributes 3",
    ]);
    expect(totals.previousElementSibling).toHaveClass(styles["df-lv-c"]);
    expect(chart.querySelectorAll(`.${styles["df-bars"]} > span`)).toHaveLength(8);
    expect(within(chart).queryByRole("list")).toBeNull();
  });
});

describe("copy problem text", () => {
  it("uses the singular for a Forbidden copy", () => {
    expect(copyProblemText({ key: "pot", name: "Pot of Greed", count: 1, max: 0 }, "TCG September 2026")).toBe("1 copy, Forbidden");
    expect(copyProblemText({ key: "blue", name: "Blue-Eyes White Dragon", count: 3, max: 2 }, "TCG September 2026")).toBe("3 copies, 2 allowed on TCG September 2026");
  });
});
