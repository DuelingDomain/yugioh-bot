// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceRail, type SourceRailProps } from "../../src/components/draft/setup/source-rail";
import { useCardInspector, type InspectorMode } from "../../src/components/draft/setup/use-card-inspector";
import { usePoolEditor } from "../../src/components/draft/pool/use-pool-editor";
import { stubFetch } from "../helpers/pool-fixtures";

const DRAGON_EGG = 106;

interface HarnessProps extends Partial<SourceRailProps> {
  mode?: InspectorMode;
  /** Gives the rail a drawer that starts open or closed. */
  startOpen?: boolean;
}

/** The rail wired the way the Workbench page wires it, with a plain list of the pool and buttons that stand in for the pool browser. */
function Harness({ mode = "pane", startOpen, drawer: _drawer, ...rest }: HarnessProps) {
  const ctl = usePoolEditor({ variant: "create" });
  const actions = React.useMemo(
    () => ({
      onStep: (id: number, delta: number, lane: "main" | "extra") => ctl.step(id, delta, lane),
      onRemove: (id: number, lane: "main" | "extra") => {
        const copies = (lane === "main" ? ctl.pool : ctl.extra).get(id) ?? 0;
        ctl.step(id, -copies, lane);
      },
    }),
    [ctl],
  );
  const inspector = useCardInspector({ main: ctl.pool, extra: ctl.extra, getCard: ctl.info, actions, mode });
  const [open, setOpen] = React.useState(startOpen ?? false);
  const drawer = startOpen === undefined ? undefined : { open, onClose: () => setOpen(false) };
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open sources
      </button>
      <ul aria-label="Pool">
        {[...ctl.pool].map(([id, n]) => (
          <li key={id} data-testid={`main-${id}`}>
            {ctl.info(id)?.name ?? id}: {n}
          </li>
        ))}
        {[...ctl.extra].map(([id, n]) => (
          <li key={`x${id}`} data-testid={`extra-${id}`}>
            {ctl.info(id)?.name ?? id}: {n}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => ctl.step(DRAGON_EGG, -1, "main")}>
        Lower Dragon Egg
      </button>
      <button type="button" onClick={() => ctl.step(101, -1, "main")}>
        Lower Alpha Beast
      </button>
      <button type="button" onClick={() => inspector.pin(DRAGON_EGG)}>
        Pin Dragon Egg
      </button>
      <button type="button" onClick={() => inspector.preview(DRAGON_EGG)}>
        Preview Dragon Egg
      </button>
      <button type="button" onClick={() => inspector.endPreview(0)}>
        End preview
      </button>
      <SourceRail ctl={ctl} inspector={inspector} drawer={drawer} {...rest} />
    </div>
  );
}

const copies = (id: number, lane: "main" | "extra" = "main") => {
  const el = screen.queryByTestId(`${lane}-${id}`);
  return el ? Number(/: (\d+)$/.exec(el.textContent ?? "")?.[1]) : null;
};
const box = () => screen.getByLabelText("Card list") as HTMLTextAreaElement;
const paste = (text: string) => fireEvent.paste(box(), { clipboardData: { getData: () => text } });
const resolveBodies = (stub: ReturnType<typeof stubFetch>) => stub.find("/api/cards/resolve", "POST").map((c) => c.body as { listText?: string });
const listImports = (stub: ReturnType<typeof stubFetch>) => resolveBodies(stub).filter((b) => b.listText !== undefined);
const sourceTab = (name: string) => screen.getByRole("tab", { name });

/** Holds the list requests until `release` is called; the first `hold` of them wait. */
function holdLists(hold = 1) {
  const inner = globalThis.fetch;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const isList = String(input) === "/api/cards/resolve" && String(init?.body ?? "").includes("listText");
    if (isList && held++ < hold) return gate.then(() => inner(input, init));
    return inner(input, init);
  });
  return { release };
}

