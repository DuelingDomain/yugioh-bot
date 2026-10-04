// @vitest-environment jsdom
import React from "react";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CubeEditor } from "@/components/cubes/cube-editor";
import styles from "@/components/cubes/cubes.module.css";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type Entry = { catalogCardId: number; pool: "main" | "extra"; maxCopies: number };

function card(id: number, name: string, type: string, frameType: string) {
  return { id, name, type, frameType, effectText: "", imageUrl: "i", imageUrlSmall: "i" };
}

const CARDS = [card(1, "Main A", "Normal Monster", "normal"), card(2, "Xyz B", "XYZ Monster", "xyz")];

let main: Entry[];
let extra: Entry[];
let posts: Array<Record<string, unknown>>;
let banlist: string | null;
let draftType: string | undefined;
let settings: Record<string, number>;
let puts: Array<Record<string, unknown>>;
let resolves: Array<Record<string, unknown>>;
/** When set, the next card search answers only after this promise settles. */
let resolveGate: Promise<void> | null;
/** When true, card searches answer 502 like an unreachable card database. */
let resolveFails: boolean;

function detail() {
  return { pools: { main: [...main], extra: [...extra] }, cards: CARDS };
}

beforeEach(() => {
  main = [];
  extra = [];
  posts = [];
  banlist = null;
  draftType = undefined;
  settings = {};
  puts = [];
  resolves = [];
  resolveGate = null;
  resolveFails = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/cubes/5/cards")) {
        const body = JSON.parse(String(init?.body)) as Record<string, any>;
        posts.push(body);
        if (body.op === "import") {
          main = [{ catalogCardId: 1, pool: "main", maxCopies: 1 }];
          extra = [{ catalogCardId: 2, pool: "extra", maxCopies: 1 }];
          return { ok: true, json: async () => ({ ...detail(), added: 2, unknown: [] }) } as Response;
        }
        if (body.op === "importYdk") {
          main = [{ catalogCardId: 1, pool: "main", maxCopies: 3 }];
          extra = [{ catalogCardId: 2, pool: "extra", maxCopies: 1 }];
          return {
            ok: true,
            json: async () => ({ ...detail(), added: 2, copies: 4, unknown: [777, 888] }),
          } as Response;
        }
        if (body.op === "setMaxCopies") {
          main = main.map((e) => (e.catalogCardId === body.catalogCardId ? { ...e, maxCopies: body.maxCopies } : e));
        } else if (body.op === "remove") {
          main = main.filter((e) => e.catalogCardId !== body.catalogCardId);
        } else if (body.op === "add") {
          main = [...main, { catalogCardId: body.catalogCardId, pool: "main", maxCopies: body.maxCopies ?? 3 }];
        }
        return { ok: true, json: async () => detail() } as Response;
      }
      if (url.endsWith("/api/cubes/5")) {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          puts.push(body);
          if (typeof body.draftType === "string") draftType = body.draftType;
          return { ok: true, json: async () => ({ ok: true }) } as Response;
        }
        return {
          ok: true,
          json: async () => ({ cube: { id: 5, name: "Custom", archetype: null, banlist, draftType, settings }, ...detail() }),
        } as Response;
      }
      if (url.endsWith("/api/cards/resolve")) {
        resolves.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (resolveGate) await resolveGate;
        if (resolveFails) return { ok: false, status: 502, json: async () => ({ error: "unavailable" }) } as Response;
        return { ok: true, json: async () => ({ cards: CARDS }) } as Response;
      }
      return { ok: true, json: async () => ({ cards: [] }) } as Response;
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function open() {
  render(<CubeEditor cubeId={5} />);
  await screen.findByRole("heading", { name: "Custom" });
}

