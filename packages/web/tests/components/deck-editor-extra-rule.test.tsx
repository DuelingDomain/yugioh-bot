// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckCardInfo, SavedDeck } from "@yugidraft/shared/duels";
import { parseDeckText } from "../../src/components/duel/ydk";
import { SavedDeckEditor } from "../../src/components/decks/editor";
import { DeckImportPanel, type DeckImporter } from "../../src/components/decks/import-panel";
import {
  CARD_DETAILS_PENDING_MESSAGE,
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
const MAGIA = card(12381100, "Dragon Master Magia", 97, 12);
const FAIRY = card(43321985, "Ancient Fairy Life Dragon", 8225, 8);
const ALT_ART = { ...card(1546124, "Cyber End Dragon", 97, 10), alias: 1546123 };
const PRE_RELEASE = card(101402084, "Kumenyo, the Nine-Hued Deer", 0x800021, 5);
const CARDS = [BLUE_EYES, POT, MIRROR, FUSION, SYNCHRO, XYZ, LINK, PENDULUM, MAGIA, FAIRY, ALT_ART, PRE_RELEASE];
const puts: Array<{ url: string; deck: SavedDeck["deck"] }> = [];
let stored: SavedDeck | null = null;
/** What the server's import route answers; the default keeps the pasted sections, as an old server would. */
let importAnswer: ((text: string) => { deck: SavedDeck["deck"]; moves: unknown[]; messages: string[] }) | null = null;

function savedDeck(deck: Partial<SavedDeck["deck"]>): SavedDeck {
  return { id: 7, name: "Old deck", mode: "normal", deck: { main: [], extra: [], side: [], ...deck }, createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z" };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/decks/import") {
      const { text, mode } = JSON.parse(String(init?.body)) as { text: string; mode: string };
      return Response.json({ mode, ...(importAnswer ? importAnswer(text) : { deck: parseDeckText(text), moves: [], messages: [] }) });
    }
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
  importAnswer = null;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const region = (name: string) => screen.getByRole("region", { name: `${name} Deck` });
const cardsIn = (name: string) => within(region(name)).queryAllByRole("button", { name: new RegExp(`${name} Deck card`) });
const namesIn = (name: string) => cardsIn(name).map((button) => button.getAttribute("aria-label")!.split(/, (?:Main|Extra|Side) Deck card /)[0]);
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
    expect(notice()).toContain(subject.name);
  });

  it.each([FUSION, SYNCHRO, XYZ, LINK, MAGIA, FAIRY, ALT_ART, PRE_RELEASE])("takes $name in the Extra Deck", async (subject) => {
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
    expect(notice()).toContain(FUSION.name);

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
  it.each([MAGIA, ALT_ART, PRE_RELEASE])("moves engine card $name from Side to Extra", async subject => {
    await renderStored({ side: [subject.code] });
    fireEvent.click(cardsIn("Side")[0]!, { detail: 1, ctrlKey: true });
    expect(namesIn("Side")).toEqual([]);
    expect(namesIn("Extra")).toEqual([subject.name]);
    expect(cardsIn("Main")).toHaveLength(0);
  });
  it.each([MAGIA, ALT_ART, PRE_RELEASE])("keeps engine Extra card $name when Fairy Life Dragon is added and saved", async entry => {
    await renderStored({ extra: [entry.code] });
    fireEvent.doubleClick(await tile(FAIRY.name));
    expect(cardsIn("Extra").map(button => button.getAttribute("aria-label")))
      .toEqual([expect.stringContaining(entry.name), expect.stringContaining(FAIRY.name)]);
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.deck.extra).toEqual([entry.code, FAIRY.code]);
  });
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
    // Not `disabled`, so it keeps focus; its name carries the reason.
    const add = within(details).getByRole("button", { name: `Add one Pot of Greed to Extra. Not allowed: Pot of Greed: ${SPELL_TRAP_EXTRA_MESSAGE}` });
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).not.toBeDisabled();
    expect(add).toHaveAttribute("title", `Pot of Greed: ${SPELL_TRAP_EXTRA_MESSAGE}`);
    fireEvent.click(add);
    expect(namesIn("Extra")).toEqual([POT.name]);
    // Main and Side work.
    fireEvent.click(within(details).getByRole("button", { name: "Add one Pot of Greed to Main" }));
    expect(namesIn("Main")).toEqual([POT.name]);
  });

  it("has no Add button for the Main Deck on an Extra Deck monster that an old save put in Main", async () => {
    await renderStored({ main: [FUSION.code] });
    fireEvent.click(await tile("Blue-Eyes Ultimate Dragon, 1 in deck"));
    const add = within(screen.getByRole("complementary", { name: "Card details" })).getByRole("button", { name: /^Add one Blue-Eyes Ultimate Dragon to Main/ });
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).toHaveAttribute("title", `${FUSION.name}: ${EXTRA_MONSTER_MAIN_MESSAGE}`);
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
    const warning = await within(region("Extra")).findByRole("status");
    expect(warning).toHaveTextContent("3 cards here are not Extra Deck monsters");
    expect(region("Main").querySelector("[role=status]")).toBeNull();
    fireEvent.click(within(region("Extra")).getByRole("button", { name: "Move to Main Deck" }));
    expect(namesIn("Main")).toEqual([BLUE_EYES.name, POT.name, PENDULUM.name, MIRROR.name]);
    expect(namesIn("Extra")).toEqual([FUSION.name]);
    expect(within(region("Extra")).queryByRole("status")).toBeNull();
    expect(notice()).toContain("Moved 3 cards to the Main Deck");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(namesIn("Extra")).toEqual([POT.name, FUSION.name, PENDULUM.name, MIRROR.name]);
    expect(await within(region("Extra")).findByRole("status")).toBeInTheDocument();
  });

  it("uses the singular for one card", async () => {
    await renderStored({ extra: [POT.code] });
    expect(await within(region("Extra")).findByRole("status")).toHaveTextContent("1 card here is not an Extra Deck monster");
  });

  it("warns on the Main section for an Extra Deck monster and moves it to Extra", async () => {
    await renderStored({ main: [BLUE_EYES.code, SYNCHRO.code] });
    const warning = await within(region("Main")).findByRole("status");
    expect(warning).toHaveTextContent("1 card here is an Extra Deck monster");
    expect(within(region("Extra")).queryByRole("status")).toBeNull();
    fireEvent.click(within(region("Main")).getByRole("button", { name: "Move to Extra Deck" }));
    expect(namesIn("Main")).toEqual([BLUE_EYES.name]);
    expect(namesIn("Extra")).toEqual([SYNCHRO.name]);
  });

  it("shows no warning for a deck that follows the rule, Pendulum main-deck monsters included", async () => {
    await renderStored({ main: [POT.code, PENDULUM.code], extra: [FUSION.code, SYNCHRO.code, XYZ.code, LINK.code] });
    await screen.findByRole("button", { name: /^Decode Talker, Extra Deck card/ });
    expect(screen.queryByRole("button", { name: /Move to/ })).toBeNull();
  });

  it("does not save a deck with a bad Extra card until the cards are moved", async () => {
    await renderStored({ extra: [POT.code] });
    await within(region("Extra")).findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    expect(await screen.findAllByText(/in the warning first/)).toHaveLength(1);
    expect(puts).toHaveLength(0);

    fireEvent.click(within(region("Extra")).getByRole("button", { name: "Move to Main Deck" }));
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.deck).toEqual({ main: [POT.code], extra: [], side: [] });
  });

  it("shows the problem in the deck summary", async () => {
    await renderStored({ extra: [POT.code, MIRROR.code] });
    await within(region("Extra")).findByRole("status");
    expect(screen.getAllByText(/Extra holds 2 cards that are not Extra Deck monsters/)).toHaveLength(1);
  });
});