async function renderRail(props: HarnessProps = {}) {
  const stub = stubFetch();
  render(<Harness defaultTab="list" {...props} />);
  await screen.findByLabelText("Card list");
  return stub;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SourceRail: list imports keep their rules", () => {
  it("adds a paste at once and exactly once, and shows the ledger row", async () => {
    const stub = await renderRail();
    paste("3 Dragon Egg\nGlue");
    expect(await screen.findByText("Pasted list - 3 cards (3 Main, 0 Extra) - 1 line skipped")).toBeInTheDocument();
    expect(listImports(stub)).toHaveLength(1);
    expect(copies(DRAGON_EGG)).toBe(3);
    expect(box()).toHaveValue("");
    await new Promise((r) => setTimeout(r, 900));
    expect(listImports(stub)).toHaveLength(1);
  });

  it("adds a dropped list at once and exactly once, and keeps typed text", async () => {
    const stub = await renderRail();
    fireEvent.change(box(), { target: { value: "Cipher" } });
    fireEvent.drop(box(), { dataTransfer: { getData: () => "2 Dragon Egg" } });
    expect(await screen.findByText("Pasted list - 2 cards (2 Main, 0 Extra)")).toBeInTheDocument();
    expect(listImports(stub)).toHaveLength(1);
    expect(box()).toHaveValue("Cipher");
    expect(copies(DRAGON_EGG)).toBe(2);
  });

  it("adds a loaded file at once and names the entry after the file", async () => {
    const stub = await renderRail();
    const file = new File(["3 Dragon Egg\n"], "Flip.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Upload card list file"), { target: { files: [file] } });
    expect(await screen.findByText("Flip.txt - 3 cards (3 Main, 0 Extra)")).toBeInTheDocument();
    expect(listImports(stub)).toHaveLength(1);
    expect(copies(DRAGON_EGG)).toBe(3);
  });

  it("waits for Enter or Add when text is typed", async () => {
    const stub = await renderRail();
    fireEvent.change(box(), { target: { value: "2 Dragon Egg" } });
    await new Promise((r) => setTimeout(r, 1100));
    expect(listImports(stub)).toHaveLength(0);
    expect(copies(DRAGON_EGG)).toBeNull();

    expect(fireEvent.keyDown(box(), { key: "Enter", shiftKey: true })).toBe(true);
    expect(listImports(stub)).toHaveLength(0);

    fireEvent.keyDown(box(), { key: "Enter" });
    expect(await screen.findByText("Pasted list - 2 cards (2 Main, 0 Extra)")).toBeInTheDocument();
    expect(listImports(stub)).toHaveLength(1);

    fireEvent.change(box(), { target: { value: "1 Dragon Egg" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Pasted list 2 - 1 card (1 Main, 0 Extra)")).toBeInTheDocument();
    expect(listImports(stub)).toHaveLength(2);
    expect(copies(DRAGON_EGG)).toBe(3);
  });

  it("stacks imports, and Remove takes only what that import still adds after a manual reduction", async () => {
    await renderRail();
    paste("3 Dragon Egg");
    await screen.findByText("Pasted list - 3 cards (3 Main, 0 Extra)");
    paste("2 Dragon Egg");
    await screen.findByText("Pasted list 2 - 2 cards (2 Main, 0 Extra)");
    expect(copies(DRAGON_EGG)).toBe(5);

    fireEvent.click(screen.getByRole("button", { name: "Lower Dragon Egg" }));
    fireEvent.click(screen.getByRole("button", { name: "Lower Dragon Egg" }));
    expect(copies(DRAGON_EGG)).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: "Remove Pasted list 2" }));
    await waitFor(() => expect(screen.queryByText(/^Pasted list 2 - /)).toBeNull());
    expect(copies(DRAGON_EGG)).toBe(3);
    expect(screen.getByText("Pasted list - 3 cards (3 Main, 0 Extra)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Pasted list" }));
    await waitFor(() => expect(screen.queryByText(/^Pasted list - /)).toBeNull());
    expect(copies(DRAGON_EGG)).toBeNull();
  });

  it("shows the lookup-limited and moved-to-Main lines in the report", async () => {
    await renderRail();
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await inner(input, init);
      if (String(input) !== "/api/cards/resolve" || !String(init?.body ?? "").includes("listText")) return res;
      return Response.json({ ...(await res.json()), lookupLimited: true, movedToMain: 2 });
    });
    paste("3 Dragon Egg");
    await screen.findByText("Pasted list - 3 cards (3 Main, 0 Extra)");
    const report = screen.getByTestId("list-import-report");
    expect(within(report).getByText("Some cards were not looked up this time. Add the list again to look up the rest.")).toBeInTheDocument();
    expect(within(report).getByText("2 cards listed under Extra are not Extra Deck monsters - added to Main")).toBeInTheDocument();
  });

  it("drops a list that answers after another cube was picked", async () => {
    const stub = await renderRail();
    const { release } = holdLists();
    paste("3 Dragon Egg");
    expect(await screen.findByText("Adding the list.")).toBeInTheDocument();

    fireEvent.click(sourceTab("Cubes"));
    fireEvent.click(await screen.findByRole("button", { name: /Goat cube/ }));
    await screen.findByRole("region", { name: "Chosen cube" });
    expect(copies(101)).toBe(3);

    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(listImports(stub)).toHaveLength(1);
    expect(copies(DRAGON_EGG)).toBeNull();
    fireEvent.click(sourceTab("List"));
    expect(await screen.findByText("The pool changed while the list was loading. Add the list again.")).toBeInTheDocument();
    expect(screen.queryByText(/^Pasted list - /)).toBeNull();
    expect(copies(101)).toBe(3);
  });
});