describe("CubeEditor card name search", () => {
  it("lists matches for a typed name, asks for Extra Deck cards too, and Enter adds the top match", async () => {
    await open();
    const input = screen.getByLabelText("Card name");
    fireEvent.change(input, { target: { value: "xyz b" } });

    const list = await screen.findByRole("listbox", { name: "Results for xyz b" });
    const rows = within(list).getAllByRole("option");
    expect(rows.map((row) => row.querySelector(".n")?.textContent)).toEqual(["Main A", "Xyz B"]);
    // The row is the only control: no button sits inside an option.
    expect(within(list).queryAllByRole("button")).toHaveLength(0);
    expect(rows[1]).toHaveTextContent("XYZ Monster, Extra");
    expect(resolves.at(-1)).toEqual({ fuzzyName: "xyz b", includeExtra: true });
    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-activedescendant", rows[0].id);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(within(list).getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ op: "add", catalogCardId: 2, pool: "extra" });
  });

  it("says the search failed instead of no match and searches again on Try again", async () => {
    await open();
    resolveFails = true;
    const input = screen.getByLabelText("Card name");
    fireEvent.change(input, { target: { value: "xyz b" } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/did not work/i);
    expect(screen.queryByText("No cards match.")).toBeNull();
    expect(screen.queryByText("Searching...")).toBeNull();

    resolveFails = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByRole("listbox", { name: "Results for xyz b" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("adds a card with a click on its row", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Card name"), { target: { value: "xyz b" } });
    const list = await screen.findByRole("listbox", { name: "Results for xyz b" });
    fireEvent.click(within(list).getAllByRole("option")[0]);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ op: "add", catalogCardId: 1 });
  });

  it("does nothing on Enter while the results answer an older text, and ignores an IME Enter", async () => {
    await open();
    const input = screen.getByLabelText("Card name");
    fireEvent.change(input, { target: { value: "xyz b" } });
    const list = await screen.findByRole("listbox", { name: "Results for xyz b" });
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(false);

    let release!: () => void;
    resolveGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fireEvent.change(input, { target: { value: "xyz bb" } });
    await waitFor(() => expect(resolves.at(-1)).toEqual({ fuzzyName: "xyz bb", includeExtra: true }));
    expect(list).toHaveAttribute("data-stale");
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    expect(posts).toHaveLength(0);

    release();
    await waitFor(() => expect(screen.getByRole("listbox")).not.toHaveAttribute("data-stale"));
    expect(posts).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(posts).toHaveLength(1));
  });
});

describe("CubeEditor", () => {
  it.each(["TCG", null])("lists header facts as plain items while saving (%s banlist)", async (currentBanlist) => {
    banlist = currentBanlist;
    main = [{ catalogCardId: 1, pool: "main", maxCopies: 2 }];
    extra = [{ catalogCardId: 2, pool: "extra", maxCopies: 1 }];
    await open();

    expect(screen.getByRole("heading", { name: "Custom" })).toBeInTheDocument();
    const header = screen.getByRole("region", { name: "Cube summary" });
    const lines = [header.querySelector(`.${styles.facts}`)!, header.querySelector(`.${styles.counts}`)!];
    const expectedOrigin = currentBanlist ? ["Built by hand", "TCG banlist"] : ["Built by hand"];
    const expectFacts = (line: Element, expected: string[]) => {
      const items = Array.from(line.children);
      expect(items.map((item) => item.textContent)).toEqual(expected);
      expect(line.querySelector(".dot")).toBeNull();
      return items;
    };
    expectFacts(lines[0]!, expectedOrigin);
    expectFacts(lines[1]!, ["Main 1 card, 2 copies", "Extra 1 card, 1 copy"]);
    expect(Array.from(lines[1]!.querySelectorAll("b"), (count) => count.textContent)).toEqual(["1", "2", "1", "1"]);
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();

    let finishSave!: (response: Response) => void;
    const pendingSave = new Promise<Response>((resolve) => { finishSave = resolve; });
    const fetchCube = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) =>
      String(input).endsWith("/api/cubes/5/cards") ? pendingSave : fetchCube(input, init),
    );
    fireEvent.click(screen.getByRole("button", { name: "Main A, 2 copies" }));
    fireEvent.click(screen.getByRole("button", { name: "One more copy" }));

    await screen.findByText("Saving…");
    const savingItems = expectFacts(lines[0]!, [...expectedOrigin, "Saving…"]);
    expect(savingItems[savingItems.length - 1]).toHaveClass(styles.busy);

    main = [{ catalogCardId: 1, pool: "main", maxCopies: 3 }];
    finishSave(Response.json(detail()));
    await waitFor(() => expect(screen.queryByText("Saving…")).not.toBeInTheDocument());
    expectFacts(lines[0]!, expectedOrigin);
    expectFacts(lines[1]!, ["Main 1 card, 3 copies", "Extra 1 card, 1 copy"]);
  });

  it("imports passcodes and updates the pool counts", async () => {
    await open();

    fireEvent.click(screen.getByRole("button", { name: "Passcodes" }));
    fireEvent.change(screen.getByLabelText("Passcodes, one per line"), { target: { value: "1\n2" } });
    fireEvent.click(screen.getByRole("button", { name: /add passcodes/i }));

    expect(posts[0]).toMatchObject({ op: "import", codes: [1, 2] });
    await screen.findByText(/Added 2 cards/);
    expect(screen.getByRole("button", { name: /Main\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Extra\s*1/ })).toBeInTheDocument();
  });

  it("imports a YDK list from the YDK tab and reports cards, copies and unknown passcodes", async () => {
    await open();

    fireEvent.click(screen.getByRole("button", { name: "YDK" }));
    fireEvent.click(screen.getByRole("button", { name: "Add deck list" }));
    expect(posts).toEqual([]);
    expect(screen.getByText(/Load a \.ydk file or paste/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Deck list (.ydk)"), { target: { value: "#main\n1\n1\n1\n#extra\n2\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Add deck list" }));

    await screen.findByText(/Added 2 cards, 4 copies/);
    expect(posts[0]).toEqual({ op: "importYdk", text: "#main\n1\n1\n1\n#extra\n2\n" });
    expect(screen.getByText(/Not found/)).toHaveTextContent("777, 888");
    expect(screen.getByRole("button", { name: /Main\s*1/ })).toBeInTheDocument();
  });

  it("loads a .ydk file into the YDK box", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "YDK" }));
    const file = new File(["#main\n1\n"], "deck.ydk", { type: "" });
    fireEvent.change(screen.getByLabelText("Upload YDK file"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText("Deck list (.ydk)")).toHaveValue("#main\n1\n"));
  });

  it("offers the cube as a .ydk download", async () => {
    await open();
    const link = screen.getByRole("link", { name: /Export YDK/ });
    expect(link).toHaveAttribute("href", "/api/cubes/5/ydk");
    expect(link).toHaveAttribute("download");
  });

  describe("with a card in the cube", () => {
    beforeEach(() => {
      main = [{ catalogCardId: 1, pool: "main", maxCopies: 2 }];
    });

    it("selects on click and does not remove", async () => {
      await open();
      const tile = screen.getByRole("button", { name: "Main A, 2 copies" });
      fireEvent.click(tile);
      expect(tile).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("heading", { name: "Selected" })).toBeInTheDocument();
      expect(posts).toHaveLength(0);
    });

    it("steps copies with setMaxCopies, past three, and stops at 1", async () => {
      await open();
      fireEvent.click(screen.getByRole("button", { name: "Main A, 2 copies" }));
      fireEvent.click(screen.getByRole("button", { name: "One more copy" }));
      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]).toEqual({ op: "setMaxCopies", catalogCardId: 1, maxCopies: 3 });
      // Three is no ceiling: the plus button stays on.
      await waitFor(() => expect(screen.getByRole("button", { name: "One more copy" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "One more copy" }));
      await waitFor(() => expect(posts).toHaveLength(2));
      expect(posts[1]).toEqual({ op: "setMaxCopies", catalogCardId: 1, maxCopies: 4 });
    });

    it("stops at 1 copy and at 99 copies", async () => {
      main = [{ catalogCardId: 1, pool: "main", maxCopies: 1 }];
      await open();
      fireEvent.click(screen.getByRole("button", { name: "Main A, 1 copy" }));
      expect(screen.getByRole("button", { name: "One fewer copy" })).toBeDisabled();
      const input = screen.getByRole("spinbutton", { name: "Copies in the cube" });
      fireEvent.change(input, { target: { value: "99" } });
      fireEvent.blur(input);
      await waitFor(() => expect(posts).toHaveLength(1));
      await waitFor(() => expect(screen.getByRole("button", { name: "One more copy" })).toBeDisabled());
    });

    it("sets copies by typing a number and ignores a number outside 1 to 99", async () => {
      await open();
      fireEvent.click(screen.getByRole("button", { name: "Main A, 2 copies" }));
      const input = screen.getByRole("spinbutton", { name: "Copies in the cube" });
      fireEvent.change(input, { target: { value: "12" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]).toEqual({ op: "setMaxCopies", catalogCardId: 1, maxCopies: 12 });
      await waitFor(() => expect(screen.getByRole("spinbutton", { name: "Copies in the cube" })).toHaveValue(12));

      fireEvent.change(screen.getByRole("spinbutton", { name: "Copies in the cube" }), { target: { value: "100" } });
      fireEvent.blur(screen.getByRole("spinbutton", { name: "Copies in the cube" }));
      expect(posts).toHaveLength(1);
      expect(screen.getByRole("spinbutton", { name: "Copies in the cube" })).toHaveValue(12);
    });

    it("labels copies as copies in the cube, not a deck limit", async () => {
      await open();
      fireEvent.click(screen.getByRole("button", { name: "Main A, 2 copies" }));
      expect(screen.getByText(/not a deck limit/i)).toBeInTheDocument();
    });

    it("removes with the button, then Undo adds it back with the old copies", async () => {
      await open();
      fireEvent.click(screen.getByRole("button", { name: "Main A, 2 copies" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove from cube" }));

      const toast = await screen.findByText("Removed Main A (×2) from Main");
      expect(posts[0]).toEqual({ op: "remove", catalogCardId: 1 });

      fireEvent.click(within(toast.parentElement as HTMLElement).getByRole("button", { name: "Undo" }));
      await waitFor(() => expect(posts).toHaveLength(2));
      expect(posts[1]).toEqual({ op: "add", catalogCardId: 1, pool: "main", maxCopies: 2 });
      await screen.findByRole("button", { name: "Main A, 2 copies" });
    });

    it("keeps Undo available for ten seconds after a repeated removal with the same message", async () => {
      main = [{ catalogCardId: 1, pool: "main", maxCopies: 3 }];
      await open();
      vi.useFakeTimers();

      fireEvent.click(screen.getByRole("button", { name: "Main A, 3 copies" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Remove from cube" }));
      });
      expect(screen.getByText("Removed Main A (×3) from Main")).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(9000); });
      fireEvent.change(screen.getByLabelText("Card name"), { target: { value: "Main A" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });
      await act(async () => {
        fireEvent.click(screen.getByRole("option", { name: /Main A/ }));
      });
      fireEvent.click(screen.getByRole("button", { name: "Main A, 3 copies" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Remove from cube" }));
      });
      expect(screen.getByText("Removed Main A (×3) from Main")).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(9999); });
      expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
      act(() => { vi.advanceTimersByTime(1); });
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    });

    it("shows the theme draft check against 42 main and 17 extra for a theme cube", async () => {
      draftType = "theme";
      await open();
      expect(screen.getByRole("meter", { name: "2 of 42 main copies" })).toBeInTheDocument();
      expect(screen.getByRole("meter", { name: "0 of 17 Extra copies" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Theme draft check" })).toBeInTheDocument();
      expect(screen.getByText(/40 main copies short/)).toBeInTheDocument();
    });

    it("shows a compact check with no warning headline for an Any cube, the default", async () => {
      await open();
      expect(screen.getByRole("group", { name: "Cube type" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Any" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("heading", { name: "Cube check" })).toBeInTheDocument();
      expect(screen.getByText(/needs 40 more main copies/)).toBeInTheDocument();
      expect(screen.getByText(/needs 88 more copies/)).toBeInTheDocument();
      expect(screen.queryByText(/can.t start/)).not.toBeInTheDocument();
      expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    });

    it("shows the cube draft check for a Cube draft cube, from the saved pack settings", async () => {
      draftType = "booster";
      settings = { cardsPerPlayer: 45, packSize: 10 };
      await open();
      expect(screen.getByRole("heading", { name: "Cube draft check" })).toBeInTheDocument();
      expect(screen.getByText("45 cards each, 5 packs of 10")).toBeInTheDocument();
      expect(screen.getByRole("meter", { name: "2 of 45 cards one player can reach" })).toBeInTheDocument();
      expect(screen.getByRole("meter", { name: "2 of 100 copies for 2 players" })).toBeInTheDocument();
      expect(screen.getByText(/98 more copies needed/)).toBeInTheDocument();
      expect(screen.queryByText(/theme draft/i)).not.toBeInTheDocument();
    });

    it("saves a new cube type from the editor and swaps the check panel", async () => {
      await open();
      fireEvent.click(screen.getByRole("button", { name: "Theme cube" }));
      await screen.findByRole("heading", { name: "Theme draft check" });
      expect(puts).toEqual([{ draftType: "theme" }]);
      expect(screen.getByRole("button", { name: "Theme cube" })).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(screen.getByRole("button", { name: "Cube draft" }));
      await screen.findByRole("heading", { name: "Cube draft check" });
      expect(puts[1]).toEqual({ draftType: "booster" });
    });
  });
});
