// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckCardInfo, SavedDeck } from "@yugidraft/shared/duels";
import { SavedDeckEditor } from "../../src/components/decks/editor";
import { DeckImportPanel, type DeckImporter } from "../../src/components/decks/import-panel";
import {
  EXTRA_MONSTER_MAIN_MESSAGE,
  MAIN_MONSTER_EXTRA_MESSAGE,
  SPELL_TRAP_EXTRA_MESSAGE,
} from "../../src/components/decks/model";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/decks/new",
}));

function card(code: number, name: string, type: number, level = 0): DeckCardInfo {
  return {
    code, name, description: `${name} text.`, type, attack: 1000, defense: 1000, level, attribute: 0x10,
    race: "Dragon", alias: 0, setcodes: [], lscale: 0, rscale: 0, arrows: 0, ot: 3,
  };
}

const BLUE_EYES = card(89631139, "Blue-Eyes White Dragon", 0x11, 8);
const POT = card(55144522, "Pot of Greed", 0x2);
const MIRROR = card(44095762, "Mirror Force", 0x4);
const FUSION = card(23995346, "Blue-Eyes Ultimate Dragon", 0x41, 12);
const SYNCHRO = card(70902743, "Red Dragon Archfiend", 0x2001, 8);
const XYZ = card(63767246, "Titanic Galaxy", 0x800001, 8);
const LINK = card(1861629, "Decode Talker", 0x4000001, 3);
// A Pendulum monster of the main deck: Pendulum is a frame, not an Extra Deck summon type.
const PENDULUM = card(16178681, "Odd-Eyes Pendulum Dragon", 0x1000021, 7);
const CARDS = [BLUE_EYES, POT, MIRROR, FUSION, SYNCHRO, XYZ, LINK, PENDULUM];
const puts: Array<{ url: string; deck: SavedDeck["deck"] }> = [];
let stored: SavedDeck | null = null;

function savedDeck(deck: Partial<SavedDeck["deck"]>): SavedDeck {
  return { id: 7, name: "Old deck", mode: "normal", deck: { main: [], extra: [], side: [], ...deck }, createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z" };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/decks/cards/facets") return Response.json({ archetypes: [], banlists: {} });
    if (url === "/api/decks/cards") return Response.json({ cards: CARDS, total: CARDS.length, offset: 0 });
    if (url === "/api/duels/cards") {
      const { codes } = JSON.parse(String(init?.body)) as { codes: number[] };
      return Response.json({ cards: CARDS.filter((entry) => codes.includes(entry.code)), missing: [] });
    }
    if (url === "/api/decks/7" && init?.method === "PUT") {
      puts.push({ url, deck: JSON.parse(String(init.body)).deck });
      return Response.json({ deck: { ...stored, ...JSON.parse(String(init.body)) } });
    }
    if (url === "/api/decks/7" && stored) return Response.json({ deck: stored });
    return Response.json({ error: "not found" }, { status: 404 });
  }));
});

