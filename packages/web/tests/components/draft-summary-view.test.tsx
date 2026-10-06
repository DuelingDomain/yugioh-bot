// @vitest-environment jsdom
import { fixtureUserId } from "../fixtures/identity";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DraftSummaryView } from "../../src/components/draft/draft-summary-view";
import styles from "../../src/components/draft/summary/summary.module.css";
import { installVirtualizerJsdomEnv } from "../helpers/virtualizer-jsdom";

vi.mock("next/image", () => ({
  default: ({ alt, fill: _fill, priority: _priority, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => (
    <img alt={alt} {...props} />
  ),
}));

const samplePool = [
  {
    id: 89631139,
    passcode: 89631139,
    name: "Blue-Eyes White Dragon",
    type: "Normal Monster",
    frameType: "normal",
    attribute: "LIGHT",
    level: 8,
    effectText: "This legendary dragon is a powerful engine of destruction.",
    atk: 3000,
    def: 2500,
    imageUrl: "https://images.ygoprodeck.com/images/cards/89631139.jpg",
    imageUrlSmall: "https://images.ygoprodeck.com/images/cards_small/89631139.jpg",
  },
  {
    id: 46986414,
    passcode: 53129443,
    name: "Dark Hole",
    type: "Spell Card",
    frameType: "spell",
    attribute: "SPELL",
    effectText: "Destroy all monsters on the field.",
    imageUrl: "https://images.ygoprodeck.com/images/cards/46986414.jpg",
    imageUrlSmall: "https://images.ygoprodeck.com/images/cards_small/46986414.jpg",
  },
  {
    id: 77563800,
    passcode: 44095762,
    name: "Mirror Force",
    type: "Trap Card",
    frameType: "trap",
    attribute: "TRAP",
    effectText: "When an opponent's monster declares an attack: Destroy all Attack Position monsters your opponent controls.",
    imageUrl: "https://images.ygoprodeck.com/images/cards/77563800.jpg",
    imageUrlSmall: "https://images.ygoprodeck.com/images/cards_small/77563800.jpg",
  },
];

const subtypePool = [
  {
    id: 1,
    passcode: 83764718,
    name: "Monster Reborn",
    type: "Quick-Play Spell Card",
    frameType: "spell",
    attribute: "SPELL",
    effectText: "Special Summon 1 monster from either GY.",
    imageUrl: "https://images.ygoprodeck.com/images/cards/1.jpg",
    imageUrlSmall: "https://images.ygoprodeck.com/images/cards_small/1.jpg",
  },
  {
    id: 2,
    passcode: 41420027,
    name: "Solemn Judgment",
    type: "Counter Trap Card",
    frameType: "trap",
    attribute: "TRAP",
    effectText: "Negate the activation.",
    imageUrl: "https://images.ygoprodeck.com/images/cards/2.jpg",
    imageUrlSmall: "https://images.ygoprodeck.com/images/cards_small/2.jpg",
  },
  {
    id: 3,
    passcode: 85742772,
    name: "Gravity Bind",
    type: "Continuous Trap Card",
    frameType: "trap",
    attribute: "TRAP",
    effectText: "Level 4 or higher monsters cannot attack.",
    imageUrl: "https://images.ygoprodeck.com/images/cards/3.jpg",
    imageUrlSmall: "https://images.ygoprodeck.com/images/cards_small/3.jpg",
  },
];

const baseDraft = {
  id: 1,
  name: "Legendary Draft",
  status: "completed",
  createdByUserId: fixtureUserId("creator-1"),
  createdAt: "2026-05-06T12:00:00.000Z",
  endedAt: "2026-05-06T12:30:00.000Z",
  config: {
    packSize: 5,
    packsPerPlayer: 3,
    pickSeconds: 60,
    setNames: ["Legend of Blue Eyes White Dragon", "Metal Raiders", "Spell Ruler"],
  },
  players: [
    {
      playerId: 1,
      displayName: "You",
      seatIndex: 0,
      pickCount: 15,
      joinedAt: "2026-05-06T12:00:00.000Z",
    },
  ],
  playerCount: 1,
};

describe("DraftSummaryView", () => {
  beforeEach(() => installVirtualizerJsdomEnv());
  it("hides YDK export for completed drafts with fewer than 40 picks", () => {
    render(
      <DraftSummaryView
        draft={{ ...baseDraft, participantPickCount: 15 } as any}
        isParticipant={true}
        isCreator={false}
        slug="test-draft"
        onExportYdk={vi.fn().mockResolvedValue("#main")}
        onDelete={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /export ydk/i })).toBeNull();
    expect(screen.getByText(/export needs at least 40 picks\. you made 15/i)).toBeTruthy();
  });

  it("renders card pool section with correct card names when isParticipant=true and myPool has cards", () => {
    render(
      <DraftSummaryView
        draft={baseDraft as any}
        isParticipant={true}
        isCreator={false}
        slug="test-draft"
        onExportYdk={vi.fn().mockResolvedValue("#main")}
        onDelete={vi.fn()}
        myPool={samplePool}
      />
    );

    expect(screen.getByRole("heading", { name: "Your pool" })).toBeTruthy();
    expect(screen.getByText(/3 cards, tap a card to read it/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Blue-Eyes White Dragon" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dark Hole" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mirror Force" })).toBeTruthy();
  });

  it("groups the pool by kind with a kind tally and a monster levels chart", () => {
    render(
      <DraftSummaryView
        draft={baseDraft as any}
        isParticipant={true}
        isCreator={false}
        slug="test-draft"
        onExportYdk={vi.fn().mockResolvedValue("#main")}
        onDelete={vi.fn()}
        myPool={samplePool}
      />
    );
    for (const t of ["Monsters", "Spells", "Traps"]) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("img", { name: /main deck monsters by level: 0 need no tribute, 0 need one tribute, 1 needs two tributes/i }),
    ).toBeTruthy();
  });

  it("splits a theme pool into main and extra deck and shows only 12 cards before expanding", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ ...samplePool[1], id: 1000 + i, name: `Spell ${i}` }));
    render(
      <DraftSummaryView
        draft={{ ...baseDraft, config: { ...baseDraft.config, mode: "theme" } } as any}
        isParticipant={true}
        isCreator={false}
        slug="test-draft"
        onExportYdk={vi.fn().mockResolvedValue("#main")}
        onDelete={vi.fn()}
        myPool={many}
      />
    );
    expect(screen.getAllByText("Main deck").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^Spell \d+$/ }).length).toBe(12);
    fireEvent.click(screen.getByRole("button", { name: "3 more" }));
    expect(screen.getAllByRole("button", { name: /^Spell \d+$/ }).length).toBe(15);
    expect(screen.queryByText("Every card in the pool")).toBeNull();
  });

  it("shows pool picks on a cancelled draft without next steps", () => {
    render(
      <DraftSummaryView
        draft={{ ...baseDraft, status: "cancelled", participantPickCount: 3 } as any}
        isParticipant={true}
        isCreator={false}
        slug="test-draft"
        onExportYdk={vi.fn().mockResolvedValue("#main")}
        onDelete={vi.fn()}
        myPool={samplePool}
      />
    );
    expect(screen.getByText("The host cancelled this draft before it finished.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dark Hole" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /deck/i })).toBeNull();
    expect(screen.getByText("Cancelled")).toBeTruthy();
  });

  it("does NOT render card pool section when isParticipant=false", () => {
    render(
      <DraftSummaryView
        draft={baseDraft as any}
        isParticipant={false}
        isCreator={false}
        slug="test-draft"
        onExportYdk={vi.fn().mockResolvedValue("#main")}
        onDelete={vi.fn()}
        myPool={samplePool}
      />
    );

    expect(screen.queryByText(/your pool/i)).toBeNull();
    expect(screen.queryByText("Blue-Eyes White Dragon")).toBeNull();
  });

  it("does NOT render card pool section when myPool is empty", () => {
    render(
      <DraftSummaryView
        draft={baseDraft as any}
        isParticipant={true}
        isCreator={false}
        slug="test-draft"
        onExportYdk={vi.fn().mockResolvedValue("#main")}
        onDelete={vi.fn()}
        myPool={[]}
      />
    );

    expect(screen.queryByText(/your pool/i)).toBeNull();
  });

  it("does NOT render card pool section when myPool is undefined", () => {
    render(
      <DraftSummaryView
        draft={baseDraft as any}
        isParticipant={true}
        isCreator={false}
        slug="test-draft"
        onExportYdk={vi.fn().mockResolvedValue("#main")}
        onDelete={vi.fn()}
      />
    );

    expect(screen.queryByText(/your pool/i)).toBeNull();
  });

  it("renders labelled attributes and short monster types below the tally, beside the levels chart", () => {
    render(
      <DraftSummaryView
        draft={baseDraft as any}
        isParticipant={true}
        isCreator={false}
        slug="test-draft"
        onExportYdk={vi.fn().mockResolvedValue("#main")}
        onDelete={vi.fn()}
        myPool={samplePool}
      />,
    );
    const attrs = screen.getByRole("list", { name: "Attributes drafted" });
    expect(attrs).toHaveTextContent("Light 1");
    const types = screen.getByRole("list", { name: "Monster kinds drafted" });
    expect(types).toHaveTextContent("Normal 1");
    expect(types).not.toHaveTextContent(/Spell|Trap|Monster/);
    expect(screen.getByText("Attribute")).toBeInTheDocument();
    expect(types.previousElementSibling).toHaveTextContent("Monsters");
    const chipRows = attrs.parentElement!.parentElement!;
    const header = chipRows.parentElement!;
    expect(header.children[0]).toHaveTextContent("1Monsters1Spells1Traps0Extra deck");
    expect(header.children[1]).toBe(chipRows);
    expect(within(header.children[2] as HTMLElement).getByText("Monster levels")).toBeInTheDocument();
  });

  it("lazily loads and shows the full pool when expanded", async () => {
    const cards = [
      { id: 1, name: "Pot of Greed", type: "Spell Card", frameType: "spell", attribute: "SPELL", effectText: "Draw 2.", imageUrl: "u1", imageUrlSmall: "s1", qty: 3 },
    ];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ cards }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DraftSummaryView
        draft={baseDraft as any}
        isParticipant={true}
        isCreator={false}
        slug="test-draft"
        onExportYdk={vi.fn().mockResolvedValue("#main")}
        onDelete={vi.fn()}
        myPool={samplePool}
      />,
    );

    fireEvent.click(screen.getByText("Every card in the pool"));
    expect(fetchMock).toHaveBeenCalledWith("/api/drafts/test-draft/pool");
    expect(await screen.findByText("Pot of Greed")).toBeTruthy();

    vi.unstubAllGlobals();
  });

  const renderView = (draft: Record<string, unknown>, props: Record<string, unknown> = {}) =>
    render(
      <DraftSummaryView
        draft={draft as any}
        isParticipant={true}
        isCreator={false}
        slug="test-draft"
        onExportYdk={vi.fn().mockResolvedValue("#main")}
        onDelete={vi.fn()}
        {...props}
      />,
    );

  it.each([
    ["booster", "Monsters", samplePool[0]],
    ["booster", "Spells", samplePool[1]],
    ["booster", "Traps", samplePool[2]],
    ["booster", "Extra deck", { ...samplePool[0], type: "Fusion Monster", frameType: "fusion" }],
    ["theme", "Main deck", samplePool[1]],
    ["theme", "Extra deck", { ...samplePool[0], type: "Fusion Monster", frameType: "fusion" }],
  ] as const)("supplies desktop and phone counts for %s %s and expands on phones", (mode, title, card) => {
    const many = Array.from({ length: 15 }, (_, i) => ({ ...card, id: 1000 + i, name: `Card ${i + 1}` }));
    renderView({ ...baseDraft, config: { ...baseDraft.config, mode } }, { myPool: many });
    const list = screen.getByRole("button", { name: "Card 1" }).closest("ul")!;
    expect(list.previousElementSibling).toHaveTextContent(`${title} 15`);
    expect(within(list).getAllByRole("button", { name: /^Card / })).toHaveLength(12);
    expect(list.querySelectorAll(`.${styles.desktopCard}`)).toHaveLength(5);
    const desktopMore = list.querySelector(`.${styles.desktopMore} button`)!;
    const phoneMore = list.querySelector(`.${styles.phoneMore} button`)!;
    expect(desktopMore).toHaveTextContent("3 more");
    expect(phoneMore).toHaveTextContent("8 more");
    fireEvent.click(phoneMore);
    expect(within(list).getAllByRole("button", { name: /^Card / })).toHaveLength(15);
    expect(within(list).queryByRole("button", { name: /more$/ })).toBeNull();
    expect(list.querySelectorAll(`.${styles.desktopCard}`)).toHaveLength(0);
  });

  it.each([
    [7, null, null],
    [8, null, "1 more"],
    [12, null, "5 more"],
    [13, "1 more", "6 more"],
  ] as const)("supplies the correct preview counts for a group of %i cards", (count, desktopCount, phoneCount) => {
    const many = Array.from({ length: count }, (_, i) => ({ ...samplePool[1], id: 1000 + i, name: `Card ${i + 1}` }));
    renderView(baseDraft, { myPool: many });
    const list = screen.getByRole("button", { name: "Card 1" }).closest("ul")!;
    expect(list.querySelector(`.${styles.desktopMore} button`)?.textContent ?? null).toBe(desktopCount);
    expect(list.querySelector(`.${styles.phoneMore} button`)?.textContent ?? null).toBe(phoneCount);
  });

  it.each([
    [45, "45 s"], [60, "1 min"], [90, "1 min 30 s"], [600, "10 min"],
  ])("formats a %i-second pick in the finished Setup panel as %s", (seconds, text) => {
    renderView({ ...baseDraft, config: { ...baseDraft.config, pickSeconds: seconds } });
    const setup = screen.getByRole("heading", { name: "Setup" }).closest("section")!;
    expect(within(setup).getByText("Pick duration").nextElementSibling).toHaveTextContent(text);
  });

  it("offers Build your deck only as a ghost link while the player has no saved deck", () => {
    renderView({ ...baseDraft, participantPickCount: 15 });
    const link = screen.getByRole("link", { name: /build your deck/i });
    expect(link.getAttribute("href")).toBe("/decks/draft/test-draft");
    expect(link).toHaveClass("sv-btn", "ghost");
    expect(screen.queryByRole("link", { name: /view your deck/i })).toBeNull();
  });

  it("shows View your deck instead of Build your deck when the player already has a draft deck", () => {
    renderView({ ...baseDraft, participantPickCount: 15, myDeckId: 7 });
    expect(screen.getByRole("link", { name: /view your deck/i }).getAttribute("href")).toBe("/decks/draft/test-draft");
    expect(screen.queryByRole("link", { name: /build your deck/i })).toBeNull();
  });

  it("says the deck is saved and editing is optional once the automatic deck exists", () => {
    renderView({ ...baseDraft, participantPickCount: 15, myDeckId: 7 });
    expect(screen.getByRole("link", { name: /view your deck/i })).toHaveClass("sv-btn", "ghost");
    expect(screen.getByText("Your deck is saved")).toBeInTheDocument();
    expect(screen.getByText(/editing it is optional/i)).toBeInTheDocument();
  });

  it("hides the deck link for a spectator and for a player with no picks", () => {
    renderView({ ...baseDraft, participantPickCount: 15 }, { isParticipant: false });
    expect(screen.queryByRole("link", { name: /(build|view) your deck/i })).toBeNull();
  });

  it("shows Export YDK as a ghost button next to the deck link for 40 picks", () => {
    renderView({ ...baseDraft, participantPickCount: 40, myDeckId: 7 });
    expect(screen.getByRole("button", { name: /export ydk/i })).toHaveClass("sv-btn", "ghost");
    expect(screen.queryByRole("link", { name: /build your deck/i })).toBeNull();
  });

  it("makes Create tournament the primary action for the host", () => {
    renderView({ ...baseDraft, participantPickCount: 15, myDeckId: 7, canCreateTournament: true }, { isCreator: true });
    expect(screen.getByRole("button", { name: "Create tournament" })).toHaveClass("sv-btn", "primary");
    expect(screen.queryByText(/will start the tournament/i)).toBeNull();
  });

  it("offers Create tournament to a guild admin who is not the host", () => {
    renderView({ ...baseDraft, participantPickCount: 15, myDeckId: 7, canCreateTournament: true }, { isCreator: false });
    expect(screen.getByRole("button", { name: "Create tournament" })).toHaveClass("sv-btn", "primary");
    expect(screen.queryByText(/will start the tournament/i)).toBeNull();
  });

  it("offers no create button to the host when the server refuses", () => {
    renderView({ ...baseDraft, participantPickCount: 15, myDeckId: 7, canCreateTournament: false }, { isCreator: true });
    expect(screen.queryByRole("button", { name: "Create tournament" })).toBeNull();
  });

  it("tells other players the host starts the tournament, with no create button", () => {
    renderView({ ...baseDraft, participantPickCount: 15, myDeckId: 7 });
    expect(screen.getByText("The host or a server admin will start the tournament.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create tournament" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Go to tournament" })).toBeNull();
  });

  it.each([true, false])("links to the existing tournament with isCreator=%s and offers no create form", (isCreator) => {
    renderView(
      { ...baseDraft, participantPickCount: 15, myDeckId: 7, tournamentId: 4, tournamentName: "Cup", tournamentSlug: "cup" },
      { isCreator },
    );
    const link = screen.getByRole("link", { name: "Go to tournament" });
    expect(link.getAttribute("href")).toBe("/tournament/cup");
    expect(link).toHaveClass("sv-btn", "primary");
    expect(screen.queryByRole("button", { name: "Create tournament" })).toBeNull();
    expect(screen.queryByText(/will start the tournament/i)).toBeNull();
  });

  it("sends Best of 3 by default and the chosen length when the creator makes a tournament", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 4, name: "T", webSlug: "t-4" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderView({ ...baseDraft, participantPickCount: 15, canCreateTournament: true }, { isCreator: true });

    const select = screen.getByLabelText(/match length/i) as HTMLSelectElement;
    expect(select.value).toBe("3");
    fireEvent.change(select, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create tournament" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/drafts/test-draft/tournament");
    expect(JSON.parse(init.body)).toEqual({ format: "round_robin", bestOf: 1 });
    vi.unstubAllGlobals();
  });

  it("keeps the focused Create tournament button enabled while creating and ignores a repeat click", () => {
    const create = vi.fn(async () => {});
    const tournament = { linked: null, format: "round_robin", setFormat() {}, bestOf: 3, setBestOf() {}, creating: false, error: null, create };
    const draft = { ...baseDraft, participantPickCount: 15, canCreateTournament: true };
    const { rerender } = renderView(draft, { isCreator: true, tournament });
    const button = screen.getByRole("button", { name: "Create tournament" });
    button.focus();
    fireEvent.click(button);
    expect(create).toHaveBeenCalledTimes(1);

    rerender(
      <DraftSummaryView
        draft={draft as any}
        isParticipant={true}
        isCreator={true}
        slug="test-draft"
        onExportYdk={vi.fn().mockResolvedValue("#main")}
        onDelete={vi.fn()}
        tournament={{ ...tournament, creating: true } as any}
      />,
    );
    const busy = screen.getByRole("button", { name: "Create tournament" });
    expect(busy).toBe(button);
    expect((busy as HTMLButtonElement).disabled).toBe(false);
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(busy);
    fireEvent.click(busy);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("links to the existing tournament on a 409", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ id: 4, name: "T", webSlug: "t-4" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderView({ ...baseDraft, participantPickCount: 15, canCreateTournament: true }, { isCreator: true });
    fireEvent.click(screen.getByRole("button", { name: "Create tournament" }));
    const link = await screen.findByRole("link", { name: "Go to tournament" });
    expect(link.getAttribute("href")).toBe("/tournament/t-4");
    vi.unstubAllGlobals();
  });

  it("shows a link to Tournaments to everyone when only the id is known", () => {
    renderView({ ...baseDraft, participantPickCount: 15, tournamentId: 9 }, { isParticipant: false });
    expect(screen.getByText("A tournament was made from this draft.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Find it on Tournaments" }).getAttribute("href")).toBe("/tournaments");
    expect(screen.queryByRole("button", { name: "Create tournament" })).toBeNull();
  });

  it("shows a tournament made in the finale through the shared controller", () => {
    renderView(
      { ...baseDraft, participantPickCount: 15, myDeckId: 7 },
      { isCreator: true, tournament: { linked: { name: "Cup", webSlug: "cup" }, format: "round_robin", setFormat() {}, bestOf: 3, setBestOf() {}, creating: false, error: null, create: async () => {} } },
    );
    expect(screen.getByRole("link", { name: "Go to tournament" }).getAttribute("href")).toBe("/tournament/cup");
    expect(screen.queryByRole("button", { name: "Create tournament" })).toBeNull();
  });

  it("confirms in place before deleting, host only", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderView({ ...baseDraft, participantPickCount: 15 }, { isCreator: true, onDelete });
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    expect(screen.getByText("Delete Legendary Draft?")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalled());
    unmount();
    renderView({ ...baseDraft, participantPickCount: 15 });
    expect(screen.queryByRole("button", { name: "Delete draft" })).toBeNull();
  });

  it("backs out of the delete confirm with Escape and puts focus back on Delete", async () => {
    const onDelete = vi.fn();
    renderView({ ...baseDraft, participantPickCount: 15 }, { isCreator: true, onDelete });
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    expect(screen.getByRole("button", { name: "Go back" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Go back" }), { key: "Escape" });
    expect(screen.queryByText("Delete Legendary Draft?")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete draft" })).toHaveFocus();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("opens a card's details on tap, so phones can read it too, and closes them", () => {
    renderView(baseDraft, { myPool: samplePool });
    fireEvent.click(screen.getByRole("button", { name: "Dark Hole" }));
    expect(screen.getByText("Destroy all monsters on the field.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByText("Destroy all monsters on the field.")).toBeNull();
  });

  it("says the YDK holds the first 40 picks when there are more", () => {
    renderView({ ...baseDraft, participantPickCount: 45, myDeckId: 3 });
    expect(screen.getByText("It is saved in My decks. Editing it is optional. You can also export your first 40 picks as a YDK file.")).toBeTruthy();
  });

  it("marks the viewer's seat and shows the duration as short pieces", () => {
    renderView(
      { ...baseDraft, startedAt: "2026-05-06T12:00:00.000Z", participantPickCount: 15, seats: [{ playerId: 1, isCurrentPlayer: true }] },
    );
    expect(screen.getByText("You", { selector: "span.sv-pill" })).toBeTruthy();
    const pieces = screen.getByText("Finished").closest("ul")!;
    const items = Array.from(pieces.children);
    expect(items.slice(0, 3).map((item) => item.textContent)).toEqual(["Finished", "Cube draft", "1 player"]);
    expect(items[3]).toHaveTextContent(/^Ended /);
    expect(items[4]).toHaveTextContent("Took 30 min");
    expect(items).toHaveLength(5);
    const stages = screen.getByRole("list", { name: "Draft progress" });
    expect(stages.querySelector("[aria-current='step']")).toHaveTextContent("Build deck");
  });

  it("shows no picks of other players, only how many each made", () => {
    const { container } = renderView(
      { ...baseDraft, players: [...baseDraft.players, { playerId: 2, displayName: "Kestrel", seatIndex: 1, pickCount: 15, joinedAt: "2026-05-06T12:00:00.000Z" }], playerCount: 2, participantPickCount: 15, seats: [{ playerId: 1, isCurrentPlayer: true }] },
      { myPool: samplePool },
    );
    expect(screen.getByText("Kestrel")).toBeTruthy();
    expect(screen.getAllByText("picks")).toHaveLength(2);
    expect(container.textContent).not.toMatch(/\u00b7/);
  });
});

const FIXTURE_KEYS = ["creator-1"] as const;
