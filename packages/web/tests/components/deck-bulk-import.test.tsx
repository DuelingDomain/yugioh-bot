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
let previewReply: () => Response | Promise<Response>;
let bulkReply: (body: { rows: Array<{ name: string }> }) => Response | Promise<Response>;
let listCount = 0;
/** Card names by passcode for the batched card lookup. An empty map answers 404, as a lookup that is down. */
let cardNames: Map<number, string>;
let cardsReply: (codes: number[]) => Response | Promise<Response>;
const cardCalls: number[][] = [];

function cardInfo(code: number, name: string) {
  return { code, name, description: `${name} effect text.`, type: 1, attack: 0, defense: 0, level: 4, attribute: 1, race: "Warrior" };
}

beforeEach(() => {
  calls.length = 0;
  cardCalls.length = 0;
  listCount = 0;
  cardNames = new Map();
  cardsReply = (codes) => cardNames.size === 0
    ? Response.json({ error: "down" }, { status: 503 })
    : Response.json({ cards: codes.filter((code) => cardNames.has(code)).map((code) => cardInfo(code, cardNames.get(code)!)), missing: [] });
  previewReply = () => Response.json({ maxDecks: 50, rows: [] });
  bulkReply = () => Response.json({ created: [], failed: [] });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/decks/import/preview" || url === "/api/decks/import/bulk") {
      const body = JSON.parse(String(init?.body));
      calls.push({ url, body });
      return url.endsWith("preview") ? previewReply() : bulkReply(body);
    }
    if (url === "/api/duels/cards") {
      const { codes } = JSON.parse(String(init?.body)) as { codes: number[] };
      cardCalls.push(codes);
      return cardsReply(codes);
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
      body: { sources: [{ id: "b1-paste", name: "Pasted deck", text: TWO_CODES, mode: "standard" }] },
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

    // The first problem reads inline while the list is closed, and only once when it is open.
    expect(screen.getAllByText("Card 123 does not exist.")).toHaveLength(1);
    expect(screen.queryByText("unknown_card")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /1 error/ }));
    expect(screen.getAllByText("Card 123 does not exist.")).toHaveLength(1);
    expect(screen.getByText("unknown_card")).toBeInTheDocument();

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

  it("imports only the checked rows with their edited names, keeps the failed row, and reloads the library", async () => {
    previewReply = () => Response.json({
      maxDecks: 50,
      rows: [row("b1-f0#0", "Alpha"), row("b1-f1#0", "Beta"), row("b1-f2#0", "Gamma")],
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
        { name: "Alpha Prime", deck: { ...EMPTY, main: [89631139, 89631139, 55144522] }, mode: "standard" },
        { name: "Beta", deck: { ...EMPTY, main: [89631139, 89631139, 55144522] }, mode: "standard" },
      ],
    });
    expect(within(screen.getByRole("list", { name: "Created decks" })).getByText("Alpha Prime")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Alpha Prime" })).toHaveAttribute("href", "/decks/31");

    // The created row left the list. The failed row stays, checked, with its reason. The unsent row stays.
    const list = screen.getByRole("list", { name: "Decks to import" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).queryByLabelText("Deck name for Alpha")).toBeNull();
    expect(within(list).getByText("Not imported. You have too many decks.")).toBeInTheDocument();
    expect(within(list).getByLabelText("Import Beta")).toBeChecked();
    expect(within(list).getByLabelText("Import Gamma")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Import 1 deck" })).toBeEnabled();
    await waitFor(() => expect(listCount).toBeGreaterThan(listLoads));
  });

  it("retries a failed row and then shows the finished state", async () => {
    previewReply = () => Response.json({ maxDecks: 50, rows: [row("b1-paste#0", "Alpha"), row("b1-paste#1", "Beta")] });
    bulkReply = (body) => (body.rows.length === 2
      ? Response.json({
        created: [{ id: 5, name: "Alpha" }],
        failed: [{ index: 1, errors: [{ code: "busy", message: "Try again." }] }],
      })
      : Response.json({ created: [{ id: 6, name: "Beta again" }], failed: [] }));
    await openPaste(TWO_CODES);
    await screen.findByRole("list", { name: "Decks to import" });
    fireEvent.click(screen.getByRole("button", { name: "Import 2 decks" }));
    await screen.findByText("Not imported. Try again.");

    fireEvent.change(screen.getByLabelText("Deck name for Beta"), { target: { value: "Beta again" } });
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deck" }));
    expect(await screen.findByRole("link", { name: "Open Beta again" })).toHaveAttribute("href", "/decks/6");
    expect(screen.queryByRole("list", { name: "Decks to import" })).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    const retry = calls.filter((call) => call.url === "/api/decks/import/bulk")[1];
    expect((retry.body as { rows: Array<{ name: string }> }).rows.map((r) => r.name)).toEqual(["Beta again"]);
  });

  it("sends the chosen mode on preview and bulk, and shows it on each row", async () => {
    previewReply = () => Response.json({ maxDecks: 50, rows: [row("b1-paste#0", "Alpha", { mode: "domain" })] });
    bulkReply = () => Response.json({ created: [{ id: 3, name: "Alpha" }], failed: [] });
    render(<SavedDeckLibrary />);
    await screen.findByText(/No saved decks yet/);
    fireEvent.click(screen.getByRole("button", { name: "Import decks" }));
    fireEvent.click(screen.getByRole("button", { name: "Domain" }));
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    // The picker is on the Paste tab too, and keeps its value.
    expect(screen.getByRole("button", { name: "Domain" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("YDK text or YDKE codes"), { target: { value: "ydke://o6lXBQ==!!!" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview decks" }));

    const list = await screen.findByRole("list", { name: "Decks to import" });
    expect(calls[0].body).toMatchObject({ sources: [{ id: "b1-paste", mode: "domain" }] });
    expect(within(list).getByText("Domain")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deck" }));
    await screen.findByText("1 deck was created.");
    expect(calls[1].body).toMatchObject({ rows: [{ name: "Alpha", mode: "domain" }] });
  });

  it("adds a new paste to the rows on screen and keeps name edits and unchecked boxes", async () => {
    let round = 0;
    previewReply = () => {
      round += 1;
      return Response.json({
        maxDecks: 50,
        rows: round === 1
          ? [row("b1-paste#0", "Alpha"), row("b1-paste#1", "Beta")]
          : [row("b2-paste#0", "Gamma")],
      });
    };
    await openPaste(TWO_CODES);
    await screen.findByRole("list", { name: "Decks to import" });
    fireEvent.change(screen.getByLabelText("Deck name for Alpha"), { target: { value: "My Alpha" } });
    fireEvent.click(screen.getByLabelText("Import Beta"));

    expect(screen.getByLabelText("YDK text or YDKE codes")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("YDK text or YDKE codes"), { target: { value: "ydke://o6lXBQ==!!!" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview decks" }));

    await screen.findByLabelText("Deck name for Gamma");
    expect(screen.getByLabelText("Deck name for Alpha")).toHaveValue("My Alpha");
    expect(screen.getByLabelText("Import Beta")).not.toBeChecked();
    expect(screen.getByLabelText("Import Gamma")).toBeChecked();
    expect(screen.getByText(/3 decks found, 2 selected/)).toBeInTheDocument();
    // The second call used a new source id, so its row ids cannot collide with the first.
    expect(calls[1].body).toMatchObject({ sources: [{ id: "b2-paste" }] });
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
    expect(calls[0].body).toEqual({ sources: [{ id: "b1-f0", name: "Branded.ydk", text: "#main\n89631139\n", mode: "standard" }] });
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

  it("keeps the import result when a file is dropped during the import", async () => {
    previewReply = () => Response.json({ maxDecks: 50, rows: [row("b1-paste#0", "Alpha"), row("b1-paste#1", "Beta")] });
    let release = () => {};
    bulkReply = () => new Promise<Response>((resolve) => {
      release = () => resolve(Response.json({ created: [{ id: 1, name: "Alpha" }, { id: 2, name: "Beta" }], failed: [] }));
    });
    await openPaste(TWO_CODES);
    await screen.findByRole("list", { name: "Decks to import" });
    const loads = listCount;
    fireEvent.click(screen.getByRole("button", { name: "Import 2 decks" }));
    await screen.findByRole("button", { name: "Importing…" });

    fireEvent.drop(screen.getByText(/Private lists you can import/), {
      dataTransfer: { types: ["Files"], files: [new File(["#main\n89631139\n"], "Late.ydk")] },
    });
    expect(await screen.findByText(/Wait for the import to finish/)).toBeInTheDocument();

    release();
    await screen.findByText("2 decks were created.");
    await waitFor(() => expect(listCount).toBe(loads + 1));
    // The late file made no preview call, and the created rows are gone from the list.
    expect(calls.filter((call) => call.url.endsWith("preview"))).toHaveLength(1);
    expect(screen.queryByRole("list", { name: "Decks to import" })).toBeNull();
  });

  it("queues a second pick while the first preview loads, so neither is lost", async () => {
    let release = () => {};
    let round = 0;
    previewReply = () => {
      round += 1;
      if (round === 1) {
        return new Promise<Response>((resolve) => {
          release = () => resolve(Response.json({ maxDecks: 50, rows: [row("b1-paste#0", "First")] }));
        });
      }
      return Response.json({ maxDecks: 50, rows: [row("b2-f0#0", "Second")] });
    };
    await openPaste("ydke://o6lXBQ==!!!");
    await waitFor(() => expect(calls).toHaveLength(1));
    fireEvent.drop(screen.getByText(/Private lists you can import/), {
      dataTransfer: { types: ["Files"], files: [new File(["#main\n89631139\n"], "Second.ydk")] },
    });
    // The second pick waits for the first reply.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);

    release();
    await screen.findByLabelText("Deck name for Second");
    expect(screen.getByLabelText("Deck name for First")).toBeInTheDocument();
    expect(calls).toHaveLength(2);
    expect(screen.getByText(/2 decks found, 2 selected/)).toBeInTheDocument();
  });

  it("numbers the unnamed YDKE decks on from the rows already in the list", async () => {
    let round = 0;
    previewReply = () => {
      round += 1;
      const p = round === 1 ? "b1" : "b2";
      return Response.json({
        maxDecks: 50,
        rows: [row(`${p}-paste#0`, "Imported deck 1"), row(`${p}-paste#1`, "Imported deck 2")],
      });
    };
    await openPaste(TWO_CODES);
    await screen.findByRole("list", { name: "Decks to import" });
    fireEvent.change(screen.getByLabelText("YDK text or YDKE codes"), { target: { value: TWO_CODES } });
    fireEvent.click(screen.getByRole("button", { name: "Preview decks" }));

    await screen.findByLabelText("Deck name for Imported deck 4");
    const names = within(screen.getByRole("list", { name: "Decks to import" })).getAllByRole("textbox").map((box) => (box as HTMLInputElement).value);
    expect(names).toEqual(["Imported deck 1", "Imported deck 2", "Imported deck 3", "Imported deck 4"]);
  });

  it("shows the line number of an issue in the details", async () => {
    previewReply = () => Response.json({
      maxDecks: 50,
      rows: [row("b1-paste#0", "Odd", { warnings: [{ code: "bad_line", message: "This line is not a passcode.", line: 7 }] })],
    });
    await openPaste("#main\n89631139");
    await screen.findByRole("list", { name: "Decks to import" });
    fireEvent.click(screen.getByRole("button", { name: /1 warning/ }));
    expect(screen.getByText("Line 7")).toBeInTheDocument();
    expect(screen.getByText("This line is not a passcode.")).toBeInTheDocument();
  });

  it("counts decks, not files, against the limit, before any call", async () => {
    const lines = Array.from({ length: 51 }, () => "ydke://o6lXBQ==!!!").join("\n");
    await openPaste(lines);
    expect(await screen.findByText(/That text has 51 decks/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    // A file with 30 YDKE lines uses 30 of the 50, so a second one of 30 is left out with a note.
    previewReply = () => Response.json({ maxDecks: 50, rows: [row("b1-f0#0", "Thirty")] });
    const thirty = Array.from({ length: 30 }, () => "ydke://o6lXBQ==!!!").join("\n");
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.change(screen.getByLabelText("Deck files"), {
      target: { files: [new File([thirty], "A.txt"), new File([thirty], "B.txt")] },
    });
    await screen.findByRole("list", { name: "Decks to import" });
    expect((calls[0].body as { sources: Array<{ name: string }> }).sources.map((source) => source.name)).toEqual(["A.txt"]);
    expect(screen.getByText(/B\.txt was left out. One import can hold 50 decks/)).toBeInTheDocument();
  });

  it("reads failed decks out once in a status line and puts no alert on the rows", async () => {
    previewReply = () => Response.json({ maxDecks: 50, rows: [row("b1-paste#0", "Alpha"), row("b1-paste#1", "Beta")] });
    bulkReply = () => Response.json({
      created: [],
      failed: [
        { index: 0, errors: [{ code: "x", message: "No room." }] },
        { index: 1, errors: [{ code: "x", message: "No room." }] },
      ],
    });
    await openPaste(TWO_CODES);
    await screen.findByRole("list", { name: "Decks to import" });
    fireEvent.click(screen.getByRole("button", { name: "Import 2 decks" }));
    await screen.findAllByText("Not imported. No room.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("2 decks could not be created.");
  });

  it.each([
    ["the Retry-After header", () => new Response(JSON.stringify({ error: "Too many deck imports, try again shortly" }), { status: 429, headers: { "Retry-After": "7" } })],
    ["retryAfterSeconds in the body", () => Response.json({ error: "Too many deck imports", retryAfterSeconds: 7 }, { status: 429 })],
  ])("says how long to wait after a 429 from preview (%s), and keeps the rows and the turned-down pick", async (_label, limited) => {
    let round = 0;
    previewReply = () => {
      round += 1;
      return round === 2 ? limited() : Response.json({ maxDecks: 50, rows: [row(`b${round}-paste#0`, round === 1 ? "Kept" : "Again")] });
    };
    await openPaste("ydke://o6lXBQ==!!!");
    await screen.findByLabelText("Deck name for Kept");
    fireEvent.change(screen.getByLabelText("YDK text or YDKE codes"), { target: { value: "ydke://ykw8BA==!!!" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview decks" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many imports in a short time. Try again in 7 seconds.");
    expect(screen.getByLabelText("Deck name for Kept")).toBeInTheDocument();
    // The paste stays in the box, and the pick can be sent again.
    expect(screen.getByLabelText("YDK text or YDKE codes")).toHaveValue("ydke://ykw8BA==!!!");
    fireEvent.click(screen.getByRole("button", { name: "Send it again" }));
    await screen.findByLabelText("Deck name for Again");
    expect(screen.getByLabelText("Deck name for Kept")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says how long to wait after a 429 from the import call and keeps every row", async () => {
    previewReply = () => Response.json({ maxDecks: 50, rows: [row("b1-paste#0", "Alpha")] });
    bulkReply = () => new Response("{}", { status: 429, headers: { "Retry-After": "1" } });
    await openPaste(TWO_CODES);
    await screen.findByLabelText("Deck name for Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deck" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many imports in a short time. Try again in 1 second.");
    expect(screen.getByLabelText("Deck name for Alpha")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 1 deck" })).toBeEnabled();
  });

  it("says the card check is down on a 503, from preview and from the import call", async () => {
    previewReply = () => Response.json({ error: "Duel engine unavailable, try again" }, { status: 503 });
    await openPaste(TWO_CODES);
    expect(await screen.findByRole("alert")).toHaveTextContent("Card check is not available right now. Try again later.");

    previewReply = () => Response.json({ maxDecks: 50, rows: [row("b2-paste#0", "Alpha")] });
    bulkReply = () => Response.json({ error: "Duel engine unavailable, try again" }, { status: 503 });
    fireEvent.click(screen.getByRole("button", { name: "Preview decks" }));
    await screen.findByLabelText("Deck name for Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deck" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Card check is not available right now. Try again later."));
    expect(screen.getByLabelText("Deck name for Alpha")).toBeInTheDocument();
  });

  it("shows more_issues as the last details line, not as an error", async () => {
    previewReply = () => Response.json({
      maxDecks: 50,
      rows: [row("b1-paste#0", "Long", {
        errors: [
          { code: "unknown_card", message: "Unknown card 1", passcode: 1 },
          { code: "more_issues", message: "and 5 more issues", count: 5 },
        ],
      })],
    });
    await openPaste(TWO_CODES);
    await screen.findByRole("list", { name: "Decks to import" });
    expect(screen.getByRole("button", { name: /^1 error/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Long cannot be imported")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /1 error/ }));
    const lines = within(screen.getByRole("list", { name: "Decks to import" })).getAllByRole("listitem").slice(1);
    expect(lines.map((line) => line.textContent)).toEqual(["unknown_cardUnknown card 1", "and 5 more"]);
  });

  it("re-checks one row that hit the lookup limit by sending only its source", async () => {
    let round = 0;
    previewReply = () => {
      round += 1;
      return round === 1
        ? Response.json({
          maxDecks: 50,
          rows: [row("b1-paste#0", "Limited", { errors: [{ code: "lookup_limited", message: "lookup limit reached, try again", passcode: 5 }] })],
        })
        : Response.json({ maxDecks: 50, rows: [row("b1-paste#0", "Imported deck 1")] });
    };
    await openPaste("ydke://o6lXBQ==!!!");
    await screen.findByText(/hit its limit for this deck/);
    fireEvent.change(screen.getByLabelText("Deck name for Limited"), { target: { value: "My name" } });
    fireEvent.click(screen.getByRole("button", { name: "Re-check" }));

    await waitFor(() => expect(screen.queryByText(/hit its limit for this deck/)).toBeNull());
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toMatchObject({ sources: [{ id: "b1-paste", text: "ydke://o6lXBQ==!!!" }] });
    // The name the person typed stays, and the row can be imported now.
    expect(screen.getByLabelText("Deck name for Limited")).toHaveValue("My name");
    expect(screen.getByLabelText("Import My name")).toBeChecked();
  });

  describe("card icons and previews", () => {
    const MASTER = 14558127;
    const domainRow = (id: string, name: string, extra: Partial<ImportPreviewRow> = {}) => row(id, name, {
      deck: { main: [89631139, 89631139, 89631139, 55144522], extra: [MASTER], side: [55144522], deckMaster: MASTER },
      counts: { main: 4, extra: 1, side: 1 },
      mode: "domain",
      ...extra,
    });

    it("shows the Deck Master art as the row icon and the first Main card when there is none", async () => {
      previewReply = () => Response.json({ maxDecks: 50, rows: [domainRow("b1-paste#0", "Imported deck 1"), row("b1-paste#1", "Imported deck 2")] });
      await openPaste(TWO_CODES);
      await screen.findByRole("list", { name: "Decks to import" });

      const [first, second] = screen.getAllByRole("listitem");
      const masterIcon = first.querySelector("[data-icon]")!;
      expect(masterIcon).toHaveAttribute("data-icon", "master");
      const masterImg = masterIcon.querySelector("img")!;
      expect(masterImg).toHaveAttribute("src", `/api/cards/${MASTER}/image?size=small`);
      expect(masterImg).toHaveAttribute("loading", "lazy");
      const plainIcon = second.querySelector("[data-icon]")!;
      expect(plainIcon).toHaveAttribute("data-icon", "first");
      expect(plainIcon.querySelector("img")).toHaveAttribute("src", "/api/cards/89631139/image?size=small");
    });

    it("looks every card up in one batched request and shows the Master's name only when there is one", async () => {
      cardNames = new Map([[MASTER, "Dark Magician"], [89631139, "Blue-Eyes White Dragon"], [55144522, "Pot of Greed"]]);
      previewReply = () => Response.json({ maxDecks: 50, rows: [domainRow("b1-paste#0", "Imported deck 1"), row("b1-paste#1", "Imported deck 2")] });
      await openPaste(TWO_CODES);
      const list = await screen.findByRole("list", { name: "Decks to import" });

      const [first, second] = within(list).getAllByRole("listitem");
      await waitFor(() => expect(within(first).getByText("Dark Magician", { selector: "b" })).toBeInTheDocument());
      expect(within(first).getByText("Master")).toBeInTheDocument();
      // A deck with no Master has no Master label at all.
      expect(within(second).queryByText("Master")).toBeNull();
      expect(cardCalls).toHaveLength(1);
      expect([...cardCalls[0]].sort()).toEqual([MASTER, 55144522, 89631139].sort());
    });

    it("names an unnamed YDKE deck after its Deck Master, but never a typed name or a file name", async () => {
      cardNames = new Map([[MASTER, "Dark Magician"], [89631139, "Blue-Eyes White Dragon"]]);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      cardsReply = async (codes) => {
        await gate;
        return Response.json({ cards: codes.filter((code) => cardNames.has(code)).map((code) => cardInfo(code, cardNames.get(code)!)), missing: [] });
      };
      previewReply = () => Response.json({
        maxDecks: 50,
        rows: [
          domainRow("b1-paste#0", "Imported deck 1"),
          domainRow("b1-paste#1", "Imported deck 2"),
          domainRow("b1-f0#0", "Kept.ydk", { sourceId: "b1-f0" }),
          row("b1-paste#2", "Imported deck 3"),
        ],
      });
      await openPaste(TWO_CODES);
      await screen.findByLabelText("Deck name for Imported deck 1");
      fireEvent.change(screen.getByLabelText("Deck name for Imported deck 2"), { target: { value: "My own name" } });
      release();

      await waitFor(() => expect(screen.getByLabelText("Deck name for Imported deck 1")).toHaveValue("Dark Magician"));
      expect(screen.getByLabelText("Deck name for Imported deck 2")).toHaveValue("My own name");
      expect(screen.getByLabelText("Deck name for Kept.ydk")).toHaveValue("Kept.ydk");
      expect(screen.getByLabelText("Deck name for Imported deck 3")).toHaveValue("Imported deck 3");

      bulkReply = () => Response.json({ created: [], failed: [] });
      fireEvent.click(screen.getByRole("button", { name: "Import 4 decks" }));
      await waitFor(() => expect(calls.some((call) => call.url.endsWith("bulk"))).toBe(true));
      expect((calls.at(-1)!.body as { rows: Array<{ name: string }> }).rows.map((r) => r.name))
        .toEqual(["Dark Magician", "My own name", "Kept.ydk", "Imported deck 3"]);
    });

    it("keeps Imported deck N when the card lookup is down", async () => {
      previewReply = () => Response.json({ maxDecks: 50, rows: [domainRow("b1-paste#0", "Imported deck 1")] });
      await openPaste("ydke://o6lXBQ==!!!");
      await screen.findByLabelText("Deck name for Imported deck 1");
      await waitFor(() => expect(cardCalls).toHaveLength(1));
      expect(screen.getByLabelText("Deck name for Imported deck 1")).toHaveValue("Imported deck 1");
      expect(screen.getByText(`Card ${MASTER}`, { selector: "b" })).toBeInTheDocument();
    });

    it("shows the first warning inline and the rest in the list", async () => {
      previewReply = () => Response.json({
        maxDecks: 50,
        rows: [row("b1-paste#0", "Warned", {
          warnings: [
            { code: "main_size", message: "Main has 60 cards" },
            { code: "remapped", message: "2 cards use new codes" },
          ],
        })],
      });
      await openPaste("ydke://o6lXBQ==!!!");
      await screen.findByLabelText("Deck name for Warned");

      expect(screen.getByText("Main has 60 cards")).toBeInTheDocument();
      expect(screen.queryByText("2 cards use new codes")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /2 warnings/ }));
      expect(screen.getAllByText("Main has 60 cards")).toHaveLength(1);
      expect(screen.getByText("2 cards use new codes")).toBeInTheDocument();
    });

    it("keeps the card strip collapsed, and the open strip groups the deck by section with copy counts", async () => {
      cardNames = new Map([[89631139, "Blue-Eyes White Dragon"], [55144522, "Pot of Greed"], [MASTER, "Dark Magician"]]);
      previewReply = () => Response.json({ maxDecks: 50, rows: [domainRow("b1-paste#0", "Imported deck 1")] });
      await openPaste("ydke://o6lXBQ==!!!");
      await screen.findByLabelText("Deck name for Imported deck 1");

      const strip = screen.getByRole("group", { name: /Cards in/ });
      expect(within(strip).getAllByRole("button").length).toBeGreaterThan(0);
      expect(strip.querySelectorAll("img")[0]).toHaveAttribute("loading", "lazy");
      expect(screen.queryByRole("region", { name: /Main, 4 cards/ })).toBeNull();

      const toggle = screen.getByRole("button", { name: "Show all cards" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(toggle);
      expect(screen.getByRole("button", { name: "Hide cards" })).toHaveAttribute("aria-expanded", "true");

      const main = screen.getByRole("region", { name: "Main, 4 cards" });
      await waitFor(() => expect(within(main).getByRole("button", { name: "Blue-Eyes White Dragon, 3 copies" })).toBeInTheDocument());
      expect(within(main).getByText("×3")).toBeInTheDocument();
      expect(within(main).getAllByRole("button")).toHaveLength(2);
      expect(screen.getByRole("region", { name: "Extra, 1 cards" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Side, 1 cards" })).toBeInTheDocument();
    });

    it("shows the large card with its name and text on hover, and in a sheet on click", async () => {
      cardNames = new Map([[89631139, "Blue-Eyes White Dragon"], [55144522, "Pot of Greed"]]);
      previewReply = () => Response.json({ maxDecks: 50, rows: [row("b1-paste#0", "Plain")] });
      await openPaste("ydke://o6lXBQ==!!!");
      await screen.findByLabelText("Deck name for Plain");
      const strip = screen.getByRole("group", { name: /Cards in/ });
      const thumb = await within(strip).findByRole("button", { name: "Blue-Eyes White Dragon" });

      fireEvent.pointerEnter(thumb, { pointerType: "mouse" });
      const popover = await screen.findByTestId("card-popover");
      expect(within(popover).getByText("Blue-Eyes White Dragon")).toBeInTheDocument();
      expect(within(popover).getByText("Blue-Eyes White Dragon effect text.")).toBeInTheDocument();
      fireEvent.pointerLeave(thumb);
      expect(screen.queryByTestId("card-popover")).toBeNull();

      fireEvent.click(thumb);
      const sheet = await screen.findByRole("dialog", { name: "Blue-Eyes White Dragon" });
      expect(within(sheet).getByText("Blue-Eyes White Dragon effect text.")).toBeInTheDocument();
    });

    it("does not open the hover card for a touch", async () => {
      cardNames = new Map([[89631139, "Blue-Eyes White Dragon"]]);
      previewReply = () => Response.json({ maxDecks: 50, rows: [row("b1-paste#0", "Plain")] });
      await openPaste("ydke://o6lXBQ==!!!");
      const thumb = await within(await screen.findByRole("group", { name: /Cards in/ })).findByRole("button", { name: "Blue-Eyes White Dragon" });
      fireEvent.pointerEnter(thumb, { pointerType: "touch" });
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(screen.queryByTestId("card-popover")).toBeNull();
    });
  });

  it("keeps a turned-down pick on screen with its buttons when a new pick arrives, until it is sent or removed", async () => {
    let round = 0;
    previewReply = () => {
      round += 1;
      if (round === 1) return new Response("{}", { status: 429, headers: { "Retry-After": "5" } });
      return Response.json({ maxDecks: 50, rows: [row(`b${round}-f0#0`, `Pick ${round}`)] });
    };
    await openPaste("ydke://o6lXBQ==!!!");
    expect(await screen.findByText(/1 pick was not sent\./)).toBeInTheDocument();

    // A new pick clears the error, but not the held pick or its buttons.
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.change(screen.getByLabelText("Deck files"), { target: { files: [new File(["#main\n89631139\n"], "New.ydk")] } });
    await screen.findByLabelText("Deck name for Pick 2");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/1 pick was not sent\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send it again" }));
    await screen.findByLabelText("Deck name for Pick 3");
    expect(screen.getByLabelText("Deck name for Pick 2")).toBeInTheDocument();
    expect(screen.queryByText(/1 pick was not sent\./)).toBeNull();
    expect((calls[2].body as { sources: Array<{ text: string }> }).sources[0].text).toBe("ydke://o6lXBQ==!!!");
  });

  it("lets the person remove a turned-down pick", async () => {
    previewReply = () => new Response("{}", { status: 503 });
    await openPaste("ydke://o6lXBQ==!!!");
    await screen.findByText(/1 pick was not sent\./);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText(/1 pick was not sent\./)).toBeNull();
  });

  it("re-checks a row from a split paste with only that row's own line", async () => {
    const three = "ydke://o6lXBQ==!!!\n\nydke://ykw8BA==!!!\nydke://AAAAAA==!!!";
    let round = 0;
    previewReply = () => {
      round += 1;
      return round === 1
        ? Response.json({
          maxDecks: 50,
          rows: [
            row("b1-paste#0", "Imported deck 1"),
            row("b1-paste#1", "Imported deck 2", { errors: [{ code: "lookup_limited", message: "lookup limit reached, try again", passcode: 5, line: 3 }] }),
            row("b1-paste#2", "Imported deck 3"),
          ],
        })
        : Response.json({ maxDecks: 50, rows: [row("b1-paste#0", "Imported deck 1", { warnings: [{ code: "remapped", message: "Remapped.", line: 1 }] })] });
    };
    await openPaste(three);
    await screen.findByText(/hit its limit for this deck/);
    fireEvent.click(screen.getByRole("button", { name: "Re-check" }));

    await waitFor(() => expect(screen.queryByText(/hit its limit for this deck/)).toBeNull());
    expect(calls).toHaveLength(2);
    expect((calls[1].body as { sources: Array<{ id: string; text: string }> }).sources).toMatchObject([{ id: "b1-paste", text: "ydke://ykw8BA==!!!" }]);
    // The other rows are as they were, and the checked row keeps its own id and its first line number.
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: /1 warning/ }));
    expect(screen.getByText("Line 3")).toBeInTheDocument();
  });

  it("never sends two preview or import calls at the same time", async () => {
    let inFlight = 0;
    let most = 0;
    const real = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
      if (String(url).includes("/api/decks/import/")) {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
      }
      return real(url, init);
    });
    let round = 0;
    previewReply = () => {
      round += 1;
      return Response.json({ maxDecks: 50, rows: [row(`b${round}-f0#0`, `Row ${round}`)] });
    };
    render(<SavedDeckLibrary />);
    await screen.findByText(/No saved decks yet/);
    fireEvent.click(screen.getByRole("button", { name: "Import decks" }));
    const drop = (name: string) => fireEvent.drop(screen.getByText(/Private lists you can import/), {
      dataTransfer: { types: ["Files"], files: [new File(["#main\n89631139\n"], name)] },
    });
    drop("One.ydk");
    drop("Two.ydk");
    drop("Three.ydk");
    await screen.findByLabelText("Deck name for Row 3");
    expect(screen.getByLabelText("Deck name for Row 1")).toBeInTheDocument();

    bulkReply = () => Response.json({ created: [1, 2, 3].map((id) => ({ id, name: `Row ${id}` })), failed: [] });
    fireEvent.click(screen.getByRole("button", { name: "Import 3 decks" }));
    drop("Late.ydk");
    await screen.findByText("3 decks were created.");
    expect(most).toBe(1);
  });

  it("says so when the server finds no decks", async () => {
    await openPaste(TWO_CODES);
    expect(await screen.findByText("No decks were found in this import.")).toBeInTheDocument();
  });
});