afterEach(() => {
  puts.length = 0;
  stored = null;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const region = (name: string) => screen.getByRole("region", { name: `${name} Deck` });
const cardsIn = (name: string) => within(region(name)).queryAllByRole("button", { name: new RegExp(`${name} Deck card`) });
const namesIn = (name: string) => cardsIn(name).map((button) => button.getAttribute("aria-label")!.split(",")[0]);
const notice = () => screen.getAllByRole("status").map((node) => node.textContent).join(" | ");
const rightClick = (element: Element, init: { ctrlKey?: boolean } = {}) => {
  fireEvent.pointerDown(element, { pointerType: "mouse", button: 2, ...init });
  return fireEvent.contextMenu(element, { button: 2, ...init });
};

/** A drag data store like the browser's: the types can be read while the drag moves, the data only at the drop. */
function dragStore() {
  const data = new Map<string, string>();
  return {
    types: [] as string[], effectAllowed: "copyMove", dropEffect: "move",
    setData(type: string, value: string) { data.set(type, value); this.types = [...data.keys()]; },
    getData(type: string) { return data.get(type) ?? ""; },
  };
}

/** Starts a drag on `source` and returns what the Extra/Main region does when the card is held over it and dropped. */
function drag(source: Element) {
  const transfer = dragStore();
  fireEvent.dragStart(source, { dataTransfer: transfer });
  return {
    /** True when the section accepts the card at dragover (the browser then sends the drop). */
    over: (target: Element) => !fireEvent.dragOver(target, { dataTransfer: transfer }),
    drop: (target: Element) => fireEvent.drop(target, { dataTransfer: transfer }),
  };
}

/** A card list tile; its name gains ", 1 in deck" once a copy is in the deck. */
const tile = async (name: string) => within(await screen.findByRole("complementary", { name: "Card list" }))
  .findByRole("button", { name: new RegExp(`^${name.replace(/[-.*+?^${}()|[\]\\]/g, "\\$&")}(,|$)`) });

async function renderStored(deck: Partial<SavedDeck["deck"]>) {
  stored = savedDeck(deck);
  render(<SavedDeckEditor deckId="7" />);
  await waitFor(() => expect(screen.queryByText("Loading deck…")).toBeNull());
  // Card details load after the deck; wait until no tile is still a bare passcode.
  await waitFor(() => {
    const labels = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? "");
    expect(labels.some((label) => /^Passcode \d+/.test(label))).toBe(false);
    expect(labels.some((label) => / Deck card /.test(label))).toBe(true);
  });
}

describe("Extra Deck rule: drag from the card list", () => {
  it.each([
    ["a Spell", POT, SPELL_TRAP_EXTRA_MESSAGE],
    ["a Trap", MIRROR, SPELL_TRAP_EXTRA_MESSAGE],
    ["a Normal monster", BLUE_EYES, MAIN_MONSTER_EXTRA_MESSAGE],
    ["a Pendulum main-deck monster", PENDULUM, MAIN_MONSTER_EXTRA_MESSAGE],
  ])("refuses %s over the Extra Deck and keeps it out on a drop", async (_label, subject, message) => {
    render(<SavedDeckEditor />);
    const held = drag(await tile(subject.name));
    const extra = region("Extra");
    expect(held.over(extra)).toBe(false);
    expect(extra).toHaveAttribute("data-refused", "true");
    expect(within(extra).getByText(message)).toBeInTheDocument();
    held.drop(extra);
    expect(cardsIn("Extra")).toHaveLength(0);
    expect(cardsIn("Main")).toHaveLength(0);
    expect(notice()).toContain(message);
  });

  it.each([FUSION, SYNCHRO, XYZ, LINK])("takes $name in the Extra Deck", async (subject) => {
    render(<SavedDeckEditor />);
    const held = drag(await tile(subject.name));
    expect(held.over(region("Extra"))).toBe(true);
    expect(region("Extra")).not.toHaveAttribute("data-refused");
    held.drop(region("Extra"));
    expect(namesIn("Extra")).toEqual([subject.name]);
  });

  it("refuses an Extra Deck monster over the Main Deck, and a Spell or a Pendulum monster is welcome there", async () => {
    render(<SavedDeckEditor />);
    const held = drag(await tile(FUSION.name));
    expect(held.over(region("Main"))).toBe(false);
    expect(within(region("Main")).getByText(EXTRA_MONSTER_MAIN_MESSAGE)).toBeInTheDocument();
    held.drop(region("Main"));
    expect(cardsIn("Main")).toHaveLength(0);
    expect(cardsIn("Extra")).toHaveLength(0);
    expect(notice()).toContain(EXTRA_MONSTER_MAIN_MESSAGE);

    for (const subject of [POT, PENDULUM]) {
      const next = drag(await tile(subject.name));
      expect(next.over(region("Main"))).toBe(true);
      next.drop(region("Main"));
    }
    expect(namesIn("Main")).toEqual([POT.name, PENDULUM.name]);
  });

  it("lets any card over the Side Deck", async () => {
    render(<SavedDeckEditor />);
    for (const subject of [POT, FUSION]) {
      const held = drag(await tile(subject.name));
      expect(held.over(region("Side"))).toBe(true);
      held.drop(region("Side"));
    }
    expect(namesIn("Side")).toEqual([POT.name, FUSION.name]);
  });

  it("clears the refusal when the drag leaves", async () => {
    render(<SavedDeckEditor />);
    const held = drag(await tile(POT.name));
    held.over(region("Extra"));
    expect(region("Extra")).toHaveAttribute("data-refused", "true");
    fireEvent.dragLeave(region("Extra"), { relatedTarget: document.body });
    expect(region("Extra")).not.toHaveAttribute("data-refused");
  });
});

describe("Extra Deck rule: drag inside the deck", () => {
  it("keeps a Spell and a Pendulum monster in Main when dragged to Extra", async () => {
    await renderStored({ main: [POT.code, PENDULUM.code] });
    for (const button of cardsIn("Main")) {
      const held = drag(button);
      expect(held.over(region("Extra"))).toBe(false);
      held.drop(region("Extra"));
    }
    expect(namesIn("Main")).toEqual([POT.name, PENDULUM.name]);
    expect(cardsIn("Extra")).toHaveLength(0);
    expect(notice()).toContain(MAIN_MONSTER_EXTRA_MESSAGE);
  });

  it("keeps a Spell in Side when dragged to Extra, and an Extra monster in Side when dragged to Main", async () => {
    await renderStored({ side: [MIRROR.code, SYNCHRO.code] });
    const [spell, synchro] = cardsIn("Side");
    const first = drag(spell!);
    expect(first.over(region("Extra"))).toBe(false);
    first.drop(region("Extra"));
    expect(notice()).toContain(SPELL_TRAP_EXTRA_MESSAGE);
    const second = drag(synchro!);
    expect(second.over(region("Main"))).toBe(false);
    second.drop(region("Main"));
    expect(notice()).toContain(EXTRA_MONSTER_MAIN_MESSAGE);
    expect(namesIn("Side")).toEqual([MIRROR.name, SYNCHRO.name]);
    expect(cardsIn("Main")).toHaveLength(0);
    expect(cardsIn("Extra")).toHaveLength(0);
  });

  it("keeps an Extra monster in Extra when dragged to Main, and moves it to Side", async () => {
    await renderStored({ extra: [FUSION.code] });
    const held = drag(cardsIn("Extra")[0]!);
    expect(held.over(region("Main"))).toBe(false);
    held.drop(region("Main"));
    expect(namesIn("Extra")).toEqual([FUSION.name]);
    expect(cardsIn("Main")).toHaveLength(0);
    const toSide = drag(cardsIn("Extra")[0]!);
    expect(toSide.over(region("Side"))).toBe(true);
    toSide.drop(region("Side"));
    expect(namesIn("Side")).toEqual([FUSION.name]);
  });

  it("drops straight on a card tile of the wrong section with the same refusal", async () => {
    await renderStored({ main: [POT.code], extra: [FUSION.code] });
    const held = drag(cardsIn("Main")[0]!);
    const tileInExtra = cardsIn("Extra")[0]!.closest("li")!;
    expect(held.over(tileInExtra)).toBe(false);
    held.drop(tileInExtra);
    expect(namesIn("Main")).toEqual([POT.name]);
    expect(namesIn("Extra")).toEqual([FUSION.name]);
  });
});

describe("Extra Deck rule: add and move actions", () => {
  it("sends a double-click add, the + key and Shift+Enter on a Spell or a Pendulum monster to Main", async () => {
    render(<SavedDeckEditor />);
    fireEvent.doubleClick(await tile(POT.name));
    fireEvent.keyDown(await tile(PENDULUM.name), { key: "+" });
    fireEvent.keyDown(await tile(MIRROR.name), { key: "Enter", shiftKey: true });
    rightClick(await tile(MIRROR.name));
    expect(namesIn("Main")).toEqual([POT.name, PENDULUM.name, MIRROR.name, MIRROR.name]);
    expect(cardsIn("Extra")).toHaveLength(0);
  });

  it("sends an add of an Extra Deck monster to Extra, never to Main", async () => {
    render(<SavedDeckEditor />);
    fireEvent.doubleClick(await tile(LINK.name));
    fireEvent.keyDown(await tile(XYZ.name), { key: "+" });
    expect(namesIn("Extra")).toEqual([LINK.name, XYZ.name]);
    expect(cardsIn("Main")).toHaveLength(0);
  });

  it("has no Add button for the Extra Deck on a Spell, and a reason on the one an old save shows", async () => {
    await renderStored({ extra: [POT.code] });
    fireEvent.click(await tile("Pot of Greed, 1 in deck"));
    const details = screen.getByRole("complementary", { name: "Card details" });
    const add = within(details).getByRole("button", { name: "Add one Pot of Greed to Extra" });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute("title", SPELL_TRAP_EXTRA_MESSAGE);
    fireEvent.click(add);
    expect(namesIn("Extra")).toEqual([POT.name]);
    // Main and Side work.
    fireEvent.click(within(details).getByRole("button", { name: "Add one Pot of Greed to Main" }));
    expect(namesIn("Main")).toEqual([POT.name]);
  });

  it("has no Add button for the Main Deck on an Extra Deck monster that an old save put in Main", async () => {
    await renderStored({ main: [FUSION.code] });
    fireEvent.click(await tile("Blue-Eyes Ultimate Dragon, 1 in deck"));
    const add = within(screen.getByRole("complementary", { name: "Card details" })).getByRole("button", { name: "Add one Blue-Eyes Ultimate Dragon to Main" });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute("title", EXTRA_MONSTER_MAIN_MESSAGE);
  });

  it("moves a Side card back to where it belongs on Ctrl+click: Spell to Main, Extra monster to Extra", async () => {
    await renderStored({ side: [POT.code, FUSION.code, PENDULUM.code] });
    // Each move shifts the rest of the Side Deck up, so the first Side card is clicked three times.
    for (let moved = 0; moved < 3; moved += 1) fireEvent.click(cardsIn("Side")[0]!, { detail: 1, ctrlKey: true });
    expect(namesIn("Main")).toEqual([POT.name, PENDULUM.name]);
    expect(namesIn("Extra")).toEqual([FUSION.name]);
    expect(cardsIn("Side")).toHaveLength(0);
  });

  it("refuses to copy a card inside a section that does not take it", async () => {
    await renderStored({ extra: [POT.code] });
    const copy = await screen.findByRole("button", { name: /^Pot of Greed, Extra Deck card 1/ });
    rightClick(copy, { ctrlKey: true });
    fireEvent.keyDown(copy, { key: "+" });
    expect(namesIn("Extra")).toEqual([POT.name]);
    expect(notice()).toContain(SPELL_TRAP_EXTRA_MESSAGE);
  });
});

describe("Extra Deck rule: undo and redo", () => {
  it("never leaves a Spell in Extra after any undo or redo of moves the rule allows", async () => {
    render(<SavedDeckEditor />);
    fireEvent.doubleClick(await tile(POT.name));
    fireEvent.doubleClick(await tile(FUSION.name));
    // The blocked drop does not make an undo step.
    const held = drag(await tile(POT.name));
    held.drop(region("Extra"));
    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    const noSpellInExtra = () => expect(namesIn("Extra").every((name) => name === FUSION.name)).toBe(true);
    noSpellInExtra();
    fireEvent.click(undo);
    expect(cardsIn("Extra")).toHaveLength(0);
    fireEvent.click(undo);
    expect(cardsIn("Main")).toHaveLength(0);
    fireEvent.click(redo);
    fireEvent.click(redo);
    expect(namesIn("Main")).toEqual([POT.name]);
    expect(namesIn("Extra")).toEqual([FUSION.name]);
    noSpellInExtra();
    expect(redo).toBeDisabled();
  });
});

describe("Extra Deck rule: decks that already have the bug", () => {
  it("warns on the Extra section and moves the cards to Main with one click, then undoes", async () => {
    await renderStored({ main: [BLUE_EYES.code], extra: [POT.code, FUSION.code, PENDULUM.code, MIRROR.code] });
    const warning = await within(region("Extra")).findByRole("alert");
    expect(warning).toHaveTextContent("3 cards here are not Extra Deck monsters");
    expect(region("Main").querySelector("[role=alert]")).toBeNull();
    fireEvent.click(within(region("Extra")).getByRole("button", { name: "Move to Main Deck" }));
    expect(namesIn("Main")).toEqual([BLUE_EYES.name, POT.name, PENDULUM.name, MIRROR.name]);
    expect(namesIn("Extra")).toEqual([FUSION.name]);
    expect(within(region("Extra")).queryByRole("alert")).toBeNull();
    expect(notice()).toContain("Moved 3 cards to the Main Deck");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(namesIn("Extra")).toEqual([POT.name, FUSION.name, PENDULUM.name, MIRROR.name]);
    expect(await within(region("Extra")).findByRole("alert")).toBeInTheDocument();
  });

  it("uses the singular for one card", async () => {
    await renderStored({ extra: [POT.code] });
    expect(await within(region("Extra")).findByRole("alert")).toHaveTextContent("1 card here is not an Extra Deck monster");
  });

  it("warns on the Main section for an Extra Deck monster and moves it to Extra", async () => {
    await renderStored({ main: [BLUE_EYES.code, SYNCHRO.code] });
    const warning = await within(region("Main")).findByRole("alert");
    expect(warning).toHaveTextContent("1 card here is an Extra Deck monster");
    expect(within(region("Extra")).queryByRole("alert")).toBeNull();
    fireEvent.click(within(region("Main")).getByRole("button", { name: "Move to Extra Deck" }));
    expect(namesIn("Main")).toEqual([BLUE_EYES.name]);
    expect(namesIn("Extra")).toEqual([SYNCHRO.name]);
  });

  it("shows no warning for a deck that follows the rule, Pendulum main-deck monsters included", async () => {
    await renderStored({ main: [POT.code, PENDULUM.code], extra: [FUSION.code, SYNCHRO.code, XYZ.code, LINK.code] });
    await screen.findByRole("button", { name: /^Decode Talker, Extra Deck card/ });
    expect(screen.queryByRole("button", { name: /Move to/ })).toBeNull();
  });

  it("does not save the deck until the cards are moved", async () => {
    await renderStored({ extra: [POT.code] });
    await within(region("Extra")).findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    expect((await screen.findAllByText(/does not take them/)).length).toBeGreaterThan(0);
    expect(puts).toHaveLength(0);

    fireEvent.click(within(region("Extra")).getByRole("button", { name: "Move to Main Deck" }));
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.deck).toEqual({ main: [POT.code], extra: [], side: [] });
  });

  it("shows the problem in the deck summary", async () => {
    await renderStored({ extra: [POT.code, MIRROR.code] });
    await within(region("Extra")).findByRole("alert");
    expect(screen.getAllByText(/Extra holds 2 cards that are not Extra Deck monsters/).length).toBeGreaterThan(0);
  });
});

