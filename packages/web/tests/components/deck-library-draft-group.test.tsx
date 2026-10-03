// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedDeck } from "@yugidraft/shared/duels";
import { SavedDeckLibrary } from "../../src/components/decks/library";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

afterEach(() => vi.unstubAllGlobals());

const base = { createdAt: "2026-09-30 12:00:00", updatedAt: "2026-09-30 12:00:00" };
const deck = (id: number, name: string, draftId?: number): SavedDeck => ({
  id, name, mode: "normal", deck: { main: [89631139], extra: [], side: [] }, ...(draftId ? { draftId } : {}), ...base,
});

describe("Decks library draft group", () => {
  it("lists decks made in a draft under Draft decks, apart from your own decks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      decks: [deck(1, "Goat"), deck(2, "Friday cube draft, 2026-10-03", 9)],
    })));
    render(<SavedDeckLibrary />);
    await screen.findByRole("link", { name: "Goat" });

    const mine = screen.getByRole("list", { name: "Saved decks" });
    const drafted = screen.getByRole("list", { name: "Draft decks" });
    expect(within(mine).getByRole("link", { name: "Goat" })).toBeInTheDocument();
    expect(within(mine).queryByText(/cube draft/)).toBeNull();
    expect(within(drafted).getByRole("link", { name: "Friday cube draft, 2026-10-03" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Draft decks" })).toBeInTheDocument();
  });

  it("shows no Draft decks group when there is none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ decks: [deck(1, "Goat")] })));
    render(<SavedDeckLibrary />);
    await screen.findByRole("link", { name: "Goat" });
    expect(screen.queryByRole("heading", { name: "Draft decks" })).toBeNull();
  });

  it("shows only the Draft decks group when every deck came from a draft", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ decks: [deck(2, "Cube draft, 2026-10-03", 9)] })));
    render(<SavedDeckLibrary />);
    await screen.findByRole("link", { name: "Cube draft, 2026-10-03" });
    expect(screen.queryByRole("list", { name: "Saved decks" })).toBeNull();
    expect(screen.getByRole("list", { name: "Draft decks" })).toBeInTheDocument();
  });
});
