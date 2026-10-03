// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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

function detail() {
  return { pools: { main: [...main], extra: [...extra] }, cards: CARDS };
}

beforeEach(() => {
  main = [];
  extra = [];
  posts = [];
  banlist = null;
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
        return {
          ok: true,
          json: async () => ({ cube: { id: 5, name: "Custom", archetype: null, banlist }, ...detail() }),
        } as Response;
      }
      return { ok: true, json: async () => ({ cards: [] }) } as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function open() {
  render(<CubeEditor cubeId={5} />);
  await screen.findByRole("heading", { name: "Custom" });
}

describe("CubeEditor", () => {
  it.each(["TCG", null])("wraps header facts with one dot each while saving (%s banlist)", async (currentBanlist) => {
    banlist = currentBanlist;
    main = [{ catalogCardId: 1, pool: "main", maxCopies: 2 }];
    extra = [{ catalogCardId: 2, pool: "extra", maxCopies: 1 }];
    await open();

    const header = screen.getByRole("heading", { name: "Custom" }).closest(".ce-head")!;
    const lines = header.querySelectorAll(".ce-meta");
    const expectedOrigin = currentBanlist ? ["Built by hand", "TCG banlist"] : ["Built by hand"];
    const expectFacts = (line: Element, expected: string[]) => {
      expect(line.children).toHaveLength(1);
      const items = Array.from(line.firstElementChild!.children);
      expect(items.map((item) => item.textContent)).toEqual(expected);
      expect(line.querySelectorAll(".dot")).toHaveLength(expected.length);
      for (const item of items) {
        expect(item.querySelectorAll(":scope > .dot")).toHaveLength(1);
        expect(item.querySelector(".dot")).toHaveAttribute("aria-hidden", "true");
      }
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

    it("steps copies with setMaxCopies and stops at 1 and 3", async () => {
      await open();
      fireEvent.click(screen.getByRole("button", { name: "Main A, 2 copies" }));
      fireEvent.click(screen.getByRole("button", { name: "One more copy" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "One more copy" })).toBeDisabled());
      expect(posts[0]).toEqual({ op: "setMaxCopies", catalogCardId: 1, maxCopies: 3 });

      fireEvent.click(screen.getByRole("button", { name: "One fewer copy" }));
      await waitFor(() => expect(posts).toHaveLength(2));
      fireEvent.click(await screen.findByRole("button", { name: "One fewer copy" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "One fewer copy" })).toBeDisabled());
      expect(posts.map((p) => p.maxCopies)).toEqual([3, 2, 1]);
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

    it("shows the Theme Draft check against 42 main and 17 extra", async () => {
      await open();
      expect(screen.getByRole("img", { name: "2 of 42 main copies" })).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "0 of 17 Extra copies" })).toBeInTheDocument();
      expect(screen.getByText(/40 main copies short/)).toBeInTheDocument();
    });
  });
});
