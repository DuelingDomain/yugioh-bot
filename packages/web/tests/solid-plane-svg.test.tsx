// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlaneSvg, attackCurve } from "@/components/duel/solid/plane-svg";

describe("attackCurve", () => {
  it("starts and ends on the given points and bows to the right of the travel", () => {
    expect(attackCurve({ x: 0, y: 100 }, { x: 0, y: 0 })).toBe("M0 100 Q34 50 0 0");
  });

  it("is a single quadratic segment", () => {
    expect(attackCurve({ x: 10, y: 10 }, { x: 110, y: 10 })).toMatch(/^M10 10 Q[\d.]+ [\d.]+ 110 10$/);
  });
});

describe("PlaneSvg", () => {
  it("draws nothing without an aim", () => {
    const { container } = render(<div><PlaneSvg aim={null} /></div>);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.querySelector("path")).toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws nothing while another layer owns the arrow", () => {
    const aim = { mode: "aim" as const, from: "mz1", to: { zones: ["mz2"] } };
    const { container } = render(<div><PlaneSvg aim={aim} hidden /></div>);
    expect(container.querySelector("svg path")).toBeNull();
  });
});
