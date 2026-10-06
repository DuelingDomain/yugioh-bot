// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardQuery, DeckArtworkSwapRequest, DeckCardInfo, SavedDeck, SelectableCardArtwork } from "@yugidraft/shared/duels";
import { SavedDeckEditor } from "../../src/components/decks/editor";
import { ArtworkPicker, artCountLabel } from "../../src/components/artwork/artwork-picker";
import { clearCardArtworksCache } from "../../src/lib/card-artworks-client";

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

function card(code: number, name: string, alias = 0): DeckCardInfo {
  return { code, name, description: "", type: 0x11, attack: 3000, defense: 2500, level: 8, attribute: 0x10, race: "Dragon", alias, setcodes: [], lscale: 0, rscale: 0, arrows: 0, ot: 3 };
}

const MAIN = card(89631139, "Blue-Eyes White Dragon");
const ALT = card(89631140, "Blue-Eyes White Dragon", MAIN.code);
const NO_IMAGE = card(89631141, "Blue-Eyes White Dragon", MAIN.code);
const ALL = [MAIN, ALT, NO_IMAGE];

function art(passcode: number, isMain = false, hasImage = true): SelectableCardArtwork {
  const url = (variant: string) => (hasImage ? `/api/cards/${passcode}/image?variant=${variant}` : null);
  return { passcode, isMain, imageUrl: url("full"), smallUrl: url("small"), croppedUrl: url("cropped") };
}
const FAMILY = { passcode: MAIN.code, artworks: [art(MAIN.code, true), art(ALT.code), art(NO_IMAGE.code, false, false)] };

let swaps: DeckArtworkSwapRequest[];
let swapGate: Promise<void> | null;
let swapStatus: number;
let stored: SavedDeck | null;

function savedDeck(main: number[]): SavedDeck {
  return { id: 7, name: "Dragons", mode: "normal", deck: { main, extra: [], side: [] }, createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z" };
}

beforeEach(() => {
  clearCardArtworksCache();
  swaps = [];
  swapGate = null;
  swapStatus = 200;
  stored = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/decks/cards/facets") return Response.json({ archetypes: [], banlists: {} });
    if (url === "/api/decks/cards") {
      const query = JSON.parse(String(init?.body)) as CardQuery;
      void query;
      return Response.json({ cards: [{ ...MAIN, altArtCount: 2 }, { ...card(55144522, "Pot of Greed"), type: 0x2, altArtCount: 0 }], total: 2, offset: 0 });
    }
    if (url === "/api/duels/cards") {
      const { codes } = JSON.parse(String(init?.body)) as { codes: number[] };
      return Response.json({ cards: ALL.filter((entry) => codes.includes(entry.code)), missing: [] });
    }
    if (typeof url === "string" && url.endsWith("/artworks")) return Response.json(FAMILY);
    if (url === "/api/decks/artwork") {
      const request = JSON.parse(String(init?.body)) as DeckArtworkSwapRequest;
      swaps.push(request);
      if (swapGate) await swapGate;
      if (swapStatus !== 200) return Response.json({ error: "The deck changed." }, { status: swapStatus });
      const main = [...request.deck.main];
      main[request.index] = request.to;
      return Response.json({ deck: { ...request.deck, main } });
    }
    if (url === "/api/decks/7" && stored) return Response.json({ deck: stored });
    return Response.json({ error: "not found" }, { status: 404 });
  }));
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("artCountLabel", () => {
  it("counts the main art with the others", () => {
    expect(artCountLabel(7)).toBe("8 arts");
  });
});

