// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RankGem, TierName } from "@/components/sheet/rank-gem";

describe("RankGem", () => {
  it("uses the global gem classes by size", () => {
    const cls = (size?: "sm" | "lg" | "xl") =>
      render(<RankGem tier="Gold" size={size} />).container.querySelector("svg")?.getAttribute("class");
    expect(cls()).toBe("gem");
    expect(cls("lg")).toBe("gem lg");
    expect(cls("xl")).toBe("gem xl");
  });

  it("draws Diamond with its own art and unknown tiers with the neutral gem", () => {
    const dia = render(<RankGem tier="Diamond" />).container;
    expect(dia.querySelector("linearGradient")).toBeNull();
    expect(dia.querySelectorAll("path").length).toBeGreaterThan(5);
    const unk = render(<RankGem tier="Mystery" />).container;
    expect(unk.querySelector("linearGradient")).not.toBeNull();
    expect(unk.querySelector("stop")?.getAttribute("stop-color")).toBe("#c7ccda");
  });
});

describe("TierName", () => {
  it("carries the tier on data-t with a gem and the name", () => {
    const { container } = render(<TierName tier="Platinum" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toBe("tier");
    expect(el.getAttribute("data-t")).toBe("Platinum");
    expect(el.querySelector("svg.gem")).not.toBeNull();
    expect(el.textContent).toBe("Platinum");
  });

  it("falls back to the neutral colour for an unknown tier, and can hide the gem", () => {
    const { container } = render(<TierName tier="Unranked" gem={false}>No rating yet</TierName>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("data-t")).toBe("none");
    expect(el.style.color).toBe("var(--t-none)");
    expect(el.querySelector("svg")).toBeNull();
    expect(el.textContent).toBe("No rating yet");
  });
});