describe("Extra Deck rule: decks the server repaired", () => {
  const repairOf = (count: number, mainCount: number, extra: Partial<NonNullable<SavedDeck["extraDeckRepair"]>> = {}): SavedDeck["extraDeckRepair"] => ({
    applied: true, mainCount, message: "server text",
    moves: Array.from({ length: count }, () => ({ code: POT.code, name: POT.name, from: "extra" as const, to: "main" as const })),
    ...extra,
  });
  const repairNotice = () => screen.queryByTestId("extra-repair-notice");

  async function renderRepaired(deck: Partial<SavedDeck["deck"]>, repair: SavedDeck["extraDeckRepair"]) {
    stored = { ...savedDeck(deck), extraDeckRepair: repair };
    render(<SavedDeckEditor deckId="7" />);
    await screen.findByTestId("extra-repair-notice");
    await waitFor(() => expect(screen.getAllByRole("button").some((button) => / Deck card /.test(button.getAttribute("aria-label") ?? ""))).toBe(true));
  }

  it("shows one quiet notice and no section warning or summary note", async () => {
    await renderRepaired({ main: [BLUE_EYES.code, POT.code, MIRROR.code], extra: [FUSION.code] }, repairOf(2, 3));
    expect(repairNotice()).toHaveTextContent("We moved 2 cards from your Extra Deck to your Main Deck.");
    expect(repairNotice()).not.toHaveTextContent("Trim");
    expect(screen.queryByRole("button", { name: /Move to/ })).toBeNull();
    expect(screen.queryAllByText(/Extra holds/)).toHaveLength(0);
  });

  it("tells the user to trim a Main Deck above 60 and still lets the user save", async () => {
    const main = Array.from({ length: 61 }, () => POT.code);
    await renderRepaired({ main, extra: [] }, repairOf(1, 61));
    expect(repairNotice()).toHaveTextContent("Main now has 61 cards. Trim it to 60 or fewer. You can still edit and save.");
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(puts).toHaveLength(1));
    await waitFor(() => expect(repairNotice()).toBeNull());
  });

  it("drops the trim hint once Main is back at 60", async () => {
    const main = Array.from({ length: 61 }, () => POT.code);
    await renderRepaired({ main, extra: [] }, repairOf(1, 61));
    fireEvent.keyDown(cardsIn("Main")[0]!, { key: "Delete" });
    await waitFor(() => expect(repairNotice()).not.toHaveTextContent("Trim"));
  });

  it("shows the server message when the repair was not applied, with no section fix next to it", async () => {
    await renderRepaired({ extra: [POT.code] }, repairOf(1, 301, { applied: false, message: "Too big to move." }));
    expect(repairNotice()).toHaveTextContent("Too big to move.");
    expect(screen.queryAllByText(/Extra holds/)).toHaveLength(0);
    // The server could not move them, so the section does not offer a move that could not be saved.
    expect(within(region("Extra")).getByRole("status")).toHaveTextContent("1 card here is not an Extra Deck monster");
    expect(within(region("Extra")).queryByRole("button", { name: "Move to Main Deck" })).toBeNull();
  });

  it("says it stays until the deck is saved, and Dismiss only hides it for this visit", async () => {
    await renderRepaired({ main: [POT.code] }, repairOf(1, 1));
    expect(repairNotice()).toHaveTextContent("This note stays until you save the deck.");
    fireEvent.click(within(repairNotice()!).getByRole("button", { name: "Dismiss" }));
    expect(repairNotice()).toBeNull();
    // Focus goes to the Main heading, not to the page.
    expect(document.activeElement).toBe(within(region("Main")).getByRole("heading", { name: "Main" }));
    cleanup();
    // The server still has the note, so the next visit shows it again.
    render(<SavedDeckEditor deckId="7" />);
    expect(await screen.findByTestId("extra-repair-notice")).toHaveTextContent("We moved 1 card from your Extra Deck");
  });

  it("clears with one save of the deck that is not otherwise changed", async () => {
    await renderRepaired({ main: [POT.code] }, repairOf(1, 1));
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(puts).toHaveLength(1));
    await waitFor(() => expect(repairNotice()).toBeNull());
  });

  it("is not a live region, so a count change is not read out again", async () => {
    await renderRepaired({ main: Array.from({ length: 62 }, () => POT.code) }, repairOf(2, 62));
    expect(repairNotice()).not.toHaveAttribute("role", "status");
    expect(repairNotice()).not.toHaveAttribute("role", "alert");
    expect(repairNotice()).toHaveAttribute("role", "group");
  });
});