describe("Extra Deck rule: import and paste", () => {
  it("shows the warning when a pasted list puts a Spell in the Extra section, and the fix button repairs it", async () => {
    render(<SavedDeckEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    const popover = await screen.findByRole("dialog", { name: "Import a deck" });
    fireEvent.change(within(popover).getByLabelText("Or paste YDK text or a ydke:// link"), {
      target: { value: `#main\n${BLUE_EYES.code}\n#extra\n${POT.code}\n${FUSION.code}\n!side` },
    });
    fireEvent.click(within(popover).getByRole("button", { name: "Load paste" }));
    const warning = await within(region("Extra")).findByRole("alert");
    expect(warning).toHaveTextContent("1 card here is not an Extra Deck monster");
    fireEvent.click(within(region("Extra")).getByRole("button", { name: "Move to Main Deck" }));
    expect(namesIn("Main")).toEqual([BLUE_EYES.name, POT.name]);
    expect(namesIn("Extra")).toEqual([FUSION.name]);
  });
});

describe("Extra Deck rule: the import panel note", () => {
  function importer(note: string | null): DeckImporter {
    return {
      mode: "normal",
      setMode: vi.fn(),
      importFiles: vi.fn(),
      clearFinished: vi.fn(),
      rows: [{ key: 1, fileName: "goat.ydk", state: "saved", note, deck: { ...savedDeck({ main: [POT.code] }), id: 9, name: "goat" } }],
    } as unknown as DeckImporter;
  }

  it("shows the moved-cards note under the saved deck", () => {
    render(<DeckImportPanel importer={importer("2 cards were moved to the Main Deck.")} dragging={false} onClose={vi.fn()} />);
    expect(screen.getByText("2 cards were moved to the Main Deck.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/decks/9");
  });

  it("shows no note when nothing moved", () => {
    render(<DeckImportPanel importer={importer(null)} dragging={false} onClose={vi.fn()} />);
    expect(screen.getByText(/Saved as goat/)).toBeInTheDocument();
    expect(screen.queryByText(/moved to the Main Deck/)).toBeNull();
  });
});
