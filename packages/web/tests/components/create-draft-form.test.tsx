// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CreateDraftForm } from "../../src/components/draft/create-draft-form";
import { installVirtualizerJsdomEnv } from "../helpers/virtualizer-jsdom";
import { CATALOG, GOAT, OTHERS, card, stubFetch } from "../helpers/pool-fixtures";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => installVirtualizerJsdomEnv());

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function pickGoat() {
  fireEvent.click(await screen.findByRole("button", { name: /Goat cube/ }));
  await screen.findByRole("region", { name: "Chosen cube" });
}

async function openEditor() {
  await pickGoat();
  fireEvent.click(screen.getByRole("button", { name: "Customize for this draft" }));
}

async function addCardByName(query: string, name: string) {
  fireEvent.change(screen.getByLabelText("Search cards by name"), { target: { value: query } });
  fireEvent.click(await screen.findByRole("button", { name: `Add one copy of ${name}` }));
}

function postedDraft(stub: ReturnType<typeof stubFetch>) {
  return stub.find("/api/drafts", "POST")[0]?.body as { name: string; config: Record<string, unknown> };
}

describe("CreateDraftForm pool: starting from a cube", () => {
  it("opens the cube picker when cubes exist, hides theme cubes and says who made each", async () => {
    stubFetch();
    render(<CreateDraftForm />);

    const options = within(await screen.findByRole("list", { name: "Cubes" })).getAllByRole("listitem");
    expect(options.map((o) => within(o).getByText(/cube$/).textContent)).toEqual(["Goat cube", "Despia cube"]);
    expect(within(options[0]).getByText("by you")).toBeInTheDocument();
    expect(within(options[1]).getByText("by Josh")).toBeInTheDocument();
    expect(within(options[0]).getByText("9")).toBeInTheDocument();
    expect(screen.queryByText("Theme only cube")).toBeNull();
    expect(screen.getByRole("button", { name: "Use a cube" })).toHaveAttribute("aria-pressed", "true");
  });

  it("filters the picker by cube name or maker", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    const cubes = await screen.findByRole("list", { name: "Cubes" });
    fireEvent.change(screen.getByLabelText("Search cubes"), { target: { value: "josh" } });
    expect(within(cubes).getAllByRole("button")).toHaveLength(1);
    expect(within(cubes).getByRole("button")).toHaveTextContent("Despia cube");
    fireEvent.change(screen.getByLabelText("Search cubes"), { target: { value: "zzz" } });
    expect(screen.getByText("No cube matches that.")).toBeInTheDocument();
  });

  it("shows the chosen cube as one card with its tally and the Extra Deck note, with no editor until asked", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    await pickGoat();

    const summary = screen.getByRole("region", { name: "Chosen cube" });
    expect(within(summary).getByRole("heading", { name: "Goat cube" })).toBeInTheDocument();
    expect(summary).toHaveTextContent("By you");
    expect(summary).toHaveTextContent("9cards in the main pool");
    expect(summary).toHaveTextContent("5Monsters");
    expect(summary).toHaveTextContent("1Spells");
    expect(summary).toHaveTextContent("3Traps");
    expect(summary).toHaveTextContent("6 Extra Deck cards stay out. Cube drafts deal main-deck cards.");
    expect(screen.queryByRole("region", { name: "Pool status" })).toBeNull();
    expect(screen.queryByLabelText("Search cards by name")).toBeNull();
    expect(screen.getByRole("link", { name: /Open in editor/ })).toHaveAttribute("href", "/cubes/1");
    expect(screen.getByRole("complementary", { name: /draft summary/i })).toHaveTextContent("Goat cube");
  });

  it("creates the draft with the cube's cards one passcode per copy and the cube it came from", async () => {
    const stub = stubFetch();
    render(<CreateDraftForm />);
    await pickGoat();
    fireEvent.change(screen.getByLabelText(/draft name/i), { target: { value: "Friday" } });
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/draft/made"));
    const { config, name } = postedDraft(stub);
    expect(name).toBe("Friday");
    expect(config).toMatchObject({
      setNames: [],
      customCardIds: [101, 101, 101, 102, 102, 103, 104, 104, 104],
      includeNames: [],
      excludeNames: [],
      poolSource: { cubeId: 1, cubeName: "Goat cube" },
      cardsPerPlayer: 40,
      packSize: 15,
      packsPerPlayer: 3,
    });
  });

  it("opens a cube made before cubes held cards by resolving its sets", async () => {
    stubFetch({
      cubes: [{ ...OTHERS, mainCards: [], setNames: ["Metal Raiders"], customCardIds: [], draftType: "booster" }],
    });
    render(<CreateDraftForm />);
    const row = await screen.findByRole("button", { name: /Despia cube/ });
    expect(row).toHaveTextContent("Built from sets");
    fireEvent.click(row);
    const summary = await screen.findByRole("region", { name: "Chosen cube" });
    expect(summary).toHaveTextContent("3cards in the main pool");
  });
});