describe("Extra Deck rule: focus after a fix", () => {
  it("moves focus to the Extra heading after Move to Main Deck, and clears the old save error", async () => {
    await renderStored({ extra: [POT.code] });
    await within(region("Extra")).findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    expect(await screen.findAllByText(/in the warning first/)).toHaveLength(1);
    fireEvent.click(within(region("Extra")).getByRole("button", { name: "Move to Main Deck" }));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(within(region("Extra")).getByRole("heading", { name: "Extra" }));
    expect(screen.queryAllByText(/in the warning first/)).toHaveLength(0);
  });

  it("moves focus to the Main heading after Move to Extra Deck", async () => {
    await renderStored({ main: [SYNCHRO.code] });
    await within(region("Main")).findByRole("status");
    fireEvent.click(within(region("Main")).getByRole("button", { name: "Move to Extra Deck" }));
    expect(document.activeElement).toBe(within(region("Main")).getByRole("heading", { name: "Main" }));
  });
});

describe("Extra Deck rule: cards without details, and the Deck Master", () => {
  it("refuses a deck card whose details are still loading and says why", async () => {
    stored = savedDeck({ main: [123456789] });
    render(<SavedDeckEditor deckId="7" />);
    await waitFor(() => expect(screen.queryByText("Loading deck…")).toBeNull());
    const unknown = await within(region("Main")).findByRole("button", { name: /^Passcode 123456789/ });
    // Without the kind the section cannot refuse at dragover; the drop is refused with the reason.
    drag(unknown).drop(region("Extra"));
    expect(cardsIn("Extra")).toHaveLength(0);
    expect(cardsIn("Main")).toHaveLength(1);
    expect(notice()).toContain(CARD_DETAILS_PENDING_MESSAGE);
  });

  it("keeps a monster Deck Master out of Extra when it is dragged there", async () => {
    stored = { ...savedDeck({ main: [POT.code] }), mode: "domain" };
    stored.deck.deckMaster = BLUE_EYES.code;
    render(<SavedDeckEditor deckId="7" />);
    const master = await screen.findByRole("button", { name: /^Deck Master: Blue-Eyes White Dragon/ });
    const held = drag(master);
    expect(held.over(region("Extra"))).toBe(false);
    held.drop(region("Extra"));
    expect(cardsIn("Extra")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /^Deck Master: Blue-Eyes White Dragon/ })).toBeInTheDocument();
    expect(notice()).toContain(MAIN_MONSTER_EXTRA_MESSAGE);
  });
});

