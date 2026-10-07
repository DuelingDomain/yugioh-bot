// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PoolBrowser, type PoolBrowserProps } from "../../src/components/draft/setup/pool-browser";
import { CardInspector } from "../../src/components/draft/setup/card-inspector";
import { useCardInspector, type InspectorMode } from "../../src/components/draft/setup/use-card-inspector";
import type { PoolCard } from "../../src/components/draft/setup/pool-browser-model";
import { installVirtualizerJsdomEnv } from "../helpers/virtualizer-jsdom";

const CARDS: Record<number, PoolCard> = {
  1: { id: 1, name: "Dark Magician", type: "Normal Monster", frameType: "normal", attribute: "DARK", level: 7, atk: 2500, def: 2100, effectText: "The ultimate wizard.\n[ Monster Effect ]\nDraw 1 card." },
  2: { id: 2, name: "Sangan", type: "Effect Monster", frameType: "effect", level: 3, atk: 1000, def: 600 },
  3: { id: 3, name: "Pot of Greed", type: "Spell Card", frameType: "spell" },
  4: { id: 4, name: "Mirror Force", type: "Trap Card", frameType: "trap" },
  5: { id: 5, name: "Stardust Dragon", type: "Synchro Monster", frameType: "synchro", level: 8, atk: 2500, def: 2000 },
};
const getCard = (id: number) => CARDS[id] ?? { id, name: `Filler ${id}`, type: "Effect Monster", frameType: "effect", level: 4, atk: 1000, def: 1000 };

interface HarnessProps extends Partial<PoolBrowserProps> {
  startMain?: Array<[number, number]>;
  startExtra?: Array<[number, number]>;
  editable?: boolean;
  mode?: InspectorMode;
}

function Harness({ startMain, startExtra, editable = true, mode = "pane", ...rest }: HarnessProps) {
  const [main, setMain] = React.useState(() => new Map(startMain ?? [[1, 3], [2, 1], [3, 2], [4, 1]]));
  const [extra, setExtra] = React.useState(() => new Map(startExtra ?? [[5, 1]]));
  const actions = editable
    ? {
        onStep: (id: number, delta: number, lane: "main" | "extra") => {
          const set = lane === "main" ? setMain : setExtra;
          set((prev) => {
            const next = new Map(prev);
            const n = (next.get(id) ?? 0) + delta;
            if (n <= 0) next.delete(id);
            else next.set(id, n);
            return next;
          });
        },
      }
    : undefined;
  const inspector = useCardInspector({ main, extra, getCard, actions, mode });
  return (
    <div>
      <CardInspector controller={inspector} />
      <PoolBrowser main={main} extra={extra} getCard={getCard} inspector={inspector} height={600} {...rest} />
    </div>
  );
}

