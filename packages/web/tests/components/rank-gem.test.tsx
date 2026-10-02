// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RankGem, TierName } from "@/components/rank/rank-gem";

describe("Match Sheet rank gems", () => {
  it.each(["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Unranked"])("names %s and hides its decorative SVG", (tier) => {
    const { container } = render(<TierName tier={tier} />);
    expect(screen.getByText(tier)).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("gives two instances of the same tier separate gradients and working fill references", () => {
    const { container } = render(<><RankGem tier="Gold" /><RankGem tier="Gold" /></>);
    const ids = [...container.querySelectorAll("linearGradient")].map((node) => node.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const fills = [...container.querySelectorAll("path[fill^='url']")].map((node) => node.getAttribute("fill"));
    expect(fills).toEqual(ids.map((id) => `url(#${id})`));
  });

  it("uses a grey gem for an unknown tier", () => {
    const { container } = render(<RankGem tier="Unknown" />);
    expect(container.querySelector("stop")).toHaveAttribute("stop-color", "#c7ccda");
  });

  it("draws Diamond's prismatic facets and corner sparkle", () => {
    const { container } = render(<RankGem tier="Diamond" />);
    expect(container.querySelector('path[fill="#8fe3ff"]')).not.toBeNull();
    expect(container.querySelector('path[fill="#ffb8ee"]')).not.toBeNull();
    expect(container.querySelector('path[d^="M20.6.4"]')).not.toBeNull();
  });
});