describe("Extra Deck rule: import and paste", () => {
  async function pasteList(text: string) {
    render(<SavedDeckEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    const popover = await screen.findByRole("dialog", { name: "Import a deck" });
    fireEvent.change(within(popover).getByLabelText("Or paste YDK text or a ydke:// link"), { target: { value: text } });
    fireEvent.click(within(popover).getByRole("button", { name: "Load paste" }));
  }

  it("shows the server's move message once and no warning when the server routed the cards", async () => {
    const message = "1 card moved from Extra Deck to Main Deck: Pot of Greed.";
    importAnswer = () => ({ deck: { main: [BLUE_EYES.code, POT.code], extra: [FUSION.code], side: [] }, moves: [{ code: POT.code, name: POT.name, from: "extra", to: "main" }], messages: [message] });
    await pasteList(`#main\n${BLUE_EYES.code}\n#extra\n${POT.code}\n${FUSION.code}\n!side`);
    await waitFor(() => expect(namesIn("Extra")).toEqual([FUSION.name]));
    expect(namesIn("Main")).toEqual([BLUE_EYES.name, POT.name]);
    expect(screen.getAllByText(new RegExp(message.replace(/[.]/g, "\\.")))).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the move message after the 4 second notice is gone, until it is dismissed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const message = "1 card moved from Extra Deck to Main Deck: Pot of Greed.";
      importAnswer = () => ({ deck: { main: [POT.code], extra: [], side: [] }, moves: [], messages: [message] });
      await pasteList(`#main\n${POT.code}`);
      await waitFor(() => expect(screen.getAllByText(message)).toHaveLength(1));
      // The polite notice says that a note is there, since the note itself is not a live region.
      expect(screen.getByText(/Deck imported\. 1 note about moved cards above/)).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
      expect(screen.queryByText(/Deck imported/)).toBeNull();
      expect(screen.getAllByText(message)).toHaveLength(1);
      fireEvent.click(within(screen.getByTestId("import-messages")).getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByText(message)).toBeNull();
      expect(document.activeElement).toBe(within(region("Main")).getByRole("heading", { name: "Main" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the move message when the import is undone", async () => {
    importAnswer = () => ({ deck: { main: [POT.code], extra: [], side: [] }, moves: [], messages: ["1 card moved from Extra Deck to Main Deck: Pot of Greed."] });
    await pasteList(`#main\n${POT.code}`);
    await screen.findByTestId("import-messages");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByTestId("import-messages")).toBeNull();
  });

  it("keeps the move message when a later edit is undone, and clears it when the import itself is undone", async () => {
    importAnswer = () => ({ deck: { main: [POT.code], extra: [], side: [] }, moves: [], messages: ["1 card moved from Extra Deck to Main Deck: Pot of Greed."] });
    await pasteList(`#main\n${POT.code}`);
    await screen.findByTestId("import-messages");
    fireEvent.doubleClick(await tile(MIRROR.name));
    expect(namesIn("Main")).toContain(MIRROR.name);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(namesIn("Main")).not.toContain(MIRROR.name);
    expect(screen.getByTestId("import-messages")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByTestId("import-messages")).toBeNull();
  });

  it("clears the move message when the next import fails", async () => {
    importAnswer = () => ({ deck: { main: [POT.code], extra: [], side: [] }, moves: [], messages: ["1 card moved from Extra Deck to Main Deck: Pot of Greed."] });
    await pasteList(`#main\n${POT.code}`);
    await screen.findByTestId("import-messages");
    importAnswer = () => { throw new Error("Server down"); };
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    const popover = await screen.findByRole("dialog", { name: "Import a deck" });
    fireEvent.change(within(popover).getByLabelText("Or paste YDK text or a ydke:// link"), { target: { value: "#main\n1" } });
    fireEvent.click(within(popover).getByRole("button", { name: "Load paste" }));
    await waitFor(() => expect(screen.queryByTestId("import-messages")).toBeNull());
  });

  it("shows the import as busy while the server answers a chosen file", async () => {
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => { answer = resolve; });
    const pass = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (url === "/api/decks/import") await gate;
      return pass(url, init);
    });
    render(<SavedDeckEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    const popover = await screen.findByRole("dialog", { name: "Import a deck" });
    const file = new File([`#main\n${POT.code}`], "Pot.ydk", { type: "text/plain" });
    fireEvent.change(within(popover).getByLabelText("YDK file"), { target: { files: [file] } });
    await waitFor(() => expect(popover.querySelector('[aria-busy="true"]')).not.toBeNull());
    // The drop zone itself says so, not only the paste button.
    expect(popover.querySelector('[aria-busy="true"]')).toHaveTextContent("Importing…");
    answer();
    await waitFor(() => expect(namesIn("Main")).toEqual([POT.name]));
  });

  it("clears the move message on the next save", async () => {
    const message = "1 card moved from Extra Deck to Main Deck: Pot of Greed.";
    importAnswer = () => ({ deck: { main: [POT.code], extra: [], side: [] }, moves: [], messages: [message] });
    stored = savedDeck({});
    render(<SavedDeckEditor deckId="7" />);
    await waitFor(() => expect(screen.queryByText("Loading deck…")).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    const popover = await screen.findByRole("dialog", { name: "Import a deck" });
    fireEvent.change(within(popover).getByLabelText("Or paste YDK text or a ydke:// link"), { target: { value: `#main\n${POT.code}` } });
    fireEvent.click(within(popover).getByRole("button", { name: "Load paste" }));
    await screen.findByTestId("import-messages");
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(screen.queryByTestId("import-messages")).toBeNull());
  });

  it("shows a busy button while the server answers a paste", async () => {
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => { answer = resolve; });
    const pass = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (url === "/api/decks/import") await gate;
      return pass(url, init);
    });
    await pasteList(`#main\n${POT.code}`);
    const busy = await screen.findByRole("button", { name: "Importing…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    answer();
    await waitFor(() => expect(namesIn("Main")).toEqual([POT.name]));
  });

  it("still warns, and the fix button repairs it, when a list arrives with a Spell in the Extra section", async () => {
    await pasteList(`#main\n${BLUE_EYES.code}\n#extra\n${POT.code}\n${FUSION.code}\n!side`);
    const warning = await within(region("Extra")).findByRole("status");
    expect(warning).toHaveTextContent("1 card here is not an Extra Deck monster");
    fireEvent.click(within(region("Extra")).getByRole("button", { name: "Move to Main Deck" }));
    expect(namesIn("Main")).toEqual([BLUE_EYES.name, POT.name]);
    expect(namesIn("Extra")).toEqual([FUSION.name]);
  });
});

