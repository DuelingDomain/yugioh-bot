// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateDraftForm } from "../../src/components/draft/create-draft-form";
import { installVirtualizerJsdomEnv } from "../helpers/virtualizer-jsdom";
import { stubFetch } from "../helpers/pool-fixtures";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => installVirtualizerJsdomEnv());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

type Stub = ReturnType<typeof stubFetch>;

const sourceTab = (name: string) => screen.getByRole("tab", { name });
const tile = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name},`) });
const queryTile = (name: string) => screen.queryByRole("button", { name: new RegExp(`^${name},`) });
const showLane = (lane: "Main" | "Extra") => fireEvent.click(within(screen.getByRole("group", { name: "Pool lane" })).getByRole("button", { name: new RegExp(lane) }));
const box = () => screen.getByLabelText("Card list") as HTMLTextAreaElement;
const paste = (text: string) => fireEvent.paste(box(), { clipboardData: { getData: () => text } });
const resolveBodies = (stub: Stub) => stub.find("/api/cards/resolve", "POST").map((c) => c.body as { listText?: string });
const listImports = (stub: Stub) => resolveBodies(stub).filter((b) => b.listText !== undefined);
const createButton = () => screen.getByRole("button", { name: /create draft/i });
const posted = (stub: Stub) => stub.find("/api/drafts", "POST")[0]?.body as { name: string; channelId?: string; config: Record<string, unknown> };

async function openList() {
  const stub = stubFetch();
  render(<CreateDraftForm />);
  fireEvent.click(sourceTab("List"));
  await screen.findByLabelText("Card list");
  return stub;
}

async function pickGoat() {
  fireEvent.click(sourceTab("Cubes"));
  fireEvent.click(await screen.findByRole("button", { name: /Goat cube/ }));
  await screen.findByRole("region", { name: "Chosen cube" });
  await screen.findByRole("button", { name: /^Alpha Beast,/ });
}

/** Rules a 2-seat table with 2 rounds of 20 can fill from 80 cards. */
function setSmallTable() {
  fireEvent.change(screen.getByLabelText("Players"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Picks each"), { target: { value: "40" } });
  fireEvent.change(screen.getByLabelText("Cards per pile"), { target: { value: "20" } });
}

function deferred() {
  let release!: (res: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("CreateDraftForm: the Workbench", () => {
  it("shows the sources, the pool and the rules, with one Create button", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    expect(screen.getByRole("complementary", { name: "Sources and card preview" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Draft pool" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Draft rules and Create" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /create draft/i })).toHaveLength(1);
    expect(screen.getByText("Draft rules", { selector: "h2" })).toBeInTheDocument();
  });

  it("starts empty with a prompt, and its buttons open the List and Cubes sources", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    expect(screen.getByRole("heading", { name: "Start with a card list" })).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
    expect(screen.getByText("Add cards to the pool")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add a card list" }));
    expect(sourceTab("List")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Use a saved cube" }));
    expect(sourceTab("Cubes")).toHaveAttribute("aria-selected", "true");
  });

  it("starts from the community rules: 4 seats, 5 rounds of 24, 2 picks, 45 seconds", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    expect(screen.getByLabelText("Players")).toHaveValue("4");
    expect(screen.getByLabelText("Rounds")).toHaveValue("5");
    expect(screen.getByLabelText("Cards per pile")).toHaveValue("24");
    expect(screen.getByLabelText("Seconds per pick")).toHaveValue("45");
    expect(screen.getByRole("button", { name: "2-pick" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens a cube from the Cubes source into the pool", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    await pickGoat();
    expect(tile("Alpha Beast")).toHaveAttribute("aria-label", "Alpha Beast, 3 copies");
    expect(screen.queryByRole("heading", { name: "Start with a card list" })).toBeNull();
    // The cube's 6 Extra cards, 3 copies each.
    expect(within(screen.getByRole("group", { name: "Pool lane" })).getByRole("button", { name: /Extra/ })).toHaveTextContent("18");
  });

  it("edits the visible pool: one fewer, one more, and Remove at one copy", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    await pickGoat();
    fireEvent.click(screen.getByRole("button", { name: "One fewer Alpha Beast" }));
    expect(tile("Alpha Beast")).toHaveAttribute("aria-label", "Alpha Beast, 2 copies");
    fireEvent.click(screen.getByRole("button", { name: "One more Alpha Beast" }));
    expect(tile("Alpha Beast")).toHaveAttribute("aria-label", "Alpha Beast, 3 copies");
    fireEvent.click(screen.getByRole("button", { name: "Remove Pot of Greed from the pool" }));
    expect(queryTile("Pot of Greed")).toBeNull();
  });

  it("adds a card from the Cards source search into the pool", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    fireEvent.change(await screen.findByLabelText("Search cards by name"), { target: { value: "cipher" } });
    fireEvent.click(await screen.findByRole("option", { name: /^Cipher Soldier/ }));
    expect(await screen.findByRole("button", { name: /^Cipher Soldier,/ })).toBeInTheDocument();
  });

  it("shows no channel picker, skips the channel request and sends no channel when the bot is off", async () => {
    const stub = stubFetch({ extra: { "GET /api/discord/channels": () => Response.json({ channels: [{ id: "c1", name: "drafts" }] }) } });
    render(<CreateDraftForm discordEnabled={false} />);
    fireEvent.click(screen.getByText("Name"));
    expect(screen.getByLabelText("Draft name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Discord channel")).not.toBeInTheDocument();
    expect(screen.queryByText(/discord/i)).not.toBeInTheDocument();
    expect(stub.find("/api/discord/channels")).toHaveLength(0);
  });

  it("names the draft from the date until a name is typed, and lists the channels with a default", async () => {
    const stub = stubFetch({ extra: { "GET /api/discord/channels": () => Response.json({ channels: [{ id: "c1", name: "drafts" }] }) } });
    render(<CreateDraftForm discordEnabled />);
    fireEvent.click(screen.getByText("Name & channel"));
    const name = screen.getByLabelText("Draft name");
    await waitFor(() => expect(name).toHaveAttribute("placeholder", expect.stringMatching(/^Cube draft · /)));
    const options = await screen.findAllByRole("option", { name: /^#/ });
    expect(options.map((o) => o.textContent)).toEqual(["#default", "#drafts"]);
    expect(screen.getByLabelText("Discord channel")).toHaveValue("");
    expect(stub.find("/api/discord/channels")).toHaveLength(1);
  });
});

describe("CreateDraftForm: card list imports", () => {
  const entry = (text: string) => screen.findByText(text);

  it("adds pasted passcodes and names at once and routes Extra Deck cards to the Extra pool", async () => {
    const stub = await openList();
    expect(screen.queryByRole("button", { name: /^Add list/ })).toBeNull();
    paste("105\n105\n900\n424242");

    expect(await entry("Pasted list - 3 cards (2 Main, 1 Extra) - 1 line skipped")).toBeInTheDocument();
    expect(listImports(stub)).toHaveLength(1);
    expect(tile("Cipher Soldier")).toHaveAttribute("aria-label", "Cipher Soldier, 2 copies");
    expect(box()).toHaveValue("");
    showLane("Extra");
    expect(tile("Fusion Wyrm")).toHaveAttribute("aria-label", "Fusion Wyrm, 1 copy");
  });

  it("shows each import once above the pool, with one Remove button", async () => {
    await openList();
    paste("3 Dragon Egg");
    await entry("Pasted list - 3 cards (3 Main, 0 Extra)");
    expect(screen.getAllByText("Pasted list - 3 cards (3 Main, 0 Extra)")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Remove Pasted list" })).toHaveLength(1);
  });

  it("adds a list of names with counts and keeps corrected and skipped details closed", async () => {
    const stub = await openList();
    const text = "Engines\n3 Dragon Egg\n2 Cipher Soldeir\n1 Fusion Wyrm\nGlue";
    paste(text);

    expect(await entry("Pasted list - 6 cards (5 Main, 1 Extra) - 1 name corrected - 2 lines skipped")).toBeInTheDocument();
    expect(resolveBodies(stub).some((b) => b.listText === text)).toBe(true);
    expect(tile("Dragon Egg")).toHaveAttribute("aria-label", "Dragon Egg, 3 copies");
    expect(tile("Cipher Soldier")).toHaveAttribute("aria-label", "Cipher Soldier, 2 copies");

    const report = screen.getByTestId("list-import-report");
    expect(report.querySelector("details")).not.toHaveAttribute("open");
    expect(within(report).getByRole("list", { name: "Corrected names", hidden: true })).toHaveTextContent("Cipher Soldeir");
    expect(within(report).getByRole("list", { name: "Skipped lines", hidden: true })).toHaveTextContent("Glue");
    expect(box()).toHaveValue("");
  });

  it("never imports typed text by itself: a pause after a partial name sends no request", async () => {
    const stub = await openList();
    fireEvent.change(box(), { target: { value: "Dragon Egg" } });
    await new Promise((r) => setTimeout(r, 1200));
    expect(listImports(stub)).toHaveLength(0);
    expect(box()).toHaveValue("Dragon Egg");
    expect(screen.queryByText(/^Pasted list/)).toBeNull();
  });

  it("imports typed text with the Add button, which is off while the box is empty", async () => {
    const stub = await openList();
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    fireEvent.change(box(), { target: { value: "3 Dragon Egg" } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    expect(await entry("Pasted list - 3 cards (3 Main, 0 Extra)")).toBeInTheDocument();
    expect(listImports(stub)).toHaveLength(1);
    expect(box()).toHaveValue("");
  });

  it("imports typed text on Ctrl+Enter, and Shift+Enter does not import", async () => {
    const stub = await openList();
    fireEvent.change(box(), { target: { value: "2 Dragon Egg" } });
    expect(fireEvent.keyDown(box(), { key: "Enter", shiftKey: true })).toBe(true);
    expect(listImports(stub)).toHaveLength(0);
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    expect(await entry("Pasted list - 2 cards (2 Main, 0 Extra)")).toBeInTheDocument();
    expect(box()).toHaveValue("");
    // The Create shortcut is the same key: the box took it, so no draft was created.
    expect(createButton()).toBeDisabled();
  });

  it("adds a second paste that comes while the first import runs, after the first", async () => {
    const stub = await openList();
    const inner = globalThis.fetch;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const isList = String(input) === "/api/cards/resolve" && String(init?.body ?? "").includes("listText");
      if (isList && held++ === 0) return gate.then(() => inner(input, init));
      return inner(input, init);
    });
    paste("3 Dragon Egg");
    expect(await screen.findByText("Adding the list.")).toBeInTheDocument();
    paste("2 Cipher Soldier");
    expect(await screen.findByText("1 more list is waiting.")).toBeInTheDocument();
    release();
    expect(await entry("Pasted list 2 - 2 cards (2 Main, 0 Extra)")).toBeInTheDocument();
    expect(screen.getByText("Pasted list - 3 cards (3 Main, 0 Extra)")).toBeInTheDocument();
    expect(listImports(stub).map((b) => b.listText)).toEqual(["3 Dragon Egg", "2 Cipher Soldier"]);
    expect(tile("Dragon Egg")).toHaveAttribute("aria-label", "Dragon Egg, 3 copies");
    expect(tile("Cipher Soldier")).toHaveAttribute("aria-label", "Cipher Soldier, 2 copies");
  });

  it("says some cards were not looked up, and that cards listed under Extra went to Main", async () => {
    await openList();
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await inner(input, init);
      if (String(input) !== "/api/cards/resolve" || !String(init?.body ?? "").includes("listText")) return res;
      return Response.json({ ...(await res.json()), lookupLimited: true, movedToMain: 2 });
    });
    paste("3 Dragon Egg\nGlue");

    expect(await entry("Pasted list - 3 cards (3 Main, 0 Extra) - 1 line skipped")).toBeInTheDocument();
    const report = screen.getByTestId("list-import-report");
    expect(within(report).getByText("Some cards were not looked up this time. Add the list again to look up the rest.")).toBeInTheDocument();
    expect(within(report).getByText("2 cards listed under Extra are not Extra Deck monsters - added to Main")).toBeInTheDocument();
  });

  it("says the lookup was limited, not that the cards are unknown, when nothing was found", async () => {
    await openList();
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/cards/resolve" || !String(init?.body ?? "").includes("listText")) return inner(input, init);
      return Response.json({ cards: [], entries: [], unknown: [], corrected: [], lookupLimited: true });
    });
    paste("Some Card\nOther Card");

    expect(await screen.findByText("No cards found in that list.")).toBeInTheDocument();
    expect(screen.getByText("Some cards were not looked up this time. Add the list again to look up the rest.")).toBeInTheDocument();
    expect(screen.queryByText(/lines? that (is|are) not a card name/)).toBeNull();
    expect(box()).toHaveValue("Some Card\nOther Card");
  });

  it("keeps typed text when a dropped list goes in, and when it fails", async () => {
    await openList();
    const drop = (text: string) => fireEvent.drop(box(), { dataTransfer: { getData: () => text } });
    fireEvent.change(box(), { target: { value: "Dragon Egg" } });
    drop("2 Cipher Soldier");
    expect(await entry("Pasted list - 2 cards (2 Main, 0 Extra)")).toBeInTheDocument();
    expect(box()).toHaveValue("Dragon Egg");

    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === "/api/cards/resolve" && String(init?.body ?? "").includes("listText")
        ? Response.json({ error: "List is too long." }, { status: 400 })
        : inner(input, init),
    );
    drop("5 Dark Hole");
    expect(await screen.findByText("List is too long.")).toBeInTheDocument();
    expect(box()).toHaveValue("Dragon Egg");
  });

  it("puts a queued list back into the box when it fails", async () => {
    await openList();
    const inner = globalThis.fetch;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const isList = String(input) === "/api/cards/resolve" && String(init?.body ?? "").includes("listText");
      if (!isList) return inner(input, init);
      return held++ === 0 ? gate.then(() => inner(input, init)) : Promise.resolve(Response.json({ error: "List is too long." }, { status: 400 }));
    });
    paste("3 Dragon Egg");
    expect(await screen.findByText("Adding the list.")).toBeInTheDocument();
    paste("2 Cipher Soldier");
    expect(await screen.findByText("1 more list is waiting.")).toBeInTheDocument();
    release();
    expect(await screen.findByText("List is too long.")).toBeInTheDocument();
    expect(screen.getByText("Pasted list - 3 cards (3 Main, 0 Extra)")).toBeInTheDocument();
    expect(box()).toHaveValue("2 Cipher Soldier");
  });

  it("does not import twice when a paste follows typed text", async () => {
    const stub = await openList();
    fireEvent.change(box(), { target: { value: "3 Dragon Egg" } });
    box().setSelectionRange(0, 12);
    paste("3 Dragon Egg");
    await entry("Pasted list - 3 cards (3 Main, 0 Extra)");
    await new Promise((r) => setTimeout(r, 900));
    expect(listImports(stub)).toHaveLength(1);
  });

  it("imports a loaded file at once and names the entry after the file", async () => {
    const stub = await openList();
    const file = new File(["3 Dragon Egg\nGlue\n"], "Flip.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Upload card list file"), { target: { files: [file] } });

    expect(await entry("Flip.txt - 3 cards (3 Main, 0 Extra) - 1 line skipped")).toBeInTheDocument();
    expect(listImports(stub)).toHaveLength(1);
    expect(tile("Dragon Egg")).toHaveAttribute("aria-label", "Dragon Egg, 3 copies");
  });

  it("stacks entries, and Remove takes out only the copies that import added", async () => {
    render(<CreateDraftForm />);
    stubFetch();
    cleanup();
    stubFetch();
    render(<CreateDraftForm />);
    await pickGoat();
    fireEvent.click(sourceTab("List"));
    paste("2 Alpha Beast\n1 Fusion Wyrm");
    await entry("Pasted list - 3 cards (2 Main, 1 Extra)");
    paste("3 Dragon Egg");
    await entry("Pasted list 2 - 3 cards (3 Main, 0 Extra)");
    expect(tile("Alpha Beast")).toHaveAttribute("aria-label", "Alpha Beast, 5 copies");

    fireEvent.click(screen.getByRole("button", { name: "Remove Pasted list" }));
    await waitFor(() => expect(screen.queryByText(/^Pasted list - 3 cards/)).toBeNull());
    // The cube's own 3 copies stay: Alpha Beast in Main, Fusion Wyrm in Extra.
    expect(tile("Alpha Beast")).toHaveAttribute("aria-label", "Alpha Beast, 3 copies");
    showLane("Extra");
    expect(tile("Fusion Wyrm")).toHaveAttribute("aria-label", "Fusion Wyrm, 3 copies");
    showLane("Main");
    expect(tile("Dragon Egg")).toHaveAttribute("aria-label", "Dragon Egg, 3 copies");
    expect(screen.getByText("Pasted list 2 - 3 cards (3 Main, 0 Extra)")).toBeInTheDocument();
  });

  it("does not take back copies the owner lowered: import to 5, lowered to 3, Remove leaves 3", async () => {
    await openList();
    paste("3 Dragon Egg");
    await entry("Pasted list - 3 cards (3 Main, 0 Extra)");
    paste("2 Dragon Egg");
    await entry("Pasted list 2 - 2 cards (2 Main, 0 Extra)");
    expect(tile("Dragon Egg")).toHaveAttribute("aria-label", "Dragon Egg, 5 copies");

    for (let i = 0; i < 2; i += 1) fireEvent.click(screen.getByRole("button", { name: "One fewer Dragon Egg" }));
    expect(tile("Dragon Egg")).toHaveAttribute("aria-label", "Dragon Egg, 3 copies");
    fireEvent.click(screen.getByRole("button", { name: "Remove Pasted list 2" }));
    await waitFor(() => expect(screen.queryByText(/^Pasted list 2 - /)).toBeNull());
    expect(tile("Dragon Egg")).toHaveAttribute("aria-label", "Dragon Egg, 3 copies");
  });

  it("removes two stacked imports in any order, and never goes below zero", async () => {
    await openList();
    paste("3 Dragon Egg");
    await entry("Pasted list - 3 cards (3 Main, 0 Extra)");
    paste("2 Dragon Egg");
    await entry("Pasted list 2 - 2 cards (2 Main, 0 Extra)");

    // The oldest first: only its 3 copies leave, the newest import's 2 stay.
    fireEvent.click(screen.getByRole("button", { name: "Remove Pasted list" }));
    await waitFor(() => expect(screen.queryByText(/^Pasted list - /)).toBeNull());
    expect(tile("Dragon Egg")).toHaveAttribute("aria-label", "Dragon Egg, 2 copies");
    // The owner lowers the rest by one: the newest import has one copy left to take.
    fireEvent.click(screen.getByRole("button", { name: "One fewer Dragon Egg" }));
    expect(tile("Dragon Egg")).toHaveAttribute("aria-label", "Dragon Egg, 1 copy");
    fireEvent.click(screen.getByRole("button", { name: "Remove Pasted list 2" }));
    await waitFor(() => expect(screen.queryByText(/^Pasted list 2 - /)).toBeNull());
    expect(queryTile("Dragon Egg")).toBeNull();
    expect(screen.getByRole("heading", { name: "Start with a card list" })).toBeInTheDocument();
  });

  it("says so when nothing in the list is a card, and keeps the text", async () => {
    await openList();
    paste("Engines\nGlue");
    expect(await screen.findByText("No cards found in that list.")).toBeInTheDocument();
    expect(screen.getByText("Skipped 2 lines that are not card names")).toBeInTheDocument();
    expect(box()).toHaveValue("Engines\nGlue");
  });

  it("shows the server's message and a Try again button when the list is refused with 503", async () => {
    stubFetch({
      extra: {
        "POST /api/cards/resolve": () =>
          new Response(JSON.stringify({ error: "Card database is unavailable. Try again shortly." }), { status: 503, headers: { "Retry-After": "1" } }),
      },
    });
    render(<CreateDraftForm />);
    fireEvent.click(sourceTab("List"));
    paste("3 Dark Hole");
    expect(await screen.findByText(/Card database is unavailable. Try again shortly. Wait 1 second, then try again./)).toBeInTheDocument();
    expect(box()).toHaveValue("3 Dark Hole");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows the 400 message", async () => {
    stubFetch({ extra: { "POST /api/cards/resolve": () => Response.json({ error: "List is too long." }, { status: 400 }) } });
    render(<CreateDraftForm />);
    fireEvent.click(sourceTab("List"));
    paste("3 Dark Hole");
    expect(await screen.findByText("List is too long.")).toBeInTheDocument();
  });
});

describe("CreateDraftForm: Create", () => {
  it("sends the real config: target seats, explicit rounds, and the custom Main and Extra pools", async () => {
    const stub = stubFetch();
    render(<CreateDraftForm discordEnabled />);
    await pickGoat();
    fireEvent.click(sourceTab("List"));
    paste("99 Dragon Egg");
    await screen.findByText(/^Pasted list - 99 cards/);
    setSmallTable();
    fireEvent.click(screen.getByText("Extra Deck round"));
    fireEvent.click(screen.getByLabelText("Draft the Extra Deck on its own"));
    fireEvent.change(screen.getByLabelText("Extra Deck cards per player"), { target: { value: "9" } });

    await waitFor(() => expect(createButton()).toBeEnabled());
    fireEvent.change((fireEvent.click(screen.getByText("Name & channel")), screen.getByLabelText("Draft name")), { target: { value: "Friday" } });
    fireEvent.click(createButton());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/draft/made"));
    const { name, channelId, config } = posted(stub);
    expect(name).toBe("Friday");
    expect(channelId).toBeUndefined();
    expect(config).toMatchObject({
      lobbySeats: 2,
      packsPerPlayer: 2,
      packSize: 20,
      cardsPerPlayer: 40,
      picksPerStep: 2,
      pickSeconds: 45,
      copyLimit: true,
      extraDeckEnabled: true,
      extraDeckSize: 9,
      includeNames: [],
      excludeNames: [],
      poolSource: { cubeId: 1, cubeName: "Goat cube" },
    });
    const main = config.customCardIds as number[];
    expect(main).toHaveLength(9 + 99);
    expect(main.filter((id) => id === 106)).toHaveLength(99);
    expect(main.filter((id) => id === 101)).toHaveLength(3);
    expect(config.customExtraCardIds).toHaveLength(18);
  });

  it("sends the chosen channel, and the auto name when no name is typed", async () => {
    const stub = stubFetch({ extra: { "GET /api/discord/channels": () => Response.json({ channels: [{ id: "c1", name: "drafts" }] }) } });
    render(<CreateDraftForm discordEnabled />);
    fireEvent.click(sourceTab("List"));
    paste("99 Dragon Egg");
    await screen.findByText(/^Pasted list - 99 cards/);
    setSmallTable();
    fireEvent.click(screen.getByText("Name & channel"));
    await screen.findByRole("option", { name: "#drafts" });
    fireEvent.change(screen.getByLabelText("Discord channel"), { target: { value: "c1" } });
    await waitFor(() => expect(screen.getByLabelText("Draft name")).toHaveAttribute("placeholder", expect.stringMatching(/^Cube draft/)));
    fireEvent.click(createButton());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/draft/made"));
    const body = posted(stub);
    expect(body.channelId).toBe("c1");
    expect(body.name).toMatch(/^Cube draft · /);
    expect(body.config.poolSource).toBeFalsy();
  });

  it("offers Private (checked) and Open, and sends visibility private by default", async () => {
    const stub = stubFetch();
    render(<CreateDraftForm />);
    const group = screen.getByRole("group", { name: "Who can join" });
    expect(within(group).getByRole("radio", { name: /private/i })).toBeChecked();
    expect(within(group).getByRole("radio", { name: /open/i })).not.toBeChecked();
    expect(within(group).getByText("Only people with your invite link can see and join")).toBeInTheDocument();
    expect(within(group).getByText("Listed in Open right now for everyone")).toBeInTheDocument();
    fireEvent.click(sourceTab("List"));
    paste("99 Dragon Egg");
    await screen.findByText(/^Pasted list - 99 cards/);
    setSmallTable();
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/draft/made"));
    expect((stub.find("/api/drafts", "POST")[0].body as { visibility: string }).visibility).toBe("private");
  });

  it("sends visibility open when Open is chosen", async () => {
    const stub = stubFetch();
    render(<CreateDraftForm />);
    fireEvent.click(screen.getByRole("radio", { name: /open/i }));
    fireEvent.click(sourceTab("List"));
    paste("99 Dragon Egg");
    await screen.findByText(/^Pasted list - 99 cards/);
    setSmallTable();
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/draft/made"));
    expect((stub.find("/api/drafts", "POST")[0].body as { visibility: string }).visibility).toBe("open");
  });

  it("sends copyLimit false when Limit 3 copies per card is cleared", async () => {
    const stub = stubFetch();
    render(<CreateDraftForm />);
    fireEvent.click(sourceTab("List"));
    paste("99 Dragon Egg");
    await screen.findByText(/^Pasted list - 99 cards/);
    setSmallTable();
    fireEvent.click(screen.getByLabelText("Limit 3 copies per card"));
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(posted(stub).config).toMatchObject({ copyLimit: false });
  });

  it("creates from the Ctrl+Enter shortcut, even from the name field", async () => {
    const stub = stubFetch();
    render(<CreateDraftForm discordEnabled />);
    fireEvent.click(sourceTab("List"));
    paste("99 Dragon Egg");
    await screen.findByText(/^Pasted list - 99 cards/);
    setSmallTable();
    fireEvent.click(screen.getByText("Name & channel"));
    const name = screen.getByLabelText("Draft name");
    fireEvent.change(name, { target: { value: "Keys" } });
    fireEvent.keyDown(name, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/draft/made"));
    expect(stub.find("/api/drafts", "POST")).toHaveLength(1);
  });

  it("stays disabled, and sends nothing, while the rules do not fit the pool or the numbers are illegal", async () => {
    const stub = stubFetch();
    render(<CreateDraftForm />);
    fireEvent.click(sourceTab("List"));
    paste("40 Dragon Egg");
    await screen.findByText(/^Pasted list - 40 cards/);

    // 4 seats x 5 rounds x 24 is far more than 40 cards.
    expect(createButton()).toBeDisabled();
    expect(screen.getAllByText(/Main piles are \d+ cards short/).length).toBeGreaterThan(0);
    fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });

    // A table of one is not a legal number, even when the pool is large enough.
    setSmallTable();
    fireEvent.change(screen.getByLabelText("Players"), { target: { value: "1" } });
    expect(createButton()).toBeDisabled();
    fireEvent.click(createButton());
    expect(stub.find("/api/drafts", "POST")).toHaveLength(0);
  });

  it("disables Create and sets aria-busy while a picked cube is still opening", async () => {
    const slow = deferred();
    stubFetch({ extra: { "GET /api/cubes/1": () => slow.promise } });
    render(<CreateDraftForm />);
    fireEvent.click(sourceTab("Cubes"));
    fireEvent.click(await screen.findByRole("button", { name: /Goat cube/ }));

    await waitFor(() => expect(createButton()).toBeDisabled());
    slow.release(Response.json({ pools: { main: [{ catalogCardId: 101, maxCopies: 3 }], extra: [] }, cards: [] }));
    await screen.findByRole("region", { name: "Chosen cube" });
  });

  it("shows the server's error beside Create, keeps the form and does not route", async () => {
    const stub = stubFetch({ extra: { "POST /api/drafts": () => Response.json({ error: "Name is taken" }, { status: 409 }) } });
    render(<CreateDraftForm />);
    fireEvent.click(sourceTab("List"));
    paste("99 Dragon Egg");
    await screen.findByText(/^Pasted list - 99 cards/);
    setSmallTable();
    fireEvent.click(createButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Name is taken");
    expect(createButton()).toBeEnabled();
    expect(createButton()).not.toHaveAttribute("aria-busy");
    expect(push).not.toHaveBeenCalled();
    expect(stub.find("/api/drafts", "POST")).toHaveLength(1);

    // A second try clears the old message while it runs.
    fireEvent.click(createButton());
    await waitFor(() => expect(stub.find("/api/drafts", "POST")).toHaveLength(2));
  });

  it("goes to the lobby list when the answer has no slug", async () => {
    stubFetch({ extra: { "POST /api/drafts": () => Response.json({}, { status: 201 }) } });
    render(<CreateDraftForm />);
    fireEvent.click(sourceTab("List"));
    paste("99 Dragon Egg");
    await screen.findByText(/^Pasted list - 99 cards/);
    setSmallTable();
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/drafts"));
  });
});
