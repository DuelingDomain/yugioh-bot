// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeckSegmented } from "@/components/decks/controls";

afterEach(cleanup);

const choices = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
  { value: "text", label: "Text" },
] as const;

describe("DeckSegmented indicator", () => {
  it("carries the option count and the selected index for the sliding box", () => {
    const { rerender } = render(<DeckSegmented label="View" value="list" choices={choices} onChange={() => {}} />);
    const group = screen.getByRole("group", { name: "View" });
    expect(group).toHaveAttribute("data-slide", "");
    expect(group.style.getPropertyValue("--seg-n")).toBe("3");
    expect(group.style.getPropertyValue("--seg-i")).toBe("1");
    rerender(<DeckSegmented label="View" value="text" choices={choices} onChange={() => {}} />);
    expect(group.style.getPropertyValue("--seg-i")).toBe("2");
  });

  it("keeps the full-width grid layout next to the indicator variables", () => {
    render(<DeckSegmented label="View" value="grid" choices={choices} onChange={() => {}} full />);
    const group = screen.getByRole("group", { name: "View" });
    expect(group.style.display).toBe("grid");
    expect(group.style.getPropertyValue("--seg-n")).toBe("3");
  });
});