describe("CreateDraftForm pool: customizing a cube", () => {
  it("marks the pool edited, names what changed and keeps the cube itself untouched", async () => {
    const stub = stubFetch();
    render(<CreateDraftForm />);
    await openEditor();
    await addCardByName("cipher", "Cipher Soldier");

    const status = screen.getByRole("region", { name: "Pool status" });
    expect(status).toHaveTextContent("Edited for this draft. 1 card added.");
    expect(status).toHaveTextContent("Goat cube itself hasn't changed.");
    expect(screen.getByText("Added 1 copy of Cipher Soldier.")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: /draft summary/i })).toHaveTextContent("Goat cube, edited");
    expect(stub.find("/api/cubes", "POST")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/draft name/i), { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(postedDraft(stub).config).toMatchObject({
      customCardIds: [101, 101, 101, 102, 102, 103, 104, 104, 104, 105],
      poolSource: { cubeId: 1, cubeName: "Goat cube" },
    });
  });

  it("steps copies up to 99, removes a card at one copy, and Reset returns to the cube", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    await openEditor();

    const list = screen.getByRole("list", { name: "Pool cards" });
    const alpha = () => within(list).getByText("Alpha Beast").closest("[role=listitem]") as HTMLElement;
    for (let i = 0; i < 96; i += 1) fireEvent.click(within(alpha()).getByRole("button", { name: "One more Alpha Beast" }));
    expect(within(alpha()).getByLabelText("99 copies")).toBeInTheDocument();
    expect(within(alpha()).getByRole("button", { name: "One more Alpha Beast" })).toBeDisabled();

    const pot = () => within(list).getByText("Pot of Greed").closest("[role=listitem]") as HTMLElement;
    fireEvent.click(within(pot()).getByRole("button", { name: "Remove Pot of Greed from the pool" }));
    expect(within(list).queryByText("Pot of Greed")).toBeNull();
    expect(screen.getByRole("region", { name: "Pool status" })).toHaveTextContent("96 cards added, 1 removed");

    fireEvent.click(screen.getByRole("button", { name: "Removed (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo removing Pot of Greed" }));
    expect(within(list).getByText("Pot of Greed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.queryByRole("region", { name: "Pool status" })).toBeNull();
    expect(within(alpha()).getByLabelText("3 copies")).toBeInTheDocument();
  });

  it("adds an archetype at three copies each and says the Extra Deck cards stayed out", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Archetype" }));
    expect(screen.getByText(/3 copies each/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Archetype"), { target: { value: "blue" } });
    fireEvent.click(await screen.findByRole("button", { name: "Blue-Eyes" }));

    expect(await screen.findByText("Added 2 cards from Blue-Eyes. 1 Extra Deck card stays out.")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Pool cards" });
    expect(within(list).getByText("Blue-Eyes White Dragon")).toBeInTheDocument();
    expect(within(list).queryByText("Blue-Eyes Ultimate")).toBeNull();
    const row = within(list).getByText("Blue-Eyes White Dragon").closest("[role=listitem]") as HTMLElement;
    expect(within(row).getByLabelText("3 copies")).toBeInTheDocument();
  });

  it("adds a set with its own copy counts", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Metal Raiders" }));
    expect(await screen.findByText("Added 2 cards from Metal Raiders.")).toBeInTheDocument();
    const row = within(screen.getByRole("list", { name: "Pool cards" })).getByText("Cipher Soldier").closest("[role=listitem]") as HTMLElement;
    expect(within(row).getByLabelText("2 copies")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Metal Raiders added" })).toBeDisabled();
  });

  it("adds pasted passcodes, one copy per occurrence, and reports what it could not add", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Paste passcodes" }));
    fireEvent.change(screen.getByLabelText("Passcodes"), { target: { value: "105\n105, 900\n424242" } });
    fireEvent.click(screen.getByRole("button", { name: "Add 4 passcodes" }));

    expect(
      await screen.findByText("Added 2 copies of 1 card. 1 passcode isn't in the card list yet. 1 Extra Deck card stays out."),
    ).toBeInTheDocument();
    const row = within(screen.getByRole("list", { name: "Pool cards" })).getByText("Cipher Soldier").closest("[role=listitem]") as HTMLElement;
    expect(within(row).getByLabelText("2 copies")).toBeInTheDocument();
  });
});

describe("CreateDraftForm pool: saving", () => {
  it("saves an edited cube as a new cube, sends the cube to copy the Extra Deck from, and makes it the base", async () => {
    const stub = stubFetch();
    render(<CreateDraftForm />);
    await openEditor();
    await addCardByName("cipher", "Cipher Soldier");

    fireEvent.click(screen.getByRole("button", { name: "Save as new cube" }));
    const name = screen.getByLabelText("Name for the new cube");
    expect(name).toHaveValue("Goat cube 2");
    fireEvent.keyDown(name, { key: "Enter" });

    expect(await screen.findByText("Saved to Goat cube 2")).toBeInTheDocument();
    const [post] = stub.find("/api/cubes", "POST");
    expect(post.body).toEqual({
      kind: "pool",
      name: "Goat cube 2",
      cards: [
        { id: 101, copies: 3 },
        { id: 102, copies: 2 },
        { id: 103, copies: 1 },
        { id: 104, copies: 3 },
        { id: 105, copies: 1 },
      ],
      copyExtraFromCubeId: 1,
    });
    expect(screen.getByRole("complementary", { name: /draft summary/i })).toHaveTextContent("Goat cube 2");
    expect(screen.queryByText(/edited/)).toBeNull();
  });

  it("shows a taken name beside the field and keeps the form open", async () => {
    stubFetch({ createCube: () => Response.json({ error: "Name taken" }, { status: 409 }) });
    render(<CreateDraftForm />);
    await openEditor();
    await addCardByName("cipher", "Cipher Soldier");
    fireEvent.click(screen.getByRole("button", { name: "Save as new cube" }));
    const name = screen.getByLabelText("Name for the new cube");
    fireEvent.change(name, { target: { value: "Fresh name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A cube named Fresh name already exists. Pick another name.");
    expect(name).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(name, { target: { value: "goat CUBE" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A cube named goat CUBE already exists.");
  });

  it("Escape cancels the name field and puts focus back on the button", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    await openEditor();
    await addCardByName("cipher", "Cipher Soldier");
    fireEvent.click(screen.getByRole("button", { name: "Save as new cube" }));
    fireEvent.keyDown(screen.getByLabelText("Name for the new cube"), { key: "Escape" });
    expect(screen.queryByLabelText("Name for the new cube")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save as new cube" })).toHaveFocus());
  });

  it("asks before replacing the cube's main pool and sends only the main pool", async () => {
    const stub = stubFetch();
    render(<CreateDraftForm />);
    await openEditor();
    await addCardByName("cipher", "Cipher Soldier");

    fireEvent.click(screen.getByRole("button", { name: "Save changes to Goat cube" }));
    expect(screen.getByText("Replace Goat cube's main pool with this one? Its Extra Deck cards and other settings stay.")).toBeInTheDocument();
    expect(stub.find("/api/cubes/1/cards", "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    expect(await screen.findByText("Saved to Goat cube")).toBeInTheDocument();
    expect(stub.find("/api/cubes/1/cards", "POST")[0].body).toMatchObject({ op: "replaceMain" });
  });

  it("shows no replace button for a cube someone else owns, and says why", async () => {
    stubFetch({ userId: "u9" });
    render(<CreateDraftForm />);
    fireEvent.click(await screen.findByRole("button", { name: /Despia cube/ }));
    await screen.findByRole("region", { name: "Chosen cube" });
    fireEvent.click(screen.getByRole("button", { name: "Customize for this draft" }));
    await addCardByName("alpha", "Alpha Beast");
    expect(screen.queryByRole("button", { name: /Save changes to/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Save as new cube" })).toBeInTheDocument();
    expect(screen.getByText("Only Despia cube's owner or an admin can change it.")).toBeInTheDocument();
  });
});

describe("CreateDraftForm pool: from scratch", () => {
  it("builds a pool with no cube, saves without copyExtraFromCubeId and posts no poolSource", async () => {
    const stub = stubFetch();
    render(<CreateDraftForm />);
    fireEvent.click(await screen.findByRole("button", { name: "Start from scratch" }));
    expect(screen.getByText("Add a set, an archetype or single cards.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Card" }));
    await addCardByName("alpha", "Alpha Beast");
    expect(screen.getByRole("region", { name: "Pool status" })).toHaveTextContent("Not saved as a cube.");
    expect(screen.getByRole("complementary", { name: /draft summary/i })).toHaveTextContent("Built for this draft");

    fireEvent.click(screen.getByRole("button", { name: "Save as new cube" }));
    expect(screen.getByLabelText("Name for the new cube")).toHaveValue("My cube");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved to My cube");
    const body = stub.find("/api/cubes", "POST")[0].body as Record<string, unknown>;
    expect(body).not.toHaveProperty("copyExtraFromCubeId");
    expect(body).toMatchObject({ kind: "pool", cards: [{ id: 101, copies: 1 }] });

    fireEvent.change(screen.getByLabelText(/draft name/i), { target: { value: "Scratch" } });
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(postedDraft(stub).config).toMatchObject({ customCardIds: [101], poolSource: { cubeId: 77, cubeName: "My cube" } });
  });

  it("opens straight on scratch when there are no cubes, and asks for cards before creating", async () => {
    const stub = stubFetch({ cubes: [] });
    render(<CreateDraftForm />);
    expect(await screen.findByText("Add a set, an archetype or single cards.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use a cube" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/draft name/i), { target: { value: "Empty" } });
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add cards to the pool first");
    expect(stub.find("/api/drafts", "POST")).toHaveLength(0);
  });

  it("keeps the cube's edits when switching to scratch and back", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    await openEditor();
    await addCardByName("cipher", "Cipher Soldier");
    fireEvent.click(screen.getByRole("button", { name: "Start from scratch" }));
    expect(screen.getByText("Add a set, an archetype or single cards.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use a cube" }));
    expect(screen.getByRole("region", { name: "Pool status" })).toHaveTextContent("1 card added");
  });
});

describe("CreateDraftForm rail", () => {
  it("shows the pool, the pack numbers and no seat note until there are cards", async () => {
    stubFetch({ cubes: [] });
    render(<CreateDraftForm />);
    const rail = screen.getByRole("complementary", { name: /draft summary/i });
    await screen.findByText("Add a set, an archetype or single cards.");
    expect(rail).toHaveTextContent("Nothing yet");
    expect(rail).toHaveTextContent(/3 of 15/);
    expect(rail).toHaveTextContent(/45 s/);
    expect(rail).toHaveTextContent("Shuffled at the start");
    expect(within(rail).queryByText(/different cards/)).toBeNull();
    expect(screen.getByText(/the last 5 cards of pack 3 aren't picked/i)).toBeInTheDocument();
  });

  it("warns how many more different cards seating eight takes, and updates as the pack size changes", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    await pickGoat();
    const rail = screen.getByRole("complementary", { name: /draft summary/i });
    // 4 different cards, pack size 15: seats 0 players, 8 x 15 = 120 needed.
    expect(rail).toHaveTextContent("Only enough different cards for 0 players. Add 116 more different cards to seat 8.");
    fireEvent.change(screen.getByLabelText(/size of each pack/i), { target: { value: "5" } });
    expect(rail).toHaveTextContent("Only enough different cards for 0 players. Add 36 more different cards to seat 8.");
  });

  it("says when the different cards are enough", async () => {
    const many = Array.from({ length: 125 }, (_, i) => ({ id: 5000 + i, copies: 1 }));
    stubFetch({ cubes: [{ ...GOAT, mainCards: many }] });
    render(<CreateDraftForm />);
    fireEvent.click(await screen.findByRole("button", { name: /Goat cube/ }));
    const rail = screen.getByRole("complementary", { name: /draft summary/i });
    await waitFor(() => expect(rail).toHaveTextContent("Enough different cards for 8 players"));
  });
});

describe("CreateDraftForm basics", () => {
  it("rejects a pack size larger than cards per player", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    await pickGoat();
    fireEvent.change(screen.getByLabelText(/draft name/i), { target: { value: "Cube" } });
    fireEvent.change(screen.getByLabelText(/size of each pack/i), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
    expect(await screen.findByText(/pack size cannot exceed/i)).toBeInTheDocument();
  });

  it("shows the name problem at the top of the form and creates nothing", async () => {
    const stub = stubFetch();
    render(<CreateDraftForm />);
    await pickGoat();
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Draft name is required");
    expect(screen.getByLabelText(/draft name/i)).toHaveAttribute("aria-invalid", "true");
    expect(stub.find("/api/drafts", "POST")).toHaveLength(0);
  });

  it("keeps the section layout and the what-happens-next steps", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    await screen.findByRole("list", { name: "Cubes" });
    expect(screen.getByLabelText(/draft name/i)).toHaveAttribute("placeholder", "Friday cube night");
    expect(screen.getByLabelText(/draft name/i).closest("section")?.className).toMatch(/sec/);
    expect(screen.getByRole("list", { name: "What happens next" }).className).toMatch(/steps/);
    expect(screen.getByText("/draft join")).toHaveClass("cmd");
    expect(screen.getByRole("heading", { name: "Pool" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Packs" })).toBeInTheDocument();
  });
});

describe("pool list with a big pool", () => {
  it("renders only the visible rows for 200 different cards, and keeps searching and filtering", async () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({ id: 7000 + i, copies: i % 3 === 0 ? 3 : 2 }));
    stubFetch({ cubes: [{ ...GOAT, mainCards: entries }] });
    // The detail route answers cards for these ids; give each a name and a kind.
    const stub = vi.mocked(fetch);
    const original = stub.getMockImplementation()!;
    stub.mockImplementation(async (input, init) => {
      if (String(input) === "/api/cubes/1") {
        return Response.json({
          pools: { main: entries.map((e) => ({ catalogCardId: e.id, maxCopies: e.copies })), extra: [] },
          cards: entries.map((e, i) => card(e.id, `Card ${String(i).padStart(3, "0")}`, i % 4 === 0 ? "Spell Card" : "Effect Monster")),
        });
      }
      return original(input, init);
    });
    render(<CreateDraftForm />);
    fireEvent.click(await screen.findByRole("button", { name: /Goat cube/ }));
    await screen.findByRole("region", { name: "Chosen cube" });
    fireEvent.click(screen.getByRole("button", { name: "Customize for this draft" }));

    const list = screen.getByRole("list", { name: "Pool cards" });
    expect(within(list).getAllByRole("listitem").length).toBeLessThan(40);
    expect(document.body).toHaveTextContent(/cards, 200 different/);

    fireEvent.change(screen.getByLabelText("Search the pool"), { target: { value: "card 15" } });
    const found = within(screen.getByRole("list", { name: "Pool cards" })).getAllByRole("listitem");
    expect(found).toHaveLength(10);

    fireEvent.change(screen.getByLabelText("Search the pool"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spells/ }));
    expect(within(screen.getByRole("list", { name: "Pool cards" })).getAllByRole("listitem")[0]).toHaveTextContent("Spell");
    expect(CATALOG.length).toBeGreaterThan(0);
  });
});

function deferred() {
  let release!: (res: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("CreateDraftForm pool: loading and slow answers", () => {
  it("disables Create draft and reads Loading while a picked cube is still opening", async () => {
    const slow = deferred();
    stubFetch({ extra: { "GET /api/cubes/1": () => slow.promise } });
    render(<CreateDraftForm />);
    fireEvent.click(await screen.findByRole("button", { name: /Goat cube/ }));

    const create = screen.getByRole("button", { name: /create draft/i });
    await waitFor(() => expect(create).toBeDisabled());
    expect(create).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("complementary", { name: /draft summary/i })).toHaveTextContent("Loading…");

    slow.release(
      Response.json({
        pools: { main: GOAT.mainCards.map((c) => ({ catalogCardId: c.id, maxCopies: c.copies })), extra: [] },
        cards: [],
      }),
    );
    await screen.findByRole("region", { name: "Chosen cube" });
    await waitFor(() => expect(screen.getByRole("button", { name: /create draft/i })).toBeEnabled());
  });

  it("keeps edits made while Save as new cube is pending and makes the new cube the base", async () => {
    const slow = deferred();
    stubFetch({ extra: { "POST /api/cubes": () => slow.promise } });
    render(<CreateDraftForm />);
    await openEditor();
    await addCardByName("cipher", "Cipher Soldier");
    fireEvent.click(screen.getByRole("button", { name: "Save as new cube" }));
    fireEvent.keyDown(screen.getByLabelText("Name for the new cube"), { key: "Enter" });

    await addCardByName("dragon egg", "Dragon Egg");
    slow.release(Response.json({ cube: { id: 77, name: "Goat cube 2" } }, { status: 201 }));

    expect(await screen.findByText("Saved to Goat cube 2")).toBeInTheDocument();
    // Cipher Soldier is in the new cube; Dragon Egg was added after the request left, so it is still an edit against it.
    const rail = screen.getByRole("complementary", { name: /draft summary/i });
    expect(rail).toHaveTextContent("Goat cube 2, edited");
    expect(rail).toHaveTextContent("11 cards");
    expect(screen.getByRole("complementary", { name: /draft summary/i })).toHaveTextContent("Goat cube 2, edited");
  });

  it("drops a set that answers after Reset", async () => {
    const slow = deferred();
    stubFetch({
      extra: {
        "POST /api/cards/resolve": (init) => {
          const body = JSON.parse(String(init?.body)) as { setNames?: string[]; fuzzyName?: string };
          if (body.setNames) return slow.promise;
          const q = String(body.fuzzyName).toLowerCase();
          return Response.json({ cards: CATALOG.filter((c) => c.name.toLowerCase().includes(q)), unknownIds: [] });
        },
      },
    });
    render(<CreateDraftForm />);
    await openEditor();
    await addCardByName("cipher", "Cipher Soldier");
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Metal Raiders" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    slow.release(Response.json({ cards: [{ ...CATALOG.find((c) => c.id === 106)!, qty: 1 }], unknownIds: [] }));
    await new Promise((r) => setTimeout(r, 20));
    const list = screen.getByRole("list", { name: "Pool cards" });
    expect(within(list).queryByText("Dragon Egg")).toBeNull();
    expect(within(list).queryByText("Cipher Soldier")).toBeNull();
    expect(screen.queryByRole("region", { name: "Pool status" })).toBeNull();
  });

  it("does not apply a replace answer to a cube the editor has since left", async () => {
    const slow = deferred();
    stubFetch({ extra: { "POST /api/cubes/1/cards": () => slow.promise } });
    render(<CreateDraftForm />);
    await openEditor();
    await addCardByName("cipher", "Cipher Soldier");
    fireEvent.click(screen.getByRole("button", { name: "Save changes to Goat cube" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    fireEvent.click(screen.getByRole("button", { name: "Change cube" }));
    fireEvent.click(await screen.findByRole("button", { name: /Despia cube/ }));
    await screen.findByRole("region", { name: "Chosen cube" });
    slow.release(Response.json({ ok: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Saved to Goat cube")).toBeNull();
    expect(screen.getByRole("region", { name: "Chosen cube" })).toHaveTextContent("Despia cube");
    expect(screen.queryByRole("region", { name: "Pool status" })).toBeNull();
  });

  it("searches sets on the server, not in the first 25", async () => {
    const stub = stubFetch({
      extra: {
        "GET /api/sets?q=raid": () => Response.json({ sets: [{ setName: "Metal Raiders", setCode: "MRD", cardCount: 2 }] }),
      },
    });
    render(<CreateDraftForm />);
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    fireEvent.change(await screen.findByLabelText("Search sets"), { target: { value: "raid" } });
    expect(await screen.findByRole("button", { name: "Add Metal Raiders" })).toBeInTheDocument();
    await waitFor(() => expect(stub.find("/api/sets?q=raid")).toHaveLength(1));
  });
});
