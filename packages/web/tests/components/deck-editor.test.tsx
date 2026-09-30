// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardQuery, DeckCardInfo } from "@yugidraft/shared/duels";
import { SavedDeckEditor } from "../../src/components/decks/editor";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/decks/new",
}));

function card(code: number, name: string, type: number, level = 0): DeckCardInfo {
  return {
    code,
    name,
    description: `${name} text.`,
    type,
    attack: 3000,
    defense: 2500,
    level,
    attribute: 0x10,
    race: "Dragon",
    alias: 0,
    setcodes: [],
    lscale: 0,
    rscale: 0,
    arrows: 0,
    ot: 3,
  };
}

const BLUE_EYES = card(89631139, "Blue-Eyes White Dragon", 0x11, 8);
const POT = card(55144522, "Pot of Greed", 0x2);
const CARDS = [BLUE_EYES, POT];
const queries: CardQuery[] = [];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/decks/cards/facets") {
      return Response.json({ archetypes: [], banlists: { "tcg-2026-09": { [POT.code]: 0 } } });
    }
    if (url === "/api/decks/cards") {
      const query = JSON.parse(String(init?.body)) as CardQuery;
      queries.push(query);
      const cards = CARDS.filter((entry) => entry.name.toLowerCase().includes(query.text.toLowerCase()));
      return Response.json({ cards, total: cards.length, offset: 0 });
    }
    if (url === "/api/duels/cards") {
      const { codes } = JSON.parse(String(init?.body)) as { codes: number[] };
      return Response.json({ cards: CARDS.filter((entry) => codes.includes(entry.code)), missing: [] });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }));
});

afterEach(() => {
  queries.length = 0;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

function mainCards() {
  return within(screen.getByRole("region", { name: "Main Deck" })).queryAllByRole("button", { name: /Main Deck card/ });
}

describe("SavedDeckEditor", () => {
  it("adds cards from the card list, stops at three copies and undoes", async () => {
    render(<SavedDeckEditor />);
    const tile = await screen.findByRole("button", { name: "Blue-Eyes White Dragon" });

    fireEvent.doubleClick(tile);
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Blue-Eyes White Dragon, 1 in deck/ }));
    fireEvent.doubleClick(screen.getByRole("button", { name: /^Blue-Eyes White Dragon, 2 in deck/ }));
    await waitFor(() => expect(mainCards()).toHaveLength(3));

    fireEvent.doubleClick(screen.getByRole("button", { name: /^Blue-Eyes White Dragon, 3 in deck/ }));
    expect(mainCards()).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("you already have 3 copies");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(mainCards()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(mainCards()).toHaveLength(3);

    fireEvent.contextMenu(mainCards()[0]!);
    expect(mainCards()).toHaveLength(2);
  });

  it("uses the chosen banlist for copy limits", async () => {
    render(<SavedDeckEditor />);
    await screen.findByRole("button", { name: "Pot of Greed" });

    fireEvent.change(screen.getByLabelText("Banlist"), { target: { value: "tcg-2026-09" } });
    const pot = await screen.findByRole("button", { name: "Pot of Greed, Forbidden" });
    fireEvent.doubleClick(pot);

    expect(mainCards()).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("Pot of Greed");
    expect(screen.getByRole("status")).toHaveTextContent("is Forbidden");
  });

  it("shows card text and deck controls for the selected card", async () => {
    render(<SavedDeckEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Blue-Eyes White Dragon" }));

    const details = screen.getByRole("complementary", { name: "Card details" });
    fireEvent.click(within(details).getByRole("button", { name: "Add one Blue-Eyes White Dragon to Side" }));
    expect(within(screen.getByRole("region", { name: "Side Deck" })).getAllByRole("button", { name: /Side Deck card/ })).toHaveLength(1);
    expect(mainCards()).toHaveLength(0);
  });

  it("undoes a format change", async () => {
    render(<SavedDeckEditor />);
    await screen.findByRole("button", { name: "Pot of Greed" });

    fireEvent.click(screen.getByRole("radio", { name: "Domain" }));
    expect(screen.getByRole("region", { name: "Deck Master" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("region", { name: "Deck Master" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Standard" })).toBeChecked();
  });

  it("sends the search text to the card query", async () => {
    render(<SavedDeckEditor />);
    await screen.findByRole("button", { name: "Pot of Greed" });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "pot" } });
    await waitFor(() => expect(queries.at(-1)?.text).toBe("pot"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Blue-Eyes White Dragon" })).toBeNull());
  });
});
