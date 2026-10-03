// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BugReportFab } from "@/components/bug-report/bug-report-fab";
import { BugFabLift, liftFor } from "@/components/bug-report/fab-lift";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("liftFor", () => {
  const rect = (top: number, height: number) => ({ top, bottom: top + height, height });

  it("lifts a stuck bar's height plus a gap above the button's bottom offset", () => {
    // 844px tall screen, a 100px bar stuck to the bottom: top 744.
    expect(liftFor(rect(744, 100), "sticky", 844)).toBe(100 + 8 - 12);
  });

  it("lifts for a fixed bar too", () => {
    expect(liftFor(rect(764, 80), "fixed", 844)).toBe(80 + 8 - 12);
  });

  it("does not lift when the bar is not sticky or fixed (desktop column)", () => {
    expect(liftFor(rect(744, 100), "static", 844)).toBe(0);
  });

  it("does not lift when the bar sits above the button's corner (scrolled to the end)", () => {
    expect(liftFor(rect(500, 100), "sticky", 844)).toBe(0);
  });

  it("does not lift for a hidden bar", () => {
    expect(liftFor(rect(844, 0), "sticky", 844)).toBe(0);
  });
});

describe("the Report bug button over a bottom bar", () => {
  it("lifts above a registered bar and drops back when the bar goes", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-bar") ? ({ top: 744, bottom: 844, height: 100, left: 0, right: 390, width: 390, x: 0, y: 744, toJSON() {} } as DOMRect) : ({ top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {} } as DOMRect);
    });
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(844);
    const { rerender } = render(<><BugReportFab /><BugFabLift data-bar style={{ position: "sticky" }}>Create draft</BugFabLift></>);
    const button = screen.getByRole("button", { name: "Report bug" });
    expect(button.style.bottom).toContain("96px");
    act(() => rerender(<BugReportFab />));
    expect(screen.getByRole("button", { name: "Report bug" }).style.bottom).toBe("");
  });

  it("stays at its place when no bar is registered", () => {
    render(<BugReportFab />);
    expect(screen.getByRole("button", { name: "Report bug" }).style.bottom).toBe("");
  });
});
