// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const sections = { main: [], extra: [], side: [], deckMaster: null };
let previewBody: { sources: Array<{ id: string; name: string; text: string }> } | null = null;

function stubApi() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/decks/import/preview") {
      previewBody = JSON.parse(String(init?.body));
      return Response.json({
        maxDecks: 50,
        rows: previewBody!.sources.map((source) => ({
          rowId: `${source.id}#0`, sourceId: source.id, name: source.name.replace(/\.ydk$/, ""),
          deck: { ...sections, main: [89631139] }, counts: { main: 1, extra: 0, side: 0 }, errors: [], warnings: [], duplicateOf: null,
        })),
      });
    }
    return Response.json({ decks: [] });
  }));
}

function ydkFile(name: string, text: string) {
  return new File([text], name, { type: "text/plain" });
}

afterEach(() => {
  previewBody = null;
  vi.unstubAllGlobals();
});

describe("SavedDeckLibrary", () => {
  it("marks a deck the server repaired, or could not repair, and no other", async () => {
    const base: Omit<SavedDeck, "id" | "name"> = { mode: "normal", deck: { main: [89631139], extra: [], side: [] }, createdAt: "2026-09-30 12:00:00", updatedAt: "2026-09-30 12:00:00" };
    const decks: SavedDeck[] = [
      { ...base, id: 1, name: "Fixed", extraDeckRepair: { applied: true, mainCount: 1, message: "x", moves: [{ code: 5318639, name: "Mystical Space Typhoon", from: "extra", to: "main" }] } },
      { ...base, id: 2, name: "Clean" },
      { ...base, id: 3, name: "Stuck", extraDeckRepair: { applied: false, mainCount: 301, message: "x", moves: [{ code: 5318639, name: "Mystical Space Typhoon", from: "extra", to: "main" }] } },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ decks })));
    render(<SavedDeckLibrary />);
    await screen.findByRole("link", { name: "Fixed" });
    // The server keeps the note until the deck is saved, and the row says so.
    expect(screen.getAllByText("1 card moved from Extra to Main. Open and save to clear.")).toHaveLength(1);
    expect(screen.getAllByText("Some Extra Deck cards do not belong there. Open to fix.")).toHaveLength(1);
  });

  it("lists each row's counts as plain items with no dots and omits an absent Master", async () => {
    const decks: SavedDeck[] = [
      {
        id: 1, name: "With master", mode: "domain",
        deck: { main: [89631139, 89631139], extra: [23995346], side: [14558127], deckMaster: 46986414 },
        createdAt: "2026-09-30 12:00:00", updatedAt: "2026-09-30 12:00:00",
      },
      {
        id: 2, name: "Without master", mode: "normal",
        deck: { main: [89631139, 89631139], extra: [23995346], side: [14558127] },
        createdAt: "2026-09-30 12:00:00", updatedAt: "2026-09-30 12:00:00",
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ decks })));
    render(<SavedDeckLibrary />);
    await screen.findByRole("link", { name: "With master" });

    for (const [name, expected] of [
      ["With master", ["Main 2", "Extra 1", "Side 1", "Master", expect.stringMatching(/^Updated /)]],
      ["Without master", ["Main 2", "Extra 1", "Side 1", expect.stringMatching(/^Updated /)]],
    ] as const) {
      const row = screen.getByRole("link", { name }).closest("li")!;
      const line = row.querySelector("p[class*='counts']")!;
      expect(Array.from(line.children, (item) => item.textContent)).toEqual(expected);
      expect(line.querySelector(".dot")).toBeNull();
      expect(Array.from(line.querySelectorAll("b"), (count) => count.textContent)).toEqual(["2", "1", "1"]);
    }
  });

  it("previews every chosen file as its own deck before anything saves", async () => {
    stubApi();
    render(<SavedDeckLibrary />);
    await screen.findByText(/No saved decks yet/);

    fireEvent.click(screen.getByRole("button", { name: "Import decks" }));
    fireEvent.change(screen.getByLabelText("Deck files"), {
      target: {
        files: [
          ydkFile("Blue_Eyes.ydk", "#main\n89631139\n#extra\n!side\n"),
          ydkFile("Master.ydk", "#deckmaster\n14558127\n#main\n89631139\n#extra\n!side\n"),
        ],
      },
    });

    const list = await screen.findByRole("list", { name: "Decks to import" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(previewBody!.sources.map((source) => source.name)).toEqual(["Blue_Eyes.ydk", "Master.ydk"]);
    expect(fetch).not.toHaveBeenCalledWith("/api/decks/import/bulk", expect.anything());
  });

  it("copies a library deck as a YDKE code", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ decks: [{
      id: 1, name: "One", mode: "normal", deck: { main: [89631139, 89631139], extra: [23995346], side: [14558127] },
      createdAt: "2026-09-30 12:00:00", updatedAt: "2026-09-30 12:00:00",
    }] })));
    render(<SavedDeckLibrary />);
    await screen.findByRole("link", { name: "One" });
    fireEvent.click(screen.getByRole("button", { name: "Copy One as YDKE" }));
    const section = (codes: number[]) => Buffer.from(Uint32Array.from(codes).buffer).toString("base64");
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      `ydke://${section([89631139, 89631139])}!${section([23995346])}!${section([14558127])}!`,
    ));
    expect(await screen.findByRole("status")).toHaveTextContent("YDKE code copied.");
  });

  const savedWithMaster = {
    id: 1, name: "Domain one", mode: "domain",
    deck: { main: [89631139], extra: [], side: [], deckMaster: 14558127 },
    createdAt: "2026-09-30 12:00:00", updatedAt: "2026-09-30 12:00:00",
  };

  it("tells the person that the Deck Master is not in the YDKE code", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ decks: [savedWithMaster] })));
    render(<SavedDeckLibrary />);
    await screen.findByRole("link", { name: "Domain one" });
    fireEvent.click(screen.getByRole("button", { name: "Copy Domain one as YDKE" }));
    expect(await screen.findByRole("status")).toHaveTextContent("The Deck Master is not part of YDKE.");
  });

  it.each([
    ["has no clipboard", undefined, /cannot use the clipboard/],
    ["is refused the clipboard", { writeText: vi.fn(async () => { throw new Error("denied"); }) }, /did not allow the copy/],
  ])("shows the code in a selectable box when the page %s", async (_label, clipboard, message) => {
    vi.stubGlobal("navigator", { ...navigator, clipboard });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ decks: [savedWithMaster] })));
    render(<SavedDeckLibrary />);
    await screen.findByRole("link", { name: "Domain one" });
    fireEvent.click(screen.getByRole("button", { name: "Copy Domain one as YDKE" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(message)).toBeInTheDocument();
    expect(within(dialog).getByText(/The Deck Master is not part of YDKE/)).toBeInTheDocument();
    const box = within(dialog).getByRole("textbox", { name: "YDKE code" });
    expect(box).toHaveAttribute("readonly");
    expect((box as HTMLTextAreaElement).value).toMatch(/^ydke:\/\/.+!.*!.*!$/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps focus inside the by-hand copy box, selects the code, and gives focus back on close", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ decks: [savedWithMaster] })));
    render(<SavedDeckLibrary />);
    await screen.findByRole("link", { name: "Domain one" });
    const copy = screen.getByRole("button", { name: "Copy Domain one as YDKE" });
    copy.focus();
    fireEvent.click(copy);

    const dialog = await screen.findByRole("dialog");
    const box = within(dialog).getByRole("textbox", { name: "YDKE code" }) as HTMLTextAreaElement;
    expect(box).toHaveFocus();
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(box.value.length);

    // Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last.
    const close = within(dialog).getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(box).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(copy).toHaveFocus();
  });

  it("closes the by-hand copy box with a click on the backdrop", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ decks: [savedWithMaster] })));
    render(<SavedDeckLibrary />);
    await screen.findByRole("link", { name: "Domain one" });
    fireEvent.click(screen.getByRole("button", { name: "Copy Domain one as YDKE" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(dialog.parentElement!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the moved-card report and saves the server-routed deck", async () => {
    const routed = { main: [901, 902], extra: [903], side: [] };
    const message = "2 cards moved from Extra Deck to Main Deck: Test Spell, Test Trap.";
    const writes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/decks/import/preview") {
        const body = JSON.parse(String(init?.body));
        const sourceId = body.sources[0].id;
        return Response.json({ maxDecks: 50, rows: [{
          rowId: `${sourceId}#0`, sourceId, name: "Test", mode: "standard",
          deck: { ...routed, deckMaster: null }, counts: { main: 2, extra: 1, side: 0 },
          errors: [], warnings: [{ code: "section_moved", message }],
        }] });
      }
      if (url === "/api/decks/import/bulk") {
        const body = JSON.parse(String(init?.body)); writes.push(body.rows[0].deck);
        return Response.json({ created: [{ id: 91, name: "Test" }], failed: [] });
      }
      if (url === "/api/duels/cards") return Response.json({ cards: [], missing: [] });
      return Response.json({ decks: [] });
    }));
    render(<SavedDeckLibrary />);
    await screen.findByText("No saved decks yet");
    fireEvent.click(screen.getByRole("button", { name: "Import decks" }));
    fireEvent.change(screen.getByLabelText("Deck files"), { target: { files: [ydkFile("Test.ydk", "#extra\n901\n902\n903")] } });
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(writes).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deck" }));
    await waitFor(() => expect(writes).toEqual([{ ...routed, deckMaster: null }]));
  });

  it("with no decks: one primary import action, bar buttons are secondary", async () => {
    stubApi();
    const { container } = render(<SavedDeckLibrary />);
    await screen.findByText("No saved decks yet");
    expect(container.querySelectorAll(".sv-btn.primary")).toHaveLength(1);
    const primary = screen.getByRole("button", { name: "Import YDK files" });
    expect(primary).toHaveClass("primary");
    expect(screen.getByRole("button", { name: "Import decks" })).not.toHaveClass("primary");
    expect(screen.getByRole("link", { name: "Create a deck" })).toHaveAttribute("href", "/decks/new");
    expect(screen.getAllByRole("link", { name: /^New deck$/ })[0]).not.toHaveClass("primary");
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    fireEvent.click(primary);
    expect(screen.getByLabelText("Deck files")).toBeInTheDocument();
  });

  it("keeps New deck primary once decks exist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ decks: [{
      id: 1, name: "One", mode: "normal", deck: { main: [89631139], extra: [], side: [] },
      createdAt: "2026-09-30 12:00:00", updatedAt: "2026-09-30 12:00:00",
    }] })));
    render(<SavedDeckLibrary />);
    await screen.findByRole("link", { name: "One" });
    expect(screen.getByRole("link", { name: /^New deck$/ })).toHaveClass("primary");
  });
});
