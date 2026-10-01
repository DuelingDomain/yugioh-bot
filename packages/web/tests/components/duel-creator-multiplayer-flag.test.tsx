// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { DuelCreator } from "@/components/duel/creator";

afterEach(() => cleanup());

describe("DuelCreator with the MULTIPLAYER_TABLES flag", () => {
  it("offers no table type when the flag is off (the default)", () => {
    render(<DuelCreator />);
    expect(screen.queryByLabelText("Table type")).toBeNull();
    expect(screen.queryByTestId("format-rule")).toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Tag|3-player|4-player|FFA/);
    expect(text).toMatch(/1v1/);
  });

  it("offers 1v1, Tag, 3-player and 4-player when the flag is on", () => {
    render(<DuelCreator multiplayerTables />);
    const picker = screen.getByLabelText("Table type") as HTMLSelectElement;
    expect([...picker.options].map((option) => option.value)).toEqual(["1v1", "tag", "ffa3", "ffa4"]);
  });
});
