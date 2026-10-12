// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedDeck } from "@yugidraft/shared/duels";
import type { ImportPreviewRow } from "../../src/components/decks/import-api";
import { SavedDeckLibrary } from "../../src/components/decks/library";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const EMPTY = { main: [], extra: [], side: [], deckMaster: null };

function row(id: string, name: string, extra: Partial<ImportPreviewRow> = {}): ImportPreviewRow {
  return {
    rowId: id,
    sourceId: id.split("#")[0],
    name,
    deck: { ...EMPTY, main: [89631139, 89631139, 55144522] },
    counts: { main: 3, extra: 0, side: 0 },
    errors: [],
    warnings: [],
    duplicateOf: null,
    ...extra,
  };
}

type Call = { url: string; body: unknown };
const calls: Call[] = [];
let previewReply: () => Response;
let bulkReply: (body: { rows: Array<{ name: string }> }) => Response;
let listCount = 0;

beforeEach(() => {
  calls.length = 0;
  listCount = 0;
  previewReply = () => Response.json({ maxDecks: 50, rows: [] });
  bulkReply = () => Response.json({ created: [], failed: [] });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/decks/import/preview" || url === "/api/decks/import/bulk") {
      const body = JSON.parse(String(init?.body));
      calls.push({ url, body });
      return url.endsWith("preview") ? previewReply() : bulkReply(body);
    }
    if (url === "/api/decks") {
      listCount += 1;
      return Response.json({ decks: [] satisfies SavedDeck[] });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openPaste(text: string) {
  render(<SavedDeckLibrary />);
  await screen.findByText(/No saved decks yet/);
  fireEvent.click(screen.getByRole("button", { name: "Import decks" }));
  fireEvent.click(screen.getByRole("button", { name: "Paste" }));
  fireEvent.change(screen.getByLabelText("YDK text or YDKE codes"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Preview decks" }));
}

const TWO_CODES = "ydke://o6lXBQ==!!!\nydke://ykw8BA==!!!";

describe("bulk deck import panel", () => {
  it("previews two pasted YDKE lines as two rows", async () => {
    previewReply = () => Response.json({
      maxDecks: 50,
      rows: [row("paste#0", "Imported deck 1"), row("paste#1", "Imported deck 2", { counts: { main: 40, extra: 15, side: 2 } })],
    });
    await openPaste(TWO_CODES);

    const list = await screen.findByRole("list", { name: "Decks to import" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByLabelText("Deck name for Imported deck 1")).toHaveValue("Imported deck 1");
    expect(within(list).getAllByRole("checkbox", { checked: true })).toHaveLength(2);
    expect(calls).toEqual([{
      url: "/api/decks/import/preview",
      body: { sources: [{ id: "paste", name: "Pasted deck", text: TWO_CODES }] },
    }]);
    expect(screen.getByText(/2 decks found, 2 selected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 2 decks" })).toBeEnabled();
  });

  it("leaves an error row unchecked and disabled, and shows its details on demand", async () => {
    previewReply = () => Response.json({
      maxDecks: 50,
      rows: [
        row("paste#0", "Good"),
        row("paste#1", "Broken", { errors: [{ code: "unknown_card", message: "Card 123 does not exist.", passcode: 123 }] }),
      ],
    });
    await openPaste(TWO_CODES);
    await screen.findByRole("list", { name: "Decks to import" });

    const broken = screen.getByLabelText("Broken cannot be imported");
    expect(broken).not.toBeChecked();
    expect(broken).toBeDisabled();
    expect(screen.getByText(/1 selected, 1 with errors/)).toBeInTheDocument();

    expect(screen.queryByText("Card 123 does not exist.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /1 error/ }));
    expect(screen.getByText("Card 123 does not exist.")).toBeInTheDocument();

    // Select all never checks the blocked row.
    fireEvent.click(screen.getByLabelText("Select all"));
    expect(screen.getByLabelText("Import Good")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("Select all"));
    expect(screen.getByLabelText("Import Good")).toBeChecked();
    expect(broken).not.toBeChecked();
  });

  it("starts a duplicate unchecked and names what it duplicates", async () => {
    previewReply = () => Response.json({
      maxDecks: 50,
      rows: [
        row("paste#0", "Fresh"),
        row("paste#1", "Branded copy", { duplicateOf: { kind: "saved", deckId: 12, name: "Branded" } }),
        row("paste#2", "Fresh again", { duplicateOf: { kind: "row", rowId: "paste#0" } }),
      ],
    });
    await openPaste(TWO_CODES);
    await screen.findByRole("list", { name: "Decks to import" });

    expect(screen.getByText("Duplicate of Branded")).toBeInTheDocument();
    expect(screen.getByText("Duplicate of Fresh")).toBeInTheDocument();
    expect(screen.getByLabelText("Import Fresh")).toBeChecked();
    expect(screen.getByLabelText("Import Branded copy")).not.toBeChecked();
    expect(screen.getByLabelText("Import Fresh again")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Import 1 deck" })).toBeEnabled();
  });

  it("imports only the checked rows with their edited names, then shows the result and reloads the library", async () => {
    previewReply = () => Response.json({
      maxDecks: 50,
      rows: [row("f0#0", "Alpha"), row("f1#0", "Beta"), row("f2#0", "Gamma")],
    });
    bulkReply = (body) => Response.json({
      created: [{ id: 31, name: body.rows[0].name }],
      failed: [{ index: 1, errors: [{ code: "deck_limit", message: "You have too many decks." }] }],
    });
    await openPaste(TWO_CODES);
    await screen.findByRole("list", { name: "Decks to import" });
    const listLoads = listCount;

    fireEvent.change(screen.getByLabelText("Deck name for Alpha"), { target: { value: "  Alpha Prime " } });
    fireEvent.click(screen.getByLabelText("Import Beta"));
    fireEvent.click(screen.getByLabelText("Import Beta"));
    fireEvent.click(screen.getByLabelText("Import Gamma"));
    fireEvent.click(screen.getByRole("button", { name: "Import 2 decks" }));

    await screen.findByText("1 deck was created.");
    const bulk = calls.find((call) => call.url === "/api/decks/import/bulk")!;
    expect(bulk.body).toEqual({
      rows: [
        { name: "Alpha Prime", deck: { ...EMPTY, main: [89631139, 89631139, 55144522] } },
        { name: "Beta", deck: { ...EMPTY, main: [89631139, 89631139, 55144522] } },
      ],
    });
    expect(within(screen.getByRole("list", { name: "Created decks" })).getByText("Alpha Prime")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Alpha Prime" })).toHaveAttribute("href", "/decks/31");
    expect(screen.getByText("1 deck could not be created.")).toBeInTheDocument();
    expect(screen.getByText("You have too many decks.")).toBeInTheDocument();
    await waitFor(() => expect(listCount).toBeGreaterThan(listLoads));
  });

  it("sends picked files as sources and skips a file over the size limit", async () => {
    previewReply = () => Response.json({ maxDecks: 50, rows: [row("f0#0", "Branded")] });
    render(<SavedDeckLibrary />);
    await screen.findByText(/No saved decks yet/);
    fireEvent.click(screen.getByRole("button", { name: "Import decks" }));
    const big = new File(["x".repeat(65 * 1024)], "Huge.ydk");
    fireEvent.change(screen.getByLabelText("Deck files"), {
      target: { files: [new File(["#main\n89631139\n"], "Branded.ydk"), big] },
    });

    await screen.findByRole("list", { name: "Decks to import" });
    expect(calls[0].body).toEqual({ sources: [{ id: "f0", name: "Branded.ydk", text: "#main\n89631139\n" }] });
    expect(screen.getByText(/Huge\.ydk is too large/)).toBeInTheDocument();
  });

  it("shows the server's limit message for a 413", async () => {
    previewReply = () => Response.json({ error: "Too many decks. The limit is 50." }, { status: 413 });
    await openPaste(TWO_CODES);
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many decks. The limit is 50.");
    expect(screen.getByRole("button", { name: "Preview decks" })).toBeEnabled();
  });

  it("explains a network failure and keeps the preview when the import call fails", async () => {
    previewReply = () => Response.json({ maxDecks: 50, rows: [row("paste#0", "Good")] });
    await openPaste(TWO_CODES);
    await screen.findByRole("list", { name: "Decks to import" });

    const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
      if (url === "/api/decks/import/bulk") throw new TypeError("Failed to fetch");
      return original(url, init);
    });
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deck" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
    expect(screen.getByRole("list", { name: "Decks to import" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 1 deck" })).toBeEnabled();
  });

  it("says so when the server finds no decks", async () => {
    await openPaste(TWO_CODES);
    expect(await screen.findByText("No decks were found in this import.")).toBeInTheDocument();
  });
});
