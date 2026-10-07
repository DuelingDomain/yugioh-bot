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

function art(passcode: number, isMain = false, hasImage = true): SelectableCardArtwork {
  const url = (variant: string) => (hasImage ? `/api/cards/${passcode}/image?variant=${variant}` : null);
  return { passcode, isMain, imageUrl: url("full"), smallUrl: url("small"), croppedUrl: url("cropped") };
}
const FAMILY = { passcode: MAIN.code, artworks: [art(MAIN.code, true), art(ALT.code), art(NO_IMAGE.code, false, false)] };
// A second card whose family has two arts, to move the picker from one card to another.
const DARK = card(46986414, "Dark Magician");
const DARK_ALT = card(46986415, "Dark Magician", DARK.code);
const DARK_FAMILY = { passcode: DARK.code, artworks: [art(DARK.code, true), art(DARK_ALT.code)] };
// A card with one art: no menu, no badge.
const POT = { ...card(55144522, "Pot of Greed"), type: 0x2 };
const ALL = [MAIN, ALT, NO_IMAGE, DARK, DARK_ALT, POT];
/** The host says how many other arts each card has; a family of 3 says 2. */
const OTHER_ARTS = new Map([[MAIN.code, 2], [ALT.code, 2], [NO_IMAGE.code, 2], [DARK.code, 1], [DARK_ALT.code, 1], [POT.code, 0]]);

let swaps: DeckArtworkSwapRequest[];
let swapGate: Promise<void> | null;
let swapStatus: number;
let stored: SavedDeck | null;
let artworkCalls: string[];
let artworkGate: Promise<void> | null;
let artworkStatus: number;

