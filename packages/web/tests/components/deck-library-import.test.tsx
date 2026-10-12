// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDeckText } from "../../src/components/duel/ydk";
import type { SavedDeck } from "@yugidraft/shared/duels";
import { SavedDeckLibrary } from "../../src/components/decks/library";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const created: Array<{ name: string; mode: string }> = [];

function stubApi() {
  let nextId = 1;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/decks/import") {
      const { text, mode } = JSON.parse(String(init?.body));
      const deck = parseDeckText(text);
      if (!deck.main.length && !deck.extra.length && !deck.side.length && !deck.deckMaster) {
        return Response.json({ error: "No cards found. Is this a YDK file?", code: "INVALID_DECK_IMPORT" }, { status: 400 });
      }
      return Response.json({ deck, mode: deck.deckMaster ? "domain" : mode, moves: [], messages: [] });
    }
    if (url === "/api/decks" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Omit<SavedDeck, "id" | "createdAt" | "updatedAt">;
      created.push({ name: body.name, mode: body.mode });
      const deck: SavedDeck = { ...body, id: nextId++, createdAt: "2026-09-30 12:00:00", updatedAt: "2026-09-30 12:00:00" };
      return Response.json({ deck }, { status: 201 });
    }
    return Response.json({ decks: [] });
  }));
}

function ydkFile(name: string, text: string) {
  return new File([text], name, { type: "text/plain" });
}

afterEach(() => {
  created.length = 0;
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

  it("saves every chosen file as its own deck and lists it", async () => {
    stubApi();
    render(<SavedDeckLibrary />);
    await screen.findByText(/No saved decks yet/);

    fireEvent.click(screen.getByRole("button", { name: /Import YDK$/ }));
    fireEvent.change(screen.getByLabelText("YDK files"), {
      target: {
        files: [
          ydkFile("Blue_Eyes.ydk", "#main\n89631139\n#extra\n!side\n"),
          ydkFile("Notes.txt", "nothing here"),
          ydkFile("Master.ydk", "#deckmaster\n14558127\n#main\n89631139\n#extra\n!side\n"),
        ],
      },
    });

    await waitFor(() => expect(screen.getAllByText(/^Saved as/)).toHaveLength(2));
    expect(created).toEqual([
      { name: "Blue Eyes", mode: "normal" },
      { name: "Master", mode: "domain" },
    ]);
    expect(screen.getByText("No cards found. Is this a YDK file?")).toBeInTheDocument();

    const list = screen.getAllByRole("list").find((el) => el.querySelector("a[href='/decks/1']") && el.textContent?.includes("Updated"));
    expect(list).toBeDefined();
    expect(within(list!).getByText("Blue Eyes")).toBeInTheDocument();
    expect(within(list!).getByRole("link", { name: "Master" })).toBeInTheDocument();
  });

  it("shows the moved-card report and saves the server-routed deck", async () => {
    const routed = { main: [901, 902], extra: [903], side: [] };
    const message = "2 cards moved from Extra Deck to Main Deck: Test Spell, Test Trap.";
    const writes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/decks/import") return Response.json({ mode: "normal", deck: routed, moves: [
        { code: 901, name: "Test Spell", from: "extra", to: "main" }, { code: 902, name: "Test Trap", from: "extra", to: "main" },
      ], messages: [message] });
      if (url === "/api/decks" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)); writes.push(body.deck);
        return Response.json({ deck: { ...body, id: 91, createdAt: "", updatedAt: "" } }, { status: 201 });
      }
      return Response.json({ decks: [] });
    }));
    render(<SavedDeckLibrary />);
    await screen.findByText("No saved decks yet");
    fireEvent.click(screen.getByRole("button", { name: "Import YDK files" }));
    fireEvent.change(screen.getByLabelText("YDK files"), { target: { files: [ydkFile("Test.ydk", "#extra\n901\n902\n903")] } });
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(writes).toEqual([routed]);
  });

  it("with no decks: one primary, Import YDK files opens the import panel, bar buttons are secondary", async () => {
    stubApi();
    const { container } = render(<SavedDeckLibrary />);
    await screen.findByText("No saved decks yet");
    expect(container.querySelectorAll(".sv-btn.primary")).toHaveLength(1);
    const primary = screen.getByRole("button", { name: "Import YDK files" });
    expect(primary).toHaveClass("primary");
    expect(screen.getByRole("link", { name: "Create a deck" })).toHaveAttribute("href", "/decks/new");
    expect(screen.getAllByRole("link", { name: /^New deck$/ })[0]).not.toHaveClass("primary");
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    fireEvent.click(primary);
    expect(screen.getByLabelText("YDK files")).toBeInTheDocument();
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
