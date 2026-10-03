// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TierLine } from "@/components/rank/tier-line";

afterEach(cleanup);

describe("TierLine", () => {
  it("is one image with the label you give it and the progress as a variable", () => {
    render(<TierLine tier="Gold" value={0.336} label="84 of 250 Elo through Gold" />);
    const line = screen.getByRole("img", { name: "84 of 250 Elo through Gold" });
    expect(line.style.getPropertyValue("--f")).toBe("0.336");
    expect(line.style.getPropertyValue("--tier")).toBe("var(--t-gold)");
  });

  it("clamps the value to the line and maps Platinum and Diamond to their tier colours", () => {
    const { rerender } = render(<TierLine tier="Platinum" value={3} label="a" />);
    expect(screen.getByRole("img").style.getPropertyValue("--f")).toBe("1");
    expect(screen.getByRole("img").style.getPropertyValue("--tier")).toBe("var(--t-plat)");
    rerender(<TierLine tier="Diamond" value={-1} label="a" />);
    expect(screen.getByRole("img").style.getPropertyValue("--f")).toBe("0");
    expect(screen.getByRole("img").style.getPropertyValue("--tier")).toBe("var(--t-dia)");
    rerender(<TierLine tier="Unknown" value={Number.NaN} label="a" />);
    expect(screen.getByRole("img").style.getPropertyValue("--f")).toBe("0");
  });
});