describe("Extra Deck rule: the server refuses a bad Extra card", () => {
  it("shows the server message as the normal save error", async () => {
    await renderStored({ main: [POT.code] });
    const error = "Extra Deck can contain only Fusion, Synchro, Xyz, and Link monsters. Move Pot of Greed to Main Deck or Side Deck.";
    const answer = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => (
      url === "/api/decks/7" && init?.method === "PUT" ? Response.json({ error, code: "INVALID_EXTRA_DECK_CARD" }, { status: 400 }) : answer(url, init)
    ));
    fireEvent.doubleClick(await tile(POT.name));
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    // The code is read: the message stays and a short way on is added.
    expect(await screen.findAllByText(`${error} Then save again.`)).toHaveLength(1);
  });
});

describe("Extra Deck rule: the import panel messages", () => {
  function importer(messages: string[]): DeckImporter {
    return {
      tab: "files",
      setTab: vi.fn(),
      mode: "standard",
      setMode: vi.fn(),
      view: { phase: "preview", maxDecks: 50, outcome: null, items: [{
        name: "goat", selected: true, mode: "standard", failure: null,
        row: {
          rowId: "goat#0", sourceId: "goat", name: "goat", mode: "standard",
          deck: { main: [POT.code], extra: [], side: [], deckMaster: null },
          counts: { main: 1, extra: 0, side: 0 }, errors: [],
          warnings: messages.map(message => ({ code: "section_moved", message })),
        },
      }] },
      error: null, notes: [], heldCount: 0, cards: new Map([[POT.code, POT]]),
      previewFiles: vi.fn(), previewPaste: vi.fn(), retryHeld: vi.fn(), dropHeld: vi.fn(),
      recheck: vi.fn(), rename: vi.fn(), toggle: vi.fn(), toggleAll: vi.fn(), importSelected: vi.fn(), reset: vi.fn(),
    };
  }

  it("shows each server move message once in the import preview", () => {
    const messages = ["2 cards moved from Extra Deck to Main Deck: A, B.", "1 card moved from Main Deck to Extra Deck: C."];
    render(<DeckImportPanel importer={importer(messages)} dragging={false} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "2 warnings" }));
    for (const message of messages) expect(screen.getAllByText(message)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Import 1 deck" })).toBeEnabled();
  });

  it("shows no message when nothing moved", () => {
    render(<DeckImportPanel importer={importer([])} dragging={false} onClose={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Deck name for goat" })).toHaveValue("goat");
    expect(screen.queryByText(/moved from/)).toBeNull();
  });
});
