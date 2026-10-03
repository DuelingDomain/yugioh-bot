// @vitest-environment jsdom
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOTION_KEY, effectiveMotion, isMotion, readStoredMotion, useAnimations } from "@/components/tournament/fx/use-animations";

function Probe() {
  const { motion, reduced, set } = useAnimations();
  return (
    <div>
      <output data-testid="motion">{motion}</output>
      <output data-testid="reduced">{String(reduced)}</output>
      <button onClick={() => set("off")}>off</button>
    </div>
  );
}
const media = (matches: boolean) => vi.stubGlobal("matchMedia", vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
beforeEach(() => { localStorage.clear(); media(false); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe("animation levels", () => {
  it("knows the three levels and nothing else", () => {
    expect(["full", "calm", "off"].every(isMotion)).toBe(true);
    expect(isMotion("max")).toBe(false);
  });

  it("reduced motion turns Full into Calm and leaves Off alone", () => {
    expect(effectiveMotion("full", true)).toBe("calm");
    expect(effectiveMotion("calm", true)).toBe("calm");
    expect(effectiveMotion("off", true)).toBe("off");
    expect(effectiveMotion("full", false)).toBe("full");
  });

  it("starts on Full, reads the stored choice, and ignores junk", () => {
    localStorage.setItem(MOTION_KEY, "banana");
    expect(readStoredMotion()).toBeNull();
    localStorage.setItem(MOTION_KEY, "calm");
    render(<Probe />);
    expect(screen.getByTestId("motion")).toHaveTextContent("calm");
  });

  it("stores a new choice under yd-anim", () => {
    render(<Probe />);
    expect(screen.getByTestId("motion")).toHaveTextContent("full");
    act(() => screen.getByText("off").click());
    expect(screen.getByTestId("motion")).toHaveTextContent("off");
    expect(localStorage.getItem("yd-anim")).toBe("off");
  });

  it("follows the system setting for reduced motion", () => {
    media(true);
    render(<Probe />);
    expect(screen.getByTestId("reduced")).toHaveTextContent("true");
    expect(screen.getByTestId("motion")).toHaveTextContent("calm");
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => render(<Probe />)).not.toThrow();
    expect(screen.getByTestId("motion")).toHaveTextContent("full");
  });
});