describe("ArtworkPicker", () => {
  it("shows every art, marks the one in use and picks another", async () => {
    const onPick = vi.fn();
    render(<ArtworkPicker code={ALT.code} onPick={onPick} />);
    const group = await screen.findByRole("group", { name: "Choose an art" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[0]).toHaveAccessibleName(/Art 1 of 3, passcode 89631139, main art/);
    // Arts without an image show a placeholder and say so; no upstream URL is used.
    expect(buttons[2]).toHaveAccessibleName(/no image available/);
    expect(within(buttons[2]!).getByText("No image")).toBeInTheDocument();
    expect(group.querySelectorAll("img")).toHaveLength(2);
    for (const img of group.querySelectorAll("img")) expect(img.getAttribute("src")).toMatch(/^\/api\/cards\/\d+\/image\?variant=small$/);
    fireEvent.click(buttons[0]!);
    expect(onPick).toHaveBeenCalledWith(FAMILY.artworks[0], FAMILY);
    fireEvent.click(buttons[1]!);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("moves focus between arts with the arrow keys", async () => {
    render(<ArtworkPicker code={MAIN.code} onPick={vi.fn()} />);
    const group = await screen.findByRole("group", { name: "Choose an art" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons[0]).toHaveAttribute("tabindex", "0");
    expect(buttons[1]).toHaveAttribute("tabindex", "-1");
    buttons[0]!.focus();
    fireEvent.keyDown(buttons[0]!, { key: "ArrowRight" });
    expect(buttons[1]).toHaveFocus();
    fireEvent.keyDown(buttons[1]!, { key: "End" });
    expect(buttons[2]).toHaveFocus();
    fireEvent.keyDown(buttons[2]!, { key: "ArrowRight" });
    expect(buttons[0]).toHaveFocus();
  });

  it("renders nothing for a card with one art and skips the request when the count is known", async () => {
    const fetch = vi.mocked(globalThis.fetch);
    const { container } = render(<ArtworkPicker code={MAIN.code} knownCount={1} onPick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("offers a retry when the list does not load", async () => {
    const fetch = vi.mocked(globalThis.fetch);
    const original = fetch.getMockImplementation()!;
    let fail = true;
    fetch.mockImplementation(async (url, init) => (fail && String(url).endsWith("/artworks") ? Response.json({ error: "down" }, { status: 502 }) : original(url, init)));
    render(<ArtworkPicker code={MAIN.code} onPick={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Art choices did not load.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByRole("group", { name: "Choose an art" })).toBeInTheDocument();
  });

  it("locks the other arts while a change is running", async () => {
    render(<ArtworkPicker code={MAIN.code} busy onPick={vi.fn()} />);
    const group = await screen.findByRole("group", { name: "Choose an art" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons[0]).toBeEnabled();
    expect(buttons[1]).toBeDisabled();
  });
});

describe("deck editor art", () => {
  it("shows the art count on cards that have other arts", async () => {
    render(<SavedDeckEditor />);
    const tile = await screen.findByRole("button", { name: "Blue-Eyes White Dragon" });
    expect(within(tile).getByText("3 arts")).toBeInTheDocument();
    const pot = screen.getByRole("button", { name: "Pot of Greed" });
    expect(within(pot).queryByText(/arts/)).toBeNull();
  });

  it("swaps one copy of a deck card to another art and keeps the other copy", async () => {
    stored = savedDeck([MAIN.code, MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    const copies = await screen.findAllByRole("button", { name: /Blue-Eyes White Dragon, Main Deck card/ });
    fireEvent.click(copies[1]!);
    const group = await screen.findByRole("group", { name: "Choose an art" });
    fireEvent.click(within(group).getByRole("button", { name: /Art 2 of 3/ }));
    await waitFor(() => expect(swaps).toHaveLength(1));
    expect(swaps[0]).toMatchObject({ section: "main", index: 1, from: MAIN.code, to: ALT.code });
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Choose an art" })).getByRole("button", { name: /Art 2 of 3/ })).toHaveAttribute("aria-pressed", "true"));
    // The deck is unsaved and can be undone.
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled());
  });

  it("shows the server reason when a swap fails and leaves the deck alone", async () => {
    stored = savedDeck([MAIN.code]);
    swapStatus = 409;
    render(<SavedDeckEditor deckId="7" />);
    fireEvent.click(await screen.findByRole("button", { name: /Blue-Eyes White Dragon, Main Deck card/ }));
    const group = await screen.findByRole("group", { name: "Choose an art" });
    fireEvent.click(within(group).getByRole("button", { name: /Art 2 of 3/ }));
    expect(await screen.findByText("The deck changed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("ignores a late swap answer after the deck changed", async () => {
    stored = savedDeck([MAIN.code]);
    let release!: () => void;
    swapGate = new Promise<void>((resolve) => { release = resolve; });
    render(<SavedDeckEditor deckId="7" />);
    fireEvent.click(await screen.findByRole("button", { name: /Blue-Eyes White Dragon, Main Deck card/ }));
    const group = await screen.findByRole("group", { name: "Choose an art" });
    fireEvent.click(within(group).getByRole("button", { name: /Art 2 of 3/ }));
    await waitFor(() => expect(swaps).toHaveLength(1));
    // An edit while the answer is on its way.
    fireEvent.click(screen.getByRole("button", { name: "Remove one Blue-Eyes White Dragon from Main" }));
    await act(async () => { release(); await Promise.resolve(); });
    expect(await screen.findByText(/The deck changed while the art loaded/)).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /Main Deck card/ })).toHaveLength(0);
  });

  it("changes the art that Add uses when the card comes from the list", async () => {
    render(<SavedDeckEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Blue-Eyes White Dragon" }));
    const group = await screen.findByRole("region", { name: "Art to add" });
    fireEvent.click(within(group).getByRole("button", { name: /Art 2 of 3/ }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Art to add" })).toBeInTheDocument());
    fireEvent.click(await screen.findByRole("button", { name: "Add one Blue-Eyes White Dragon to Main" }));
    expect(swaps).toHaveLength(0);
    const cards = await screen.findAllByRole("button", { name: /Main Deck card/ });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.querySelector("img")?.getAttribute("src")).toContain(String(ALT.code));
  });
});
