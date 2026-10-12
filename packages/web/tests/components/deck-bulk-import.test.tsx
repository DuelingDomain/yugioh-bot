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
    fireEvent.click(screen.getByRole("button", { name: "Send the last pick again" }));
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

  it("says so when the server finds no decks", async () => {
    await openPaste(TWO_CODES);
    expect(await screen.findByText("No decks were found in this import.")).toBeInTheDocument();
  });
});
