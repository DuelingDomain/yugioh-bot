// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardQuery, DeckCardInfo, SavedDeck } from "@yugidraft/shared/duels";
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
const searchErrors: string[] = [];
const deleted: number[] = [];
let stored: SavedDeck | null = null;

function savedDeck(main: number[]): SavedDeck {
  return { id: 7, name: "Goat control", mode: "normal", deck: { main, extra: [], side: [] }, createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z" };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/decks/cards/facets") {
      return Response.json({ archetypes: [], banlists: { "tcg-2026-09": { [POT.code]: 0, [BLUE_EYES.code]: 2 } } });
    }
    if (url === "/api/decks/cards") {
      const query = JSON.parse(String(init?.body)) as CardQuery;
      queries.push(query);
      const error = searchErrors.shift();
      if (error) return Response.json({ error }, { status: 503 });
      const cards = CARDS.filter((entry) => entry.name.toLowerCase().includes(query.text.toLowerCase()));
      return Response.json({ cards, total: cards.length, offset: 0 });
    }
    if (url === "/api/duels/cards") {
      const { codes } = JSON.parse(String(init?.body)) as { codes: number[] };
      return Response.json({ cards: CARDS.filter((entry) => codes.includes(entry.code)), missing: [] });
    }
    if (url === "/api/decks/7" && init?.method === "DELETE") {
      deleted.push(7);
      return Response.json({ ok: true });
    }
    if (url === "/api/decks/7" && stored) return Response.json({ deck: stored });
    if (url === "/api/decks" && init?.method === "POST") {
      return Response.json({ deck: { ...savedDeck([]), ...JSON.parse(String(init.body)) } }, { status: 201 });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }));
});

