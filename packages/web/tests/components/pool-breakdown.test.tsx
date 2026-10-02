// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CardSummary } from "../../src/lib/card-types";
import { PoolBreakdown } from "../../src/components/draft/pool-breakdown";

const card = (type: string, attribute?: string): CardSummary => ({
  id: 1, name: type, type, attribute, frameType: "", effectText: "", imageUrl: "", imageUrlSmall: "",
});
const cards = [
  card("Effect Monster", "DARK"), card("Effect Monster", "DARK"), card("Normal Monster", "LIGHT"),
  card("Ritual Monster", "EARTH"), card("Ritual Effect Monster", "EARTH"),
  card("Spell Card", "SPELL"), card("Trap Card", "TRAP"), card("Skill Card"),
];

describe("PoolBreakdown sheet variant", () => {
  it("labels two wrapping lists with sentence case attributes and merged monster types", () => {
    render(<PoolBreakdown variant="sheet" cards={cards} />);
    const attrs = screen.getByRole("list", { name: "Attributes drafted" });
    expect(attrs.previousElementSibling).toHaveTextContent("Attribute");
    expect(attrs.previousElementSibling).not.toHaveClass("chip");
    expect(within(attrs).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Dark 2", "Earth 2", "Light 1"]);
    const types = screen.getByRole("list", { name: "Monster kinds drafted" });
    expect(types.previousElementSibling).toHaveTextContent("Monsters");
    expect(within(types).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Effect 2", "Ritual 2", "Normal 1"]);
    for (const item of screen.getAllByRole("listitem")) {
      expect(item).toHaveClass("chip");
      expect(item.querySelector("b")).not.toBeNull();
    }
  });

  it("uses all seven attribute colors on decorative dots before the names", () => {
    const attributes = [
      ["DARK", "Dark", "#9b7eff"], ["LIGHT", "Light", "#f2d16b"], ["EARTH", "Earth", "#c79a5b"],
      ["WATER", "Water", "#5aa9e6"], ["FIRE", "Fire", "#ef7a45"], ["WIND", "Wind", "#5cc98a"], ["DIVINE", "Divine", "#e0b84e"],
    ];
    render(<PoolBreakdown variant="sheet" cards={attributes.map(([attribute]) => card("Effect Monster", attribute))} />);
    const items = within(screen.getByRole("list", { name: "Attributes drafted" })).getAllByRole("listitem");
    for (const [, name, color] of attributes) {
      const chip = items.find((item) => item.textContent === `${name} 1`)!;
      expect(chip.firstElementChild).toHaveAttribute("aria-hidden", "true");
      expect(chip.firstElementChild).toHaveStyle({ backgroundColor: color });
    }
  });

  it("omits monster types for spell-, trap- and skill-only pools", () => {
    const { container } = render(<PoolBreakdown variant="sheet" cards={[card("Spell Card", "SPELL"), card("Trap Card", "TRAP"), card("Skill Card")]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty pool", () => {
    const { container } = render(<PoolBreakdown variant="sheet" cards={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PoolBreakdown default variant", () => {
  it.each([undefined, "default"] as const)("preserves the existing markup for variant %s", (variant) => {
    const { container } = render(<PoolBreakdown variant={variant} cards={cards} />);
    expect(container.firstElementChild).toHaveClass("flex", "flex-col", "gap-2");
    const attrs = screen.getByLabelText("Attributes drafted");
    expect(attrs.tagName).toBe("DIV");
    expect(attrs.children[0]).toHaveTextContent("DARK2");
    expect(attrs.children[0]).toHaveClass("inline-flex", "bg-bg-elevated", "text-xs");
    const types = screen.getByLabelText("Types drafted");
    expect([...types.children].map((item) => item.textContent)).toEqual([
      "Effect Monster2", "Normal Monster1", "Ritual Effect Monster1", "Ritual Monster1", "Skill Card1", "Spell Card1", "Trap Card1",
    ]);
    expect(screen.queryByText("Attribute")).not.toBeInTheDocument();
    expect(screen.queryByText("Monsters")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