function savedDeck(main: number[]): SavedDeck {
  return { id: 7, name: "Dragons", mode: "normal", deck: { main, extra: [], side: [] }, createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z" };
}

beforeEach(() => {
  clearCardArtworksCache();
  swaps = [];
  swapGate = null;
  swapStatus = 200;
  stored = null;
  artworkCalls = [];
  artworkGate = null;
  artworkStatus = 200;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/decks/cards/facets") return Response.json({ archetypes: [], banlists: {} });
    if (url === "/api/decks/cards") {
      const query = JSON.parse(String(init?.body)) as CardQuery;
      void query;
      return Response.json({ cards: [{ ...MAIN, altArtCount: 2 }, { ...card(55144522, "Pot of Greed"), type: 0x2, altArtCount: 0 }], total: 2, offset: 0 });
    }
    if (url === "/api/duels/cards") {
      const { codes } = JSON.parse(String(init?.body)) as { codes: number[] };
      return Response.json({ cards: ALL.filter((entry) => codes.includes(entry.code)).map((entry) => ({ ...entry, altArtCount: OTHER_ARTS.get(entry.code) ?? 0 })), missing: [] });
    }
    if (typeof url === "string" && url.endsWith("/artworks")) {
      artworkCalls.push(url);
      if (artworkStatus !== 200) return Response.json({ error: "No such card." }, { status: artworkStatus });
      const dark = url.includes(`/${DARK.code}/`) || url.includes(`/${DARK_ALT.code}/`);
      if (dark && artworkGate) await artworkGate;
      return Response.json(dark ? DARK_FAMILY : FAMILY);
    }
    if (url === "/api/decks/artwork") {
      const request = JSON.parse(String(init?.body)) as DeckArtworkSwapRequest;
      swaps.push(request);
      if (swapGate) await swapGate;
      if (swapStatus !== 200) return Response.json({ error: "The deck changed." }, { status: swapStatus });
      if (request.section === "deckMaster") return Response.json({ deck: { ...request.deck, deckMaster: request.to } });
      const list = [...request.deck[request.section]];
      list[request.index] = request.to;
      return Response.json({ deck: { ...request.deck, [request.section]: list } });
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

  it("locks the other arts while a change is running without losing keyboard focus", async () => {
    const onPick = vi.fn();
    render(<ArtworkPicker code={MAIN.code} busy onPick={onPick} />);
    const group = await screen.findByRole("group", { name: "Choose an art" });
    const buttons = within(group).getAllByRole("button");
    // aria-disabled keeps the buttons in the tab order, so focus and the arrow keys survive the change.
    expect(buttons[0]).not.toHaveAttribute("aria-disabled");
    expect(buttons[1]).toHaveAttribute("aria-disabled", "true");
    buttons[0]!.focus();
    fireEvent.keyDown(buttons[0]!, { key: "ArrowRight" });
    expect(buttons[1]).toHaveFocus();
    fireEvent.click(buttons[1]!);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("lets a keyboard user reach an art that cannot be chosen and read why", async () => {
    const onPick = vi.fn();
    render(<ArtworkPicker code={MAIN.code} unavailable={new Map([[ALT.code, "already in this cube"]])} onPick={onPick} />);
    const group = await screen.findByRole("group", { name: "Choose an art" });
    const buttons = within(group).getAllByRole("button");
    buttons[0]!.focus();
    fireEvent.keyDown(buttons[0]!, { key: "ArrowRight" });
    expect(buttons[1]).toHaveFocus();
    expect(buttons[1]).toHaveAccessibleName(/already in this cube/);
    expect(screen.getByRole("region", { name: "Card art" })).toHaveTextContent("already in this cube");
    fireEvent.click(buttons[1]!);
    expect(onPick).not.toHaveBeenCalled();
    // The next art can still be chosen.
    fireEvent.click(buttons[2]!);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("never shows the strip of the card that was open before while the new card loads", async () => {
    const onPick = vi.fn();
    const { rerender } = render(<ArtworkPicker code={MAIN.code} onPick={onPick} />);
    await screen.findByRole("group", { name: "Choose an art" });
    let release!: () => void;
    artworkGate = new Promise<void>((resolve) => { release = resolve; });
    rerender(<ArtworkPicker code={DARK.code} knownCount={2} onPick={onPick} />);
    // The old art cannot be clicked while the new list is on its way.
    expect(screen.queryByRole("group", { name: "Choose an art" })).toBeNull();
    expect(screen.queryByRole("button", { name: /89631139/ })).toBeNull();
    await act(async () => { release(); });
    const group = await screen.findByRole("group", { name: "Choose an art" });
    expect(within(group).getAllByRole("button")).toHaveLength(2);
    expect(within(group).getAllByRole("button")[0]).toHaveAccessibleName(/passcode 46986414/);
  });

  it("stays inside the list when the next card has fewer arts than the one hovered", async () => {
    const { rerender } = render(<ArtworkPicker code={MAIN.code} onPick={vi.fn()} />);
    const group = await screen.findByRole("group", { name: "Choose an art" });
    fireEvent.focus(within(group).getAllByRole("button")[2]!);
    rerender(<ArtworkPicker code={DARK.code} onPick={vi.fn()} />);
    expect(await screen.findByRole("region", { name: "Card art" })).toHaveTextContent("Art 2 of 2");
  });

  it("hides itself for a card that has no family", async () => {
    artworkStatus = 404;
    const { container } = render(<ArtworkPicker code={MAIN.code} onPick={vi.fn()} />);
    await waitFor(() => expect(artworkCalls).toHaveLength(1));
    await act(async () => { await Promise.resolve(); });
    expect(container).toBeEmptyDOMElement();
  });

  it("draws a list that was loaded before on its first render, with no placeholder", async () => {
    const first = render(<ArtworkPicker code={MAIN.code} onPick={vi.fn()} />);
    await screen.findByRole("group", { name: "Choose an art" });
    first.unmount();
    render(<ArtworkPicker code={ALT.code} onPick={vi.fn()} />);
    // No await: the cache answers on the first render.
    expect(screen.getByRole("group", { name: "Choose an art" })).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("does not flash a placeholder while the list of a one-art card loads", async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      artworkGate = new Promise<void>((resolve) => { release = resolve; });
      const { container } = render(<ArtworkPicker code={DARK.code} onPick={vi.fn()} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(container).toBeEmptyDOMElement();
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(screen.getByText("Loading…")).toBeInTheDocument();
      await act(async () => { release(); });
    } finally {
      vi.useRealTimers();
    }
  });

  it("says Art changed briefly when a change ends on another art, and not when nothing changed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { rerender } = render(<ArtworkPicker code={MAIN.code} onPick={vi.fn()} />);
      await screen.findByRole("group", { name: "Choose an art" });
      rerender(<ArtworkPicker code={MAIN.code} busy onPick={vi.fn()} />);
      rerender(<ArtworkPicker code={MAIN.code} onPick={vi.fn()} />);
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      rerender(<ArtworkPicker code={MAIN.code} busy onPick={vi.fn()} />);
      rerender(<ArtworkPicker code={ALT.code} onPick={vi.fn()} />);
      expect(screen.getByRole("status")).toHaveTextContent("Art changed");
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not show the placeholder of a new card because the last card was slow", async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      artworkGate = new Promise<void>((resolve) => { release = resolve; });
      const { container, rerender } = render(<ArtworkPicker code={DARK.code} onPick={vi.fn()} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(screen.getByText("Loading…")).toBeInTheDocument();
      // Another card opens: its placeholder waits for its own delay.
      rerender(<ArtworkPicker code={ALT.code} onPick={vi.fn()} />);
      expect(container).toBeEmptyDOMElement();
      await act(async () => { release(); });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the known count while the list loads when the card list already said it", () => {
    artworkGate = new Promise<void>(() => undefined);
    render(<ArtworkPicker code={DARK.code} knownCount={2} onPick={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Card art" })).toHaveTextContent("2 arts");
  });

  it("does not ask again when the card changes inside its family after a retry", async () => {
    const fetch = vi.mocked(globalThis.fetch);
    const original = fetch.getMockImplementation()!;
    let fail = true;
    fetch.mockImplementation(async (url, init) => (fail && String(url).endsWith("/artworks") ? Response.json({ error: "down" }, { status: 502 }) : original(url, init)));
    const { rerender } = render(<ArtworkPicker code={MAIN.code} onPick={vi.fn()} />);
    const retry = await screen.findByRole("button", { name: /Try again/ });
    fail = false;
    fireEvent.click(retry);
    await screen.findByRole("group", { name: "Choose an art" });
    const calls = artworkCalls.length;
    rerender(<ArtworkPicker code={ALT.code} onPick={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(artworkCalls).toHaveLength(calls);
  });

  it("announces a change only while it runs, not each art the focus passes", async () => {
    const { rerender } = render(<ArtworkPicker code={MAIN.code} onPick={vi.fn()} />);
    await screen.findByRole("group", { name: "Choose an art" });
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    expect(document.querySelector("[aria-live]")).toBeNull();
    rerender(<ArtworkPicker code={MAIN.code} busy onPick={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Changing art…");
  });
});

describe("deck editor art", () => {
  it("shows the art count on cards that have other arts", async () => {
    render(<SavedDeckEditor />);
    const tile = await screen.findByRole("button", { name: "Blue-Eyes White Dragon, 3 arts" });
    expect(within(tile).getByText("3")).toBeInTheDocument();
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
    // The other copy keeps its art and the swapped one has the new art.
    await waitFor(() => {
      const [first, second] = screen.getAllByRole("button", { name: /Blue-Eyes White Dragon, Main Deck card/ });
      expect(first!.querySelector("img")?.getAttribute("src")).toContain(String(MAIN.code));
      expect(second!.querySelector("img")?.getAttribute("src")).toContain(String(ALT.code));
    });
    // The deck is unsaved and can be undone.
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled());
    // The panel follows the undo: it shows the old art as the one in use, not the art that was undone.
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Choose an art" })).getByRole("button", { name: /Art 1 of 3/ })).toHaveAttribute("aria-pressed", "true"));
    const [again, other] = screen.getAllByRole("button", { name: /Blue-Eyes White Dragon, Main Deck card/ });
    expect(again!.querySelector("img")?.getAttribute("src")).toContain(String(MAIN.code));
    expect(other!.querySelector("img")?.getAttribute("src")).toContain(String(MAIN.code));
    expect(other).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the server reason when a swap fails and leaves the deck alone", async () => {
    stored = savedDeck([MAIN.code]);
    swapStatus = 409;
    render(<SavedDeckEditor deckId="7" />);
    fireEvent.click(await screen.findByRole("button", { name: /Blue-Eyes White Dragon, Main Deck card/ }));
    const group = await screen.findByRole("group", { name: "Choose an art" });
    fireEvent.click(within(group).getByRole("button", { name: /Art 2 of 3/ }));
    expect(await screen.findByText("The deck changed. Pick the art again.")).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: "Blue-Eyes White Dragon, 3 arts" }));
    const group = await screen.findByRole("region", { name: "Art to add" });
    fireEvent.click(within(group).getByRole("button", { name: /Art 2 of 3/ }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Art to add" })).toBeInTheDocument());
    fireEvent.click(await screen.findByRole("button", { name: "Add one Blue-Eyes White Dragon to Main" }));
    expect(swaps).toHaveLength(0);
    const cards = await screen.findAllByRole("button", { name: /Main Deck card/ });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.querySelector("img")?.getAttribute("src")).toContain(String(ALT.code));
  });

  it("swaps the Deck Master in Domain and keeps the format", async () => {
    stored = { ...savedDeck([]), mode: "domain", deck: { main: [], extra: [], side: [], deckMaster: MAIN.code } };
    render(<SavedDeckEditor deckId="7" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Deck Master: Blue-Eyes White Dragon/ }));
    const group = await screen.findByRole("region", { name: "Art of this copy" });
    fireEvent.click(within(group).getByRole("button", { name: /Art 2 of 3/ }));
    await waitFor(() => expect(swaps).toHaveLength(1));
    expect(swaps[0]).toMatchObject({ section: "deckMaster", index: 0, from: MAIN.code, to: ALT.code });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Deck Master: Blue-Eyes White Dragon/ }).querySelector("img")?.getAttribute("src")).toContain(String(ALT.code)));
    expect(within(screen.getByRole("region", { name: "Art of this copy" })).getByRole("button", { name: /Art 2 of 3/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Domain" })).toHaveAttribute("aria-pressed", "true");
  });

  it("chooses the art to add in the draft deck builder", async () => {
    const pool = { slug: "retro", draftId: 3, draftName: "Retro draft", cards: [{ code: MAIN.code, count: 2 }], mainPoolCount: 2, unresolved: [], savedDeckId: null, registration: null };
    render(<SavedDeckEditor pool={pool} />);
    fireEvent.click(await screen.findByRole("button", { name: "Blue-Eyes White Dragon, 2 copies left in your pool, 3 arts" }));
    const group = await screen.findByRole("region", { name: "Art to add" });
    fireEvent.click(within(await within(group).findByRole("group", { name: "Choose an art" })).getByRole("button", { name: /Art 2 of 3/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Add one Blue-Eyes White Dragon to Main" }));
    const cards = await screen.findAllByRole("button", { name: /Main Deck card/ });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.querySelector("img")?.getAttribute("src")).toContain(String(ALT.code));
    // A copy of another art is still a copy of the same pool card.
    expect(await screen.findByRole("button", { name: "Blue-Eyes White Dragon, 1 copy left in your pool, 3 arts" })).toBeInTheDocument();
    expect(swaps).toHaveLength(0);
  });

  it("blocks Save while an art change is on its way", async () => {
    stored = savedDeck([MAIN.code]);
    let release!: () => void;
    swapGate = new Promise<void>((resolve) => { release = resolve; });
    render(<SavedDeckEditor deckId="7" />);
    fireEvent.click(await screen.findByRole("button", { name: /Blue-Eyes White Dragon, Main Deck card/ }));
    const group = await screen.findByRole("group", { name: "Choose an art" });
    fireEvent.click(within(group).getByRole("button", { name: /Art 2 of 3/ }));
    await waitFor(() => expect(swaps).toHaveLength(1));
    expect(screen.getByRole("button", { name: /^Save/ })).toBeDisabled();
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Save/ })).toBeEnabled());
  });

  it("opens the problem card on the placed copy, so the picker swaps that copy", async () => {
    stored = savedDeck([MAIN.code, MAIN.code, MAIN.code, MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    fireEvent.click(await screen.findByRole("button", { name: /Blue-Eyes White Dragon.*4 copies/ }));
    expect(await screen.findByRole("region", { name: "Art of this copy" })).toBeInTheDocument();
  });
});

describe("deck art menu", () => {
  const copyName = /Blue-Eyes White Dragon, Main Deck card/;
  const menuName = "Change art of Blue-Eyes White Dragon";

  async function openMenu(copy: HTMLElement) {
    fireEvent.contextMenu(copy);
    const menu = await screen.findByRole("dialog", { name: menuName });
    const group = await within(menu).findByRole("group", { name: "Choose an art" });
    return { menu, group };
  }

  it("opens beside a card on right-click, and a pick swaps that copy and closes the menu", async () => {
    stored = savedDeck([MAIN.code, MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    const copies = await screen.findAllByRole("button", { name: copyName });
    const { group } = await openMenu(copies[1]!);
    // The art in use has the focus, so the arrow keys work at once.
    await waitFor(() => expect(within(group).getByRole("button", { name: /Art 1 of 3/ })).toHaveFocus());
    fireEvent.click(within(group).getByRole("button", { name: /Art 2 of 3/ }));
    expect(screen.queryByRole("dialog", { name: menuName })).toBeNull();
    expect(copies[1]).toHaveFocus();
    await waitFor(() => expect(swaps).toHaveLength(1));
    expect(swaps[0]).toMatchObject({ section: "main", index: 1, from: MAIN.code, to: ALT.code });
    await waitFor(() => {
      const [first, second] = screen.getAllByRole("button", { name: copyName });
      expect(first!.querySelector("img")?.getAttribute("src")).toContain(String(MAIN.code));
      expect(second!.querySelector("img")?.getAttribute("src")).toContain(String(ALT.code));
    });
    // The swap is one undo step and the panel never opened.
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Art of this copy" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled());
    for (const tile of screen.getAllByRole("button", { name: copyName })) expect(tile.querySelector("img")?.getAttribute("src")).toContain(String(MAIN.code));
  });

  it("opens from the keyboard with the menu key or Shift+F10", async () => {
    stored = savedDeck([MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    const tile = await screen.findByRole("button", { name: copyName });
    tile.focus();
    fireEvent.keyDown(tile, { key: "ContextMenu" });
    expect(await screen.findByRole("dialog", { name: menuName })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: menuName })).toBeNull());
    fireEvent.keyDown(tile, { key: "F10", shiftKey: true });
    expect(await screen.findByRole("dialog", { name: menuName })).toBeInTheDocument();
  });

  it("closes on Escape and gives the focus back to the card", async () => {
    stored = savedDeck([MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    const tile = await screen.findByRole("button", { name: copyName });
    const { group } = await openMenu(tile);
    await waitFor(() => expect(within(group).getByRole("button", { name: /Art 1 of 3/ })).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: menuName })).toBeNull();
    expect(tile).toHaveFocus();
    expect(swaps).toHaveLength(0);
  });

  it("closes when the press lands outside the menu, and not when it lands inside", async () => {
    stored = savedDeck([MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    const { menu, group } = await openMenu(await screen.findByRole("button", { name: copyName }));
    fireEvent.pointerDown(within(group).getByRole("button", { name: /Art 1 of 3/ }));
    fireEvent.pointerDown(menu);
    expect(screen.getByRole("dialog", { name: menuName })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: menuName })).toBeNull();
    // The click that ends the press is the guard's one click.
    fireEvent.click(document.body);
  });

  it("says so, and opens no menu, for a card with one art", async () => {
    stored = savedDeck([POT.code]);
    render(<SavedDeckEditor deckId="7" />);
    const tile = await screen.findByRole("button", { name: /Pot of Greed, Main Deck card/ });
    expect(tile).not.toHaveAttribute("aria-haspopup");
    fireEvent.contextMenu(tile);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Pot of Greed has no other arts.");
    expect(artworkCalls).toHaveLength(0);
  });

  it("keeps a failed pick as a notice and leaves the deck alone", async () => {
    stored = savedDeck([MAIN.code]);
    swapStatus = 409;
    render(<SavedDeckEditor deckId="7" />);
    const { group } = await openMenu(await screen.findByRole("button", { name: copyName }));
    fireEvent.click(within(group).getByRole("button", { name: /Art 2 of 3/ }));
    expect(await screen.findByText("The deck changed. Pick the art again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("blocks Save while the pick is on its way, and ignores an answer that is late", async () => {
    stored = savedDeck([MAIN.code]);
    let release!: () => void;
    swapGate = new Promise<void>((resolve) => { release = resolve; });
    render(<SavedDeckEditor deckId="7" />);
    const tile = await screen.findByRole("button", { name: copyName });
    const { group } = await openMenu(tile);
    fireEvent.click(within(group).getByRole("button", { name: /Art 2 of 3/ }));
    await waitFor(() => expect(swaps).toHaveLength(1));
    expect(screen.getByRole("button", { name: /^Save/ })).toBeDisabled();
    // An edit while the answer is on its way.
    fireEvent.keyDown(tile, { key: "Delete" });
    await act(async () => { release(); await Promise.resolve(); });
    expect(await screen.findByText(/The deck changed while the art loaded/)).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /Main Deck card/ })).toHaveLength(0);
    await waitFor(() => expect(screen.getByRole("button", { name: /^Save/ })).toBeEnabled());
  });

  it("swaps the Deck Master in Domain from its own menu", async () => {
    stored = { ...savedDeck([]), mode: "domain", deck: { main: [], extra: [], side: [], deckMaster: MAIN.code } };
    render(<SavedDeckEditor deckId="7" />);
    const slot = await screen.findByRole("button", { name: /^Deck Master: Blue-Eyes White Dragon/ });
    const { group } = await openMenu(slot);
    fireEvent.click(within(group).getByRole("button", { name: /Art 2 of 3/ }));
    await waitFor(() => expect(swaps).toHaveLength(1));
    expect(swaps[0]).toMatchObject({ section: "deckMaster", index: 0, from: MAIN.code, to: ALT.code });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Deck Master: Blue-Eyes White Dragon/ }).querySelector("img")?.getAttribute("src")).toContain(String(ALT.code)));
    expect(screen.getByRole("button", { name: "Domain" })).toHaveAttribute("aria-pressed", "true");
  });

  it("swaps a card of the draft deck builder in place and keeps the pool count", async () => {
    const pool = { slug: "retro", draftId: 3, draftName: "Retro draft", cards: [{ code: MAIN.code, count: 2 }], mainPoolCount: 2, unresolved: [], savedDeckId: null, registration: null };
    render(<SavedDeckEditor pool={pool} />);
    fireEvent.doubleClick(await screen.findByRole("button", { name: "Blue-Eyes White Dragon, 2 copies left in your pool, 3 arts" }));
    const { group } = await openMenu(await screen.findByRole("button", { name: copyName }));
    fireEvent.click(within(group).getByRole("button", { name: /Art 3 of 3/ }));
    await waitFor(() => expect(swaps).toHaveLength(1));
    expect(swaps[0]).toMatchObject({ section: "main", index: 0, from: MAIN.code, to: NO_IMAGE.code });
    await waitFor(() => expect(screen.getByRole("button", { name: copyName }).querySelector("img")?.getAttribute("src") ?? "").toContain(String(NO_IMAGE.code)));
    expect(await screen.findByRole("button", { name: "Blue-Eyes White Dragon, 1 copy left in your pool, 3 arts" })).toBeInTheDocument();
  });

  it("closes when its copy leaves the deck", async () => {
    stored = savedDeck([MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    const tile = await screen.findByRole("button", { name: copyName });
    await openMenu(tile);
    fireEvent.keyDown(tile, { key: "Delete" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: menuName })).toBeNull());
  });
});

describe("deck art indicator", () => {
  it("marks only the cards that have other arts, and says how many in the card name", async () => {
    stored = savedDeck([MAIN.code, DARK.code, POT.code]);
    render(<SavedDeckEditor deckId="7" />);
    const multi = await screen.findByRole("button", { name: /Blue-Eyes White Dragon, Main Deck card 1, 3 arts$/ });
    expect(within(multi).getByTitle("3 arts. Click or right-click to change the art.")).toHaveTextContent("3");
    const two = screen.getByRole("button", { name: /Dark Magician, Main Deck card 2, 2 arts$/ });
    expect(within(two).getByTitle("2 arts. Click or right-click to change the art.")).toHaveTextContent("2");
    const single = screen.getByRole("button", { name: /Pot of Greed, Main Deck card 3$/ });
    expect(single.querySelector('[title*="arts"]')).toBeNull();
  });
});

describe("deck art menu details", () => {
  const copyName = /Blue-Eyes White Dragon, Main Deck card/;
  const menuName = "Change art of Blue-Eyes White Dragon";
  const mouseClick = (element: Element) => {
    fireEvent.pointerDown(element, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(element, { pointerType: "mouse", button: 0 });
    fireEvent.click(element, { detail: 1 });
  };
  const rect = (left: number, top: number, width = 60, height = 90) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

  afterEach(() => {
    window.innerWidth = 1024;
    window.innerHeight = 768;
  });

  it("does not remove the card under the press that closes the menu, then clicks work again", async () => {
    stored = savedDeck([MAIN.code, MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    const copies = await screen.findAllByRole("button", { name: copyName });
    fireEvent.contextMenu(copies[0]!);
    await screen.findByRole("dialog", { name: menuName });
    mouseClick(copies[1]!);
    expect(screen.queryByRole("dialog", { name: menuName })).toBeNull();
    expect(screen.getAllByRole("button", { name: copyName })).toHaveLength(2);
    mouseClick(screen.getAllByRole("button", { name: copyName })[1]!);
    expect(screen.getAllByRole("button", { name: copyName })).toHaveLength(1);
  });

  it("opens the menu from the art chip and does not remove the card", async () => {
    stored = savedDeck([MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    const tile = await screen.findByRole("button", { name: copyName });
    const chip = within(tile).getByTitle("3 arts. Click or right-click to change the art.");
    mouseClick(chip);
    expect(await screen.findByRole("dialog", { name: menuName })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: copyName })).toHaveLength(1);
  });

  it("gives the Deck Master slot the chip, the art count in its name and the menu", async () => {
    stored = { ...savedDeck([]), mode: "domain", deck: { main: [], extra: [], side: [], deckMaster: MAIN.code } };
    render(<SavedDeckEditor deckId="7" />);
    const slot = await screen.findByRole("button", { name: "Deck Master: Blue-Eyes White Dragon, 3 arts" });
    mouseClick(within(slot).getByTitle("3 arts. Click or right-click to change the art."));
    expect(await screen.findByRole("dialog", { name: menuName })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deck Master: Blue-Eyes White Dragon, 3 arts" })).toBeInTheDocument();
  });

  it("names the keys on the tile and leaves no dialog claim", async () => {
    stored = savedDeck([MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    const tile = await screen.findByRole("button", { name: copyName });
    expect(tile).toHaveAttribute("aria-keyshortcuts", "Delete Plus = ContextMenu Shift+F10");
    expect(tile).not.toHaveAttribute("aria-haspopup");
    expect(tile).not.toHaveAttribute("aria-expanded");
  });

  it("stays open when another panel scrolls, such as the card details", async () => {
    stored = savedDeck([MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    fireEvent.contextMenu(await screen.findByRole("button", { name: copyName }));
    await screen.findByRole("dialog", { name: menuName });
    fireEvent.scroll(screen.getByRole("complementary", { name: "Card details" }));
    expect(screen.getByRole("dialog", { name: menuName })).toBeInTheDocument();
  });

  it("keeps Tab inside the menu", async () => {
    stored = savedDeck([MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    fireEvent.contextMenu(await screen.findByRole("button", { name: copyName }));
    const menu = await screen.findByRole("dialog", { name: menuName });
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    expect(fireEvent.keyDown(document.activeElement!, { key: "Tab" })).toBe(false);
    expect(menu.contains(document.activeElement)).toBe(true);
    expect(fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true })).toBe(false);
    expect(menu.contains(document.activeElement)).toBe(true);
  });

  it("closes when the page scrolls, but not when the strip inside it does", async () => {
    stored = savedDeck([MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    fireEvent.contextMenu(await screen.findByRole("button", { name: copyName }));
    const menu = await screen.findByRole("dialog", { name: menuName });
    fireEvent.scroll(within(menu).getByRole("group", { name: "Choose an art" }));
    expect(screen.getByRole("dialog", { name: menuName })).toBeInTheDocument();
    fireEvent.scroll(document.body);
    expect(screen.queryByRole("dialog", { name: menuName })).toBeNull();
  });

  it("opens to the left of the card when there is no room on its right", async () => {
    window.innerWidth = 800;
    stored = savedDeck([MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    const tile = await screen.findByRole("button", { name: copyName });
    vi.spyOn(tile, "getBoundingClientRect").mockReturnValue(rect(600, 100));
    fireEvent.contextMenu(tile);
    const menu = await screen.findByRole("dialog", { name: menuName });
    await waitFor(() => expect(menu).toHaveStyle({ left: "300px", top: "100px" }));
    expect(menu.style.getPropertyValue("--mo-origin")).toBe("top right");
  });

  it("opens below the card on a narrow screen", async () => {
    window.innerWidth = 400;
    stored = savedDeck([MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    const tile = await screen.findByRole("button", { name: copyName });
    vi.spyOn(tile, "getBoundingClientRect").mockReturnValue(rect(150, 100));
    fireEvent.contextMenu(tile);
    const menu = await screen.findByRole("dialog", { name: menuName });
    await waitFor(() => expect(menu).toHaveStyle({ top: "198px" }));
    expect(menu.style.getPropertyValue("--mo-origin")).toBe("top center");
  });

  it("starts again for the next card: focus lands in the new menu and goes back to its card", async () => {
    stored = savedDeck([MAIN.code, MAIN.code]);
    render(<SavedDeckEditor deckId="7" />);
    const copies = await screen.findAllByRole("button", { name: copyName });
    fireEvent.contextMenu(copies[0]!);
    await screen.findByRole("dialog", { name: menuName });
    await waitFor(() => expect(screen.getByRole("dialog", { name: menuName }).contains(document.activeElement)).toBe(true));
    fireEvent.contextMenu(copies[1]!);
    await waitFor(() => expect(screen.getByRole("dialog", { name: menuName }).contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(copies[1]).toHaveFocus();
  });
});