afterEach(() => {
  queries.length = 0;
  searchErrors.length = 0;
  deleted.length = 0;
  stored = null;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

function mainCards() {
  return within(screen.getByRole("region", { name: "Main Deck" })).queryAllByRole("button", { name: /Main Deck card/ });
}

describe("SavedDeckEditor", () => {
  it.each([81480461, 81480462])("loads the original metadata for saved artwork %i without a card search", async (code) => {
    const base = card(81480460, "Barrel Dragon", 0x21, 7);
    const art = { ...base, code: 81480461, alias: base.code };
    const secondArt = { ...base, code: 81480462, alias: art.code };
    stored = savedDeck([code]);
    const fetch = vi.mocked(globalThis.fetch);
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url, init) => {
      if (url === "/api/duels/cards") {
        const { codes } = JSON.parse(String(init?.body)) as { codes: number[] };
        return Response.json({ cards: [base, art, secondArt].filter((entry) => codes.includes(entry.code)), missing: [] });
      }
      return original(url, init);
    });
    render(<SavedDeckEditor deckId="7" />);
    await screen.findByRole("button", { name: /Barrel Dragon, Main Deck card/ });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/duels/cards", expect.objectContaining({ body: JSON.stringify({ codes: [base.code] }) })));
  });
  it("counts a saved Barrel Dragon artwork against the canonical draft pool on load", async () => {
    const base = card(81480460, "Barrel Dragon", 0x21, 7);
    const art = { ...base, code: 81480461, alias: base.code };
    stored = { ...savedDeck([art.code]), draftId: 3 };
    const fetch = vi.mocked(globalThis.fetch);
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url, init) => {
      if (url === "/api/duels/cards") {
        const { codes } = JSON.parse(String(init?.body)) as { codes: number[] };
        return Response.json({ cards: [base, art].filter((entry) => codes.includes(entry.code)), missing: [] });
      }
      return original(url, init);
    });
    render(<SavedDeckEditor deckId="7" pool={{ slug: "retro", draftId: 3, draftName: "Retro draft", cards: [{ code: base.code, count: 1 }], mainPoolCount: 1, unresolved: [], savedDeckId: 7, registration: null }} />);
    const full = await screen.findByRole("button", { name: "Barrel Dragon, 0 copies left in your pool" });
    expect(screen.getByText("1 card in your pool")).toBeInTheDocument();
    expect(screen.getByText(/not in the deck/)).toHaveTextContent("0 not in the deck");
    fireEvent.doubleClick(full);
    expect(mainCards()).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("no copies left in your pool");
  });
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

  it("shows the card under the pointer in the card details pane", async () => {
    render(<SavedDeckEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Blue-Eyes White Dragon" }));
    const details = screen.getByRole("complementary", { name: "Card details" });
    expect(within(details).getByRole("heading", { name: "Blue-Eyes White Dragon" })).toBeInTheDocument();

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Pot of Greed" }));
    expect(await within(details).findByRole("heading", { name: "Pot of Greed" })).toBeInTheDocument();
    expect(within(details).getByText("Pot of Greed text.")).toBeInTheDocument();
    // Deck controls stay with the selected card, so they hide while another card shows.
    expect(within(details).queryByRole("button", { name: /Add one/ })).toBeNull();

    fireEvent.pointerLeave(screen.getByRole("button", { name: "Pot of Greed" }));
    expect(await within(details).findByRole("heading", { name: "Blue-Eyes White Dragon" })).toBeInTheDocument();
    expect(within(details).getByRole("button", { name: "Add one Blue-Eyes White Dragon to Main" })).toBeInTheDocument();
  });

  it("ends the pointer preview when a new search removes the card", async () => {
    render(<SavedDeckEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Blue-Eyes White Dragon" }));
    const details = screen.getByRole("complementary", { name: "Card details" });

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Pot of Greed" }));
    expect(await within(details).findByRole("heading", { name: "Pot of Greed" })).toBeInTheDocument();

    // The tile goes away under a still pointer, so it never sends pointerleave.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "blue" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Pot of Greed" })).toBeNull());
    expect(await within(details).findByRole("heading", { name: "Blue-Eyes White Dragon" })).toBeInTheDocument();
    expect(within(details).getByRole("button", { name: "Add one Blue-Eyes White Dragon to Main" })).toBeInTheDocument();
  });

  it("ends the pointer preview when the test hand closes", async () => {
    render(<SavedDeckEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Pot of Greed" }));
    fireEvent.doubleClick(screen.getByRole("button", { name: "Blue-Eyes White Dragon" }));
    await waitFor(() => expect(mainCards()).toHaveLength(1));
    const details = screen.getByRole("complementary", { name: "Card details" });

    fireEvent.click(screen.getByRole("button", { name: "Test hand" }));
    const hand = screen.getByRole("region", { name: "Test hand" });
    fireEvent.pointerEnter(within(hand).getByRole("button", { name: "Blue-Eyes White Dragon" }));
    expect(await within(details).findByRole("heading", { name: "Blue-Eyes White Dragon" })).toBeInTheDocument();

    // Undo changes the Main Deck, which closes the hand under the pointer.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("region", { name: "Test hand" })).toBeNull();
    expect(within(details).getByRole("heading", { name: "Pot of Greed" })).toBeInTheDocument();
  });

  it("undoes a format change", async () => {
    render(<SavedDeckEditor />);
    await screen.findByRole("button", { name: "Pot of Greed" });

    fireEvent.click(screen.getByRole("button", { name: "Domain" }));
    expect(screen.getByRole("region", { name: "Deck Master" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("region", { name: "Deck Master" })).toBeNull();
    expect(screen.getByRole("button", { name: "Standard" })).toHaveAttribute("aria-pressed", "true");
  });

  it("sends the search text to the card query", async () => {
    render(<SavedDeckEditor />);
    await screen.findByRole("button", { name: "Pot of Greed" });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "pot" } });
    await waitFor(() => expect(queries.at(-1)?.text).toBe("pot"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Blue-Eyes White Dragon" })).toBeNull());
  });

  it("uses copy for one Forbidden card and makes problem rows select their card", async () => {
    stored = savedDeck([POT.code, BLUE_EYES.code, BLUE_EYES.code, BLUE_EYES.code]);
    render(<SavedDeckEditor deckId="7" />);
    await screen.findByRole("button", { name: /Pot of Greed, Main Deck card/ });
    fireEvent.change(screen.getByLabelText("Banlist"), { target: { value: "tcg-2026-09" } });
    const details = screen.getByRole("complementary", { name: "Card details" });
    const problem = await within(details).findByRole("button", { name: "Pot of Greed 1 copy, Forbidden" });
    expect(within(details).getByText("3 copies, 2 allowed on TCG September 2026")).toBeInTheDocument();
    expect(screen.queryByText(/1 copies/)).toBeNull();
    expect(within(details).getByText(/On TCG September 2026\. You can save an unfinished deck/)).toBeInTheDocument();
    fireEvent.click(problem);
    expect(within(details).getByRole("heading", { name: "Pot of Greed" })).toBeInTheDocument();
    expect(within(details).getByRole("button", { name: "Remove one Pot of Greed from Main" })).toBeInTheDocument();
  });

  it("shows the missing-engine banner and retries card search without blocking saves", async () => {
    searchErrors.push("The duel engine is not set up on this server: DUEL_INTERNAL_URL is missing.");
    render(<SavedDeckEditor />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Card search isn't available. The duel engine is not set up on this server. Your deck is safe and still saves.");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Blue-Eyes White Dragon" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(queries).toHaveLength(2);
  });

  it("uses generic copy for another search failure and still saves the deck", async () => {
    searchErrors.push("Request failed (502)");
    render(<SavedDeckEditor />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Card search failed. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });

  it("hides Import, Delete, the more menu, format and banlist in pool mode", async () => {
    render(<SavedDeckEditor pool={{ slug: "retro", draftId: 3, draftName: "Retro draft", cards: [{ code: BLUE_EYES.code, count: 2 }, { code: POT.code, count: 1 }], mainPoolCount: 3, unresolved: [], savedDeckId: null, registration: null }} />);
    const tile = await screen.findByRole("button", { name: "Blue-Eyes White Dragon, 2 copies left in your pool" });
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More deck actions" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Format" })).toBeNull();
    expect(screen.queryByLabelText("Banlist")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the draft" })).toHaveAttribute("href", "/draft/retro");
    expect(screen.getByText("Draft deck from Retro draft")).toBeInTheDocument();
    expect(screen.getByText("3 cards in your pool")).toBeInTheDocument();
    fireEvent.doubleClick(tile);
    fireEvent.doubleClick(screen.getByRole("button", { name: "Blue-Eyes White Dragon, 1 copy left in your pool" }));
    const full = screen.getByRole("button", { name: "Blue-Eyes White Dragon, 0 copies left in your pool" });
    expect(full).toHaveAttribute("data-full", "true");
    expect(within(full).getByText("0 left")).toBeInTheDocument();
    fireEvent.doubleClick(full);
    expect(mainCards()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("A draft deck needs at least 3 main deck cards.")).toBeInTheDocument();
  });

  it("keeps the page bar and the menu button in the loading screen and the loaded draft editor", async () => {
    stored = savedDeck([BLUE_EYES.code]);
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, this.hasAttribute("data-pool") ? 0 : 118, 1204, 788);
    });
    try {
      const { container } = render(<SavedDeckEditor deckId="7" pool={{ slug: "retro", draftId: 3, draftName: "Retro draft", cards: [{ code: BLUE_EYES.code, count: 2 }], mainPoolCount: 2, unresolved: [], savedDeckId: 7, registration: null }} />);
      expect(screen.getByText("Loading deck…")).toBeInTheDocument();
      expect(container.querySelector("[data-shell-bar='own']")).not.toBeNull();
      expect(screen.getByRole("heading", { name: "Draft deck" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back to the draft" })).toHaveAttribute("href", "/draft/retro");
      expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
      await screen.findByRole("button", { name: /Blue-Eyes White Dragon, Main Deck card/ });
      expect(container.querySelector("[data-shell-bar='own']")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
      expect(container.querySelector<HTMLElement>("[data-pool]")?.style.getPropertyValue("--de-top")).toBe("0px");
    } finally {
      bounds.mockRestore();
    }
  });

  it("leaves a saved deck without the shell bar or menu button", async () => {
    stored = savedDeck([BLUE_EYES.code]);
    const { container } = render(<SavedDeckEditor deckId="7" />);
    await screen.findByRole("button", { name: /Blue-Eyes White Dragon, Main Deck card/ });
    expect(container.querySelector("[data-shell-bar='own']")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open menu" })).toBeNull();
  });

  it("puts Delete in the more menu and focuses Keep before confirming", async () => {
    stored = savedDeck([BLUE_EYES.code]);
    render(<SavedDeckEditor deckId="7" />);
    await screen.findByRole("button", { name: /Blue-Eyes White Dragon, Main Deck card/ });
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    const more = screen.getByRole("button", { name: "More deck actions" });
    more.focus();
    fireEvent.click(more);
    const menu = await screen.findByRole("menu", { name: "More deck actions" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete Goat control?" });
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "Keep" })).toHaveFocus());
    expect(confirm.closest(".ms-flow")).not.toBeNull();
    fireEvent.click(within(confirm).getByRole("button", { name: "Keep" }));
    expect(deleted).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(more);
    fireEvent.click(within(await screen.findByRole("menu", { name: "More deck actions" })).getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Delete Goat control?" })).getByRole("button", { name: "Delete deck" }));
    await waitFor(() => expect(deleted).toEqual([7]));
  });

  it("imports pasted cards in a portal and restores the previous deck with Undo", async () => {
    render(<SavedDeckEditor />);
    fireEvent.doubleClick(await screen.findByRole("button", { name: "Blue-Eyes White Dragon" }));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const popover = await screen.findByRole("dialog", { name: "Import a deck" });
    expect(popover.closest(".ms-flow")).not.toBeNull();
    fireEvent.change(within(popover).getByLabelText("Or paste YDK text or a ydke:// link"), { target: { value: `#main\n${POT.code}\n#extra\n!side` } });
    fireEvent.click(within(popover).getByRole("button", { name: "Load paste" }));
    expect(mainCards()[0]).toHaveAccessibleName(/Pot of Greed/);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(mainCards()).toHaveLength(1);
    expect(mainCards()[0]).toHaveAccessibleName(/Blue-Eyes White Dragon/);
  });

  it("uses the container width for the phone sheet and returns focus to its card", async () => {
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: (entries: Array<{ contentRect: { width: number } }>) => void) {}
      observe() { this.callback([{ contentRect: { width: 390 } }]); }
      disconnect() {}
    });
    const { container } = render(<SavedDeckEditor />);
    fireEvent.click(screen.getByRole("tab", { name: "Cards" }));
    const tile = await screen.findByRole("button", { name: "Blue-Eyes White Dragon" });
    fireEvent.click(tile);
    const sheet = await screen.findByRole("dialog", { name: "Blue-Eyes White Dragon" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(container.contains(sheet)).toBe(false);
    const close = within(sheet).getByRole("button", { name: "Close card" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(within(sheet).getByRole("button", { name: "Add one Blue-Eyes White Dragon to Side" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Blue-Eyes White Dragon" })).toBeNull();
    expect(tile).toHaveFocus();
    fireEvent.keyDown(window, { key: "/" });
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveFocus());
    expect(screen.getByRole("tab", { name: "Cards" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps slash shortcut focus inside the open card sheet", async () => {
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: (entries: Array<{ contentRect: { width: number } }>) => void) {}
      observe() { this.callback([{ contentRect: { width: 390 } }]); }
      disconnect() {}
    });
    render(<SavedDeckEditor />);
    fireEvent.click(screen.getByRole("tab", { name: "Cards" }));
    const search = screen.getByRole("searchbox");
    const tile = await screen.findByRole("button", { name: "Blue-Eyes White Dragon" });
    fireEvent.click(tile);
    const sheet = await screen.findByRole("dialog", { name: "Blue-Eyes White Dragon" });
    const close = within(sheet).getByRole("button", { name: "Close card" });
    await waitFor(() => expect(close).toHaveFocus());

    fireEvent.keyDown(close, { key: "/" });
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(close).toHaveFocus();
    expect(search).not.toHaveFocus();
    expect(sheet).toBeInTheDocument();

    fireEvent.keyDown(close, { key: "Escape" });
    expect(tile).toHaveFocus();
    fireEvent.keyDown(tile, { key: "/" });
    await waitFor(() => expect(search).toHaveFocus());
  });

  it.each(["list", "deck"] as const)("keeps the card sheet closed when dragging from the %s below 960px", async (source) => {
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: (entries: Array<{ contentRect: { width: number } }>) => void) {}
      observe() { this.callback([{ contentRect: { width: 959 } }]); }
      disconnect() {}
    });
    stored = savedDeck([BLUE_EYES.code]);
    const { container } = render(<SavedDeckEditor deckId="7" />);
    await screen.findByRole("button", { name: /Blue-Eyes White Dragon, Main Deck card/ });
    fireEvent.click(screen.getByRole("tab", { name: source === "list" ? "Cards" : /^Deck/ }));
    const tile = await screen.findByRole("button", { name: source === "list" ? "Blue-Eyes White Dragon, 1 in deck" : /Blue-Eyes White Dragon, Main Deck card/ });
    const data = new Map<string, string>();
    const transfer = { types: [] as string[], effectAllowed: "copyMove", dropEffect: "move", setData(type: string, value: string) { data.set(type, value); this.types = [...data.keys()]; }, getData(type: string) { return data.get(type) ?? ""; } };

    fireEvent.dragStart(tile, { dataTransfer: transfer });
    expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.firstElementChild).not.toHaveAttribute("aria-hidden", "true");
    const side = screen.getByRole("region", { name: "Side Deck" });
    fireEvent.drop(side, { dataTransfer: transfer });
    expect(mainCards()).toHaveLength(source === "list" ? 1 : 0);
    const moved = within(side).getByRole("button", { name: /Blue-Eyes White Dragon, Side Deck card/ });

    fireEvent.dragStart(moved, { dataTransfer: transfer });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.drop(screen.getByRole("complementary", { name: "Card list" }), { dataTransfer: transfer });
    expect(within(side).queryByRole("button", { name: /Side Deck card/ })).toBeNull();
  });

  it("keeps drag moves between sections and drag removal to the card list", async () => {
    render(<SavedDeckEditor />);
    const tile = await screen.findByRole("button", { name: "Blue-Eyes White Dragon" });
    const data = new Map<string, string>();
    const transfer = { types: [] as string[], effectAllowed: "copyMove", dropEffect: "move", setData(type: string, value: string) { data.set(type, value); this.types = [...data.keys()]; }, getData(type: string) { return data.get(type) ?? ""; } };
    fireEvent.dragStart(tile, { dataTransfer: transfer });
    fireEvent.drop(screen.getByRole("region", { name: "Main Deck" }), { dataTransfer: transfer });
    expect(mainCards()).toHaveLength(1);
    fireEvent.dragStart(mainCards()[0]!, { dataTransfer: transfer });
    const side = screen.getByRole("region", { name: "Side Deck" });
    fireEvent.drop(side, { dataTransfer: transfer });
    expect(mainCards()).toHaveLength(0);
    const moved = within(side).getByRole("button", { name: /Blue-Eyes White Dragon, Side Deck card/ });
    fireEvent.dragStart(moved, { dataTransfer: transfer });
    fireEvent.drop(screen.getByRole("complementary", { name: "Card list" }), { dataTransfer: transfer });
    expect(within(side).queryByRole("button", { name: /Side Deck card/ })).toBeNull();
  });

  it("opens the build tips on an empty new deck and keeps the section guidance", async () => {
    render(<SavedDeckEditor />);
    await screen.findByRole("button", { name: "Blue-Eyes White Dragon" });
    const summary = screen.getByText("How to build");
    expect(summary.closest("details")).toHaveAttribute("open");
    const main = screen.getByRole("region", { name: "Main Deck" });
    expect(within(main).getByRole("meter", { name: "Main 0 cards. Tables want 40 to 60." })).toHaveAttribute("data-state", "short");
    expect(within(main).getByText("40 short")).toBeInTheDocument();
    expect(within(main).getByText("Add cards from the list on the right.")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Extra Deck" })).getByText("Fusion, Synchro, Xyz and Link monsters go here.")).toBeInTheDocument();
  });
});

describe("SavedDeckEditor registration", () => {
  const registration = (locked: boolean) => ({ tournament: { id: 4, slug: "autumn-cup", name: "Autumn cup", status: "active" }, locked });

  it("shows where the deck is in and says nothing about locking while it can still change", async () => {
    stored = { ...savedDeck([BLUE_EYES.code]), registration: registration(false) } as SavedDeck;
    render(<SavedDeckEditor deckId="7" />);
    const link = await screen.findByRole("link", { name: "Autumn cup" });
    expect(link).toHaveAttribute("href", "/tournament/autumn-cup");
    expect(screen.getByText(/Deck in/)).toBeInTheDocument();
    expect(screen.queryByText("Locked")).toBeNull();
    expect(screen.queryByText(/Changes to this deck will not reach/)).toBeNull();
  });

  it("says in one line that a locked deck's changes will not reach the tournament, and keeps editing open", async () => {
    stored = { ...savedDeck([BLUE_EYES.code]), registration: registration(true) } as SavedDeck;
    render(<SavedDeckEditor deckId="7" />);
    await screen.findByRole("link", { name: "Autumn cup" });
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getAllByText(/Changes to this deck will not reach Autumn cup/)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByLabelText("Deck name")).toBeEnabled();
  });

  it("shows no mark for a deck that is not registered", async () => {
    stored = savedDeck([BLUE_EYES.code]);
    render(<SavedDeckEditor deckId="7" />);
    await screen.findByRole("button", { name: /Blue-Eyes White Dragon, Main Deck card/ });
    expect(screen.queryByText(/Deck in/)).toBeNull();
  });
});