describe("SourceRail: tabs", () => {
  it("keeps typed text and imports when the tab changes", async () => {
    await renderRail();
    paste("3 Dragon Egg");
    await screen.findByText("Pasted list - 3 cards (3 Main, 0 Extra)");
    fireEvent.change(box(), { target: { value: "half a li" } });

    fireEvent.click(sourceTab("Set"));
    expect(screen.getByLabelText("Card list", { selector: "textarea" })).not.toBeVisible();
    fireEvent.click(sourceTab("Cubes"));
    fireEvent.click(sourceTab("List"));

    expect(box()).toHaveValue("half a li");
    expect(box()).toBeVisible();
    expect(screen.getByText("Pasted list - 3 cards (3 Main, 0 Extra)")).toBeInTheDocument();
    expect(copies(DRAGON_EGG)).toBe(3);
  });

  it("starts on the Cards source and moves with the arrow keys, Home and End", async () => {
    stubFetch();
    const onTabChange = vi.fn();
    render(<Harness onTabChange={onTabChange} />);
    await screen.findByLabelText("Search cards by name");
    expect(sourceTab("Cards")).toHaveAttribute("aria-selected", "true");
    expect(sourceTab("Cards")).toHaveAttribute("tabindex", "0");
    expect(sourceTab("Set")).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(sourceTab("Cards"), { key: "ArrowRight" });
    expect(sourceTab("Archetype")).toHaveAttribute("aria-selected", "true");
    expect(sourceTab("Archetype")).toHaveFocus();
    fireEvent.keyDown(sourceTab("Archetype"), { key: "End" });
    expect(sourceTab("Cubes")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(sourceTab("Cubes"), { key: "ArrowRight" });
    expect(sourceTab("Cards")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(sourceTab("Cards"), { key: "ArrowLeft" });
    expect(sourceTab("Cubes")).toHaveAttribute("aria-selected", "true");
    expect(onTabChange).toHaveBeenLastCalledWith("cubes");
  });

  it("can be controlled from outside", async () => {
    stubFetch();
    const { rerender } = render(<Harness tab="set" />);
    expect(sourceTab("Set")).toHaveAttribute("aria-selected", "true");
    rerender(<Harness tab="cubes" />);
    expect(sourceTab("Cubes")).toHaveAttribute("aria-selected", "true");
  });

  it("adds a card by name from the Cards source", async () => {
    stubFetch();
    render(<Harness />);
    fireEvent.change(await screen.findByLabelText("Search cards by name"), { target: { value: "dragon egg" } });
    fireEvent.click(await screen.findByRole("option", { name: /^Dragon Egg/ }));
    expect(copies(DRAGON_EGG)).toBe(1);
  });

  it("starts from a saved cube, links to the editor and goes back to scratch", async () => {
    stubFetch();
    render(<Harness defaultTab="cubes" />);
    expect(screen.queryByRole("region", { name: "Chosen cube" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /Goat cube/ }));
    const region = await screen.findByRole("region", { name: "Chosen cube" });
    expect(within(region).getByText("Goat cube")).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: /Open in editor/ })).toHaveAttribute("href", "/cubes/1");
    expect(copies(101)).toBe(3);

    fireEvent.click(within(region).getByRole("button", { name: "Start from scratch instead" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Chosen cube" })).toBeNull());
  });

  it("warns that picking a cube replaces the cards of a scratch pool, and only then", async () => {
    stubFetch();
    render(<Harness defaultTab="list" />);
    await screen.findByLabelText("Card list");
    fireEvent.click(sourceTab("Cubes"));
    await screen.findByRole("button", { name: /Goat cube/ });
    expect(screen.queryByText(/replaces your/)).toBeNull();

    fireEvent.click(sourceTab("List"));
    paste("3 Dragon Egg");
    await screen.findByText("Pasted list - 3 cards (3 Main, 0 Extra)");
    fireEvent.click(sourceTab("Cubes"));
    expect(screen.getByText("Picking a cube replaces your 3 cards. Start from scratch brings them back.")).toBeInTheDocument();

    // The scratch cards are kept: going back to scratch shows them again, and the note is gone once a cube is open.
    fireEvent.click(screen.getByRole("button", { name: /Goat cube/ }));
    const region = await screen.findByRole("region", { name: "Chosen cube" });
    expect(screen.queryByText(/replaces your/)).toBeNull();
    expect(copies(DRAGON_EGG)).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "Start from scratch instead" }));
    await waitFor(() => expect(copies(DRAGON_EGG)).toBe(3));
  });

  it("shows the save actions for an edited cube, and hides them with cubeActions off", async () => {
    stubFetch();
    const first = render(<Harness defaultTab="cubes" />);
    fireEvent.click(await screen.findByRole("button", { name: /Goat cube/ }));
    await screen.findByRole("region", { name: "Chosen cube" });
    expect(screen.queryByRole("button", { name: "Save as new cube" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lower Alpha Beast" }));
    expect(await screen.findByRole("button", { name: "Save as new cube" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    first.unmount();

    render(<Harness defaultTab="cubes" cubeActions={false} />);
    fireEvent.click(await screen.findByRole("button", { name: /Goat cube/ }));
    await screen.findByRole("region", { name: "Chosen cube" });
    fireEvent.click(screen.getByRole("button", { name: "Lower Alpha Beast" }));
    expect(screen.queryByRole("button", { name: "Save as new cube" })).toBeNull();
  });
});

describe("SourceRail: Sources and Card", () => {
  const withEgg = async (props: HarnessProps = {}) => {
    const stub = await renderRail(props);
    paste("3 Dragon Egg");
    await screen.findByText("Pasted list - 3 cards (3 Main, 0 Extra)");
    return stub;
  };

  it("shows Sources first, with the Card tab and no pin dot", async () => {
    await renderRail();
    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Card" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByTestId("pinned-dot")).toBeNull();
    expect(screen.queryByRole("region", { name: "Card inspector" })).toBeNull();
  });

  it("switches to the card when it is pinned, and Remove card takes it out of the pool", async () => {
    await withEgg();
    fireEvent.click(screen.getByRole("button", { name: "Pin Dragon Egg" }));
    expect(screen.getByRole("tab", { name: "Card" })).toHaveAttribute("aria-selected", "true");
    const inspector = screen.getByRole("region", { name: "Card inspector" });
    expect(within(inspector).getByText("Dragon Egg")).toBeInTheDocument();
    expect(within(inspector).getByText("Copies in pool")).toBeInTheDocument();
    expect(box()).not.toBeVisible();

    fireEvent.click(within(inspector).getByRole("button", { name: "One more Dragon Egg" }));
    expect(copies(DRAGON_EGG)).toBe(4);
    fireEvent.click(within(inspector).getByRole("button", { name: "Remove card" }));
    expect(copies(DRAGON_EGG)).toBeNull();
  });

  it("goes back to Sources on Unpin and keeps the list text and imports", async () => {
    await withEgg();
    fireEvent.change(box(), { target: { value: "typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Pin Dragon Egg" }));
    fireEvent.click(screen.getByRole("button", { name: "Unpin" }));
    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");
    expect(box()).toBeVisible();
    expect(box()).toHaveValue("typed");
    expect(screen.getByText("Pasted list - 3 cards (3 Main, 0 Extra)")).toBeInTheDocument();
  });

  it("shows a dot on Card when a card is pinned while Sources is shown", async () => {
    await withEgg();
    fireEvent.click(screen.getByRole("button", { name: "Pin Dragon Egg" }));
    expect(screen.queryByTestId("pinned-dot")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Sources" }));
    const dot = screen.getByTestId("pinned-dot");
    expect(dot).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Card" })).toHaveAccessibleDescription("A card is pinned.");
    expect(box()).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Card" }));
    expect(screen.getByRole("region", { name: "Card inspector" })).toBeInTheDocument();
  });

  it("keeps Card when it was chosen by hand and the pin goes away", async () => {
    await withEgg();
    fireEvent.click(screen.getByRole("tab", { name: "Card" }));
    expect(within(screen.getByRole("region", { name: "Card inspector" })).getByText("No card chosen")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pin Dragon Egg" }));
    fireEvent.click(screen.getByRole("button", { name: "Unpin" }));
    expect(screen.getByRole("tab", { name: "Card" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("region", { name: "Card inspector" })).getByText("No card chosen")).toBeInTheDocument();
  });

  it("shows the previewed card while it is hovered and returns to Sources after", async () => {
    await withEgg();
    fireEvent.click(screen.getByRole("button", { name: "Preview Dragon Egg" }));
    expect(screen.getByRole("tab", { name: "Card" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("region", { name: "Card inspector" })).getByText("Dragon Egg")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End preview" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true"));
    expect(box()).toBeVisible();
  });

  it("has no switch on a phone: Sources stay, and a pinned card opens as a sheet", async () => {
    await withEgg({ mode: "sheet" });
    expect(screen.queryByRole("tab", { name: "Card" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Sources" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pin Dragon Egg" }));
    const sheet = await screen.findByRole("dialog", { name: "Dragon Egg" });
    expect(within(sheet).getByRole("button", { name: "Remove card" })).toBeInTheDocument();
    expect(box()).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Card inspector" })).toBeNull();
  });
});

describe("SourceRail: drawer", () => {
  it("is out of reach while closed, opens with focus inside and closes with the scrim", async () => {
    stubFetch();
    render(<Harness startOpen={false} />);
    const rail = screen.getByLabelText("Add cards", { selector: "aside" });
    expect(rail).toHaveAttribute("aria-hidden", "true");
    expect(rail).toHaveAttribute("inert");
    expect(screen.queryByRole("button", { name: "Close sources" })).toBeNull();

    const opener = screen.getByRole("button", { name: "Open sources" });
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(rail).not.toHaveAttribute("aria-hidden"));
    expect(rail).not.toHaveAttribute("inert");
    expect(rail.contains(document.activeElement)).toBe(true);

    const scrim = screen.getAllByRole("button", { name: "Close sources" }).find((b) => !rail.contains(b))!;
    fireEvent.click(scrim);
    expect(rail).toHaveAttribute("aria-hidden", "true");
    expect(opener).toHaveFocus();
  });

  it("closes with the Close button and with Esc, but not when the Esc was used to unpin", async () => {
    stubFetch();
    render(<Harness startOpen defaultTab="list" />);
    const rail = screen.getByLabelText("Add cards", { selector: "aside" });
    await screen.findByLabelText("Card list");
    paste("3 Dragon Egg");
    await screen.findByText("Pasted list - 3 cards (3 Main, 0 Extra)");

    fireEvent.click(screen.getByRole("button", { name: "Pin Dragon Egg" }));
    // The first Esc releases the pin; the drawer stays.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(rail).not.toHaveAttribute("aria-hidden");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(rail).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByRole("button", { name: "Open sources" }));
    expect(rail).not.toHaveAttribute("aria-hidden");
    // Esc while typing in the list box is left to the box.
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(rail).not.toHaveAttribute("aria-hidden");
    fireEvent.click(within(rail).getByRole("button", { name: "Close sources" }));
    expect(rail).toHaveAttribute("aria-hidden", "true");
    // The imports stay while the drawer is shut.
    expect(copies(DRAGON_EGG)).toBe(3);
  });

  it("is a modal dialog named Add cards while open, keeps Tab inside, and is a plain complementary region while closed", async () => {
    stubFetch();
    render(<Harness startOpen />);
    const rail = screen.getByRole("dialog", { name: "Add cards" });
    expect(rail).toHaveAttribute("aria-modal", "true");
    const close = within(rail).getByRole("button", { name: "Close sources" });
    close.focus();
    // Shift+Tab from the first control wraps to the last one inside the drawer.
    fireEvent.keyDown(within(rail).getAllByRole("tab", { selected: true })[0]!, { key: "Tab", shiftKey: true });
    expect(rail.contains(document.activeElement)).toBe(true);
    const last = Array.from(rail.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href]")).filter((el) => el.tabIndex >= 0 && !el.closest("[hidden]")).pop()!;
    last.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => {
      last.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(true);
    expect(rail.contains(document.activeElement)).toBe(true);

    fireEvent.click(within(rail).getByRole("button", { name: "Close sources" }));
    expect(screen.queryByRole("dialog", { name: "Add cards" })).toBeNull();
    expect(screen.getByLabelText("Add cards", { selector: "aside" })).not.toHaveAttribute("aria-modal");
  });

  it("drops the Sources / Card switch when the preview is shown elsewhere", () => {
    stubFetch();
    const { rerender } = render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Left panel" })).toBeInTheDocument();
    rerender(<Harness inspect={false} />);
    expect(screen.queryByRole("tablist", { name: "Left panel" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Sources" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Card inspector" })).toBeNull();
  });
});