const tile = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name},`) });

describe("PoolBrowser and CardInspector", () => {
  beforeEach(() => installVirtualizerJsdomEnv({ width: 1200, height: 600 }));
  afterEach(() => cleanup());

  it("shows the counts, groups and copies of the Main lane", () => {
    render(<Harness />);
    expect(screen.getByText("8 cards · 5 unique")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Monsters/ })).toBeTruthy();
    expect(tile("Dark Magician").getAttribute("aria-label")).toBe("Dark Magician, 3 copies");
    expect(screen.queryByRole("button", { name: /^Stardust Dragon,/ })).toBeNull();
  });

  it("switches between Main, Extra and Split", () => {
    render(<Harness />);
    const lane = screen.getByRole("group", { name: "Pool lane" });
    fireEvent.click(within(lane).getByRole("button", { name: /Extra/ }));
    expect(tile("Stardust Dragon")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Dark Magician,/ })).toBeNull();
    fireEvent.click(within(lane).getByRole("button", { name: /Split/ }));
    expect(tile("Stardust Dragon")).toBeTruthy();
    expect(tile("Dark Magician")).toBeTruthy();
  });

  it("previews on focus, pins on click and unpins on Esc", () => {
    render(<Harness />);
    const inspector = screen.getByRole("region", { name: "Card inspector" });
    expect(within(inspector).getByText("No card chosen")).toBeTruthy();

    fireEvent.focus(tile("Dark Magician"));
    expect(within(inspector).getByRole("heading", { name: "Dark Magician" })).toBeTruthy();
    expect(within(inspector).getByText("Preview")).toBeTruthy();
    expect(within(inspector).getByText("Draw 1 card.")).toBeTruthy();
    expect(within(inspector).getByText("Monster Effect").tagName).toBe("H5");

    fireEvent.click(tile("Sangan"));
    expect(within(inspector).getByRole("heading", { name: "Sangan" })).toBeTruthy();
    expect(within(inspector).getByText("Pinned")).toBeTruthy();

    // A pin stays when the focus moves to another card and ends.
    fireEvent.blur(tile("Dark Magician"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(within(inspector).getByText("No card chosen")).toBeTruthy();
  });

  it("lets a parent skip its own Esc when the inspector used it", () => {
    render(<Harness />);
    fireEvent.click(tile("Sangan"));
    const seen: boolean[] = [];
    const spy = (e: KeyboardEvent) => seen.push(e.defaultPrevented);
    document.addEventListener("keydown", spy);
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", spy);
    expect(seen).toEqual([true, false]);
  });

  it("changes copies with the steppers and keys, and unpins a removed card", () => {
    render(<Harness />);
    const inspector = screen.getByRole("region", { name: "Card inspector" });
    fireEvent.click(screen.getByRole("button", { name: "One more Sangan" }));
    expect(tile("Sangan").getAttribute("aria-label")).toBe("Sangan, 2 copies");

    fireEvent.keyDown(tile("Sangan"), { key: "-" });
    fireEvent.keyDown(tile("Sangan"), { key: "-" });
    expect(screen.queryByRole("button", { name: /^Sangan,/ })).toBeNull();

    fireEvent.click(tile("Mirror Force"));
    expect(within(inspector).getByText("Pinned")).toBeTruthy();
    fireEvent.click(within(inspector).getByRole("button", { name: /Remove card/ }));
    expect(screen.queryByRole("button", { name: /^Mirror Force,/ })).toBeNull();
    expect(within(inspector).getByText("No card chosen")).toBeTruthy();
  });

  it("is read-only without edit callbacks", () => {
    render(<Harness editable={false} />);
    expect(screen.queryByRole("button", { name: /^One more/ })).toBeNull();
    fireEvent.keyDown(tile("Sangan"), { key: "+" });
    expect(tile("Sangan").getAttribute("aria-label")).toBe("Sangan, 1 copy");
    fireEvent.click(tile("Sangan"));
    const inspector = screen.getByRole("region", { name: "Card inspector" });
    expect(within(inspector).queryByRole("button", { name: /Remove card/ })).toBeNull();
    expect(within(inspector).queryByRole("button", { name: /^One more/ })).toBeNull();
  });

  it("filters by search and clears the filters", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Filter this pool"), { target: { value: "mirror" } });
    expect(tile("Mirror Force")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Sangan,/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter this pool"), { target: { value: "zzz" } });
    expect(screen.getByText(/No cards match/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(tile("Sangan")).toBeTruthy();
  });

  it("filters with a type chip and switches to the list layout", () => {
    render(<Harness />);
    const chips = screen.getByRole("group", { name: "Filter by type" });
    fireEvent.click(within(chips).getByRole("button", { name: /Spell/ }));
    expect(tile("Pot of Greed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Sangan,/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(tile("Pot of Greed")).toBeTruthy();
  });

  it("draws only the rows in view for a 500 card pool", () => {
    const big = Array.from({ length: 500 }, (_, i) => [1000 + i, 1] as [number, number]);
    render(<Harness startMain={big} startExtra={[]} />);
    const drawn = document.querySelectorAll("[data-card-id]").length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(150);
    expect(screen.getByText("500 cards · 500 unique")).toBeTruthy();
  });

  it("moves focus between cards with the arrow keys", () => {
    render(<Harness />);
    const first = tile("Dark Magician");
    first.focus();
    // Newest first: the Monsters row is Sangan, Dark Magician; then Pot of Greed; then Mirror Force.
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tile("Pot of Greed"));
    fireEvent.keyDown(tile("Pot of Greed"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tile("Dark Magician"));
    fireEvent.keyDown(tile("Dark Magician"), { key: "End" });
    expect(document.activeElement).toBe(tile("Mirror Force"));
    fireEvent.keyDown(tile("Mirror Force"), { key: "Home" });
    expect(document.activeElement).toBe(tile("Sangan"));
  });

  it("uses a bottom sheet on a phone: no preview, a dialog for the pinned card", () => {
    render(<Harness mode="sheet" />);
    fireEvent.focus(tile("Dark Magician"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(tile("Dark Magician"));
    const dialog = screen.getByRole("dialog", { name: "Dark Magician" });
    expect(within(dialog).getByText("Draw 1 card.")).toBeTruthy();
    expect(dialog.closest("body")).toBe(document.body);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the empty state when the pool has no cards", () => {
    render(<Harness startMain={[]} startExtra={[]} emptyState={<p>Import a pool</p>} />);
    expect(screen.getByText("Import a pool")).toBeTruthy();
  });
});
