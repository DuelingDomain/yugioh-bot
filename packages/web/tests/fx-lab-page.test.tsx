// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import { loadAnimationSpeed, setAnimationSpeed } from "@/components/duel/animation-speed";
import FxLabPage from "../app/dev/fx-lab/page";
import { FxLab } from "@/components/duel/fx-lab/lab";
import { LAB_CATEGORIES, LAB_SCENARIOS } from "@/components/duel/fx-lab/scenarios";
import { fxLabEnabled, isFxLabPublicPath } from "@/lib/fx-lab";

afterEach(() => {
  cleanup();
  setAnimationSpeed(1);
  vi.unstubAllEnvs();
  notFound.mockClear();
});

describe("fx lab page", () => {
  it("returns notFound without the env var", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DUEL_FX_LAB", "");
    expect(fxLabEnabled()).toBe(false);
    expect(() => FxLabPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("renders the lab with DUEL_FX_LAB=1", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DUEL_FX_LAB", "1");
    expect(fxLabEnabled()).toBe(true);
    const element = FxLabPage();
    expect(notFound).not.toHaveBeenCalled();
    render(element);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("uses the saved room slider alongside the review speed presets", () => {
    render(<FxLab />);
    const slider = screen.getByRole("slider", { name: /Animation speed/ });
    fireEvent.change(slider, { target: { value: "2" } });
    expect(loadAnimationSpeed()).toBe(2);
    expect(screen.getByText(/at 2.00x/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "0.5x" }));
    expect(screen.queryByText(/at 2.00x/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Reduced motion"));
    expect(slider).toHaveValue("2");
    expect(screen.queryByText(/at 2.00x/)).not.toBeInTheDocument();
  });

  it("lists every scenario under its category and offers the speeds", () => {
    render(<FxLab />);
    for (const category of LAB_CATEGORIES) expect(screen.getByRole("heading", { name: category })).toBeTruthy();
    for (const scenario of LAB_SCENARIOS) expect(screen.getAllByText(scenario.name).length).toBeGreaterThan(0);
    for (const label of ["1x", "0.5x", "0.25x"]) expect(screen.getByRole("button", { name: label })).toBeTruthy();
    expect(screen.getByLabelText("Reduced motion")).toBeTruthy();
    expect(screen.getByLabelText("Loop")).toBeTruthy();
  });
});

describe("fx lab public paths", () => {
  it("names only the page and the card art route", () => {
    expect(isFxLabPublicPath("/dev/fx-lab")).toBe(true);
    expect(isFxLabPublicPath("/api/cards/89631139/image")).toBe(true);
    expect(isFxLabPublicPath("/duel/card-back-main-hd.webp")).toBe(true);
    expect(isFxLabPublicPath("/duel/x/card-back.webp")).toBe(false);
    expect(isFxLabPublicPath("/duel/coin/89631139.jpg")).toBe(true);
    expect(isFxLabPublicPath("/duel/coin/x/89631139.jpg")).toBe(false);
    expect(isFxLabPublicPath("/api/cards/resolve")).toBe(false);
    expect(isFxLabPublicPath("/dev/fx-lab/x")).toBe(false);
  });
});
