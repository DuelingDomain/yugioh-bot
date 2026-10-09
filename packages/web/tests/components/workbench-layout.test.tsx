// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateDraftForm } from "../../src/components/draft/create-draft-form";
import { installVirtualizerJsdomEnv } from "../helpers/virtualizer-jsdom";
import { stubFetch } from "../helpers/pool-fixtures";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

type Mode = "phone" | "mid" | "wide";

/** A window of the given layout: the phone and wide queries answer, the rest is false. */
function stubWindow(mode: Mode) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? mode === "phone" : query.includes("min-width") ? mode === "wide" : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }));
}

beforeEach(() => installVirtualizerJsdomEnv());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const root = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-mode]")!;
const rail = () => screen.getByLabelText(/Sources and card preview|Add cards/, { selector: "aside" });
const inspectorPane = () => screen.queryByRole("region", { name: "Card inspector" });
const tile = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name},`) });
const createButtons = () => screen.getAllByRole("button", { name: /create draft/i });

describe("Workbench layout", () => {
  describe("wide", () => {
    beforeEach(() => stubWindow("wide"));

    it("shows three panes and one Create button", () => {
      stubFetch();
      const { container } = render(<CreateDraftForm />);
      expect(root(container)).toHaveAttribute("data-mode", "wide");
      expect(rail()).not.toHaveAttribute("aria-hidden");
      expect(screen.getByRole("region", { name: "Draft pool" })).toBeVisible();
      expect(screen.getByRole("complementary", { name: "Draft rules and Create" })).toBeVisible();
      expect(createButtons()).toHaveLength(1);
      expect(screen.queryByRole("navigation", { name: "Workbench panes" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Add cards" })).toBeNull();
    });

    it("collapses the sources to a strip and brings them back", () => {
      stubFetch();
      const { container } = render(<CreateDraftForm />);
      fireEvent.click(screen.getByRole("button", { name: "Collapse sources" }));
      expect(root(container)).toHaveAttribute("data-sources", "off");
      fireEvent.click(screen.getByRole("button", { name: "Show sources" }));
      expect(root(container)).not.toHaveAttribute("data-sources");
      expect(screen.getByRole("button", { name: "Collapse sources" })).toBeInTheDocument();
    });

    it("keeps the card preview in the left column when the sources are collapsed", async () => {
      stubFetch();
      const { container } = render(<CreateDraftForm />);
      fireEvent.click(screen.getByRole("tab", { name: "Cubes" }));
      fireEvent.click(await screen.findByRole("button", { name: /Goat cube/ }));
      await screen.findByRole("region", { name: "Chosen cube" });
      // Open, the preview is the Card view of the sources column.
      expect(screen.getByRole("tablist", { name: "Left panel" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Collapse sources" }));
      expect(root(container)).toHaveAttribute("data-sources", "off");
      expect(inspectorPane()).toBeVisible();
      expect(screen.queryByRole("tablist", { name: "Left panel" })).toBeNull();
      fireEvent.focus(await screen.findByRole("button", { name: /^Alpha Beast,/ }));
      expect(within(inspectorPane()!).getByRole("heading", { name: "Alpha Beast" })).toBeInTheDocument();
      // One inspector at a time.
      expect(screen.getAllByRole("region", { name: "Card inspector", hidden: true })).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: "Show sources" }));
      expect(root(container)).not.toHaveAttribute("data-sources");
      expect(screen.getByRole("tablist", { name: "Left panel" })).toBeInTheDocument();
      expect(screen.getAllByRole("region", { name: "Card inspector", hidden: true })).toHaveLength(1);
    });

    it("collapses the rules to a strip that keeps one Create button", () => {
      stubFetch();
      const { container } = render(<CreateDraftForm />);
      fireEvent.click(screen.getByRole("button", { name: "Collapse rules" }));
      expect(root(container)).toHaveAttribute("data-rules", "off");
      expect(screen.queryByLabelText("Players")).toBeNull();
      expect(createButtons()).toHaveLength(1);
      expect(screen.getByRole("img", { name: "Needs a change" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Show rules" }));
      expect(screen.getByLabelText("Players")).toBeInTheDocument();
    });
  });

  describe("mid", () => {
    beforeEach(() => stubWindow("mid"));

    it("puts the sources in a closed drawer, opened by Add cards and closed by Close", () => {
      stubFetch();
      const { container } = render(<CreateDraftForm />);
      expect(root(container)).toHaveAttribute("data-mode", "mid");
      expect(rail()).toHaveAttribute("aria-hidden", "true");
      expect(screen.queryByRole("button", { name: "Collapse sources" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Add cards" }));
      expect(rail()).not.toHaveAttribute("aria-hidden");
      fireEvent.click(within(rail()).getByRole("button", { name: "Close sources" }));
      expect(rail()).toHaveAttribute("aria-hidden", "true");
    });

    it("keeps the card preview in a left column, and shows the hovered card there", async () => {
      stubFetch();
      render(<CreateDraftForm />);
      const pane = inspectorPane();
      expect(pane).not.toBeNull();
      expect(pane).toBeVisible();
      // The drawer holds only the sources: no Sources / Card switch.
      expect(within(rail()).queryByRole("tablist", { name: "Left panel" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Add cards" }));
      fireEvent.click(within(rail()).getByRole("tab", { name: "Cubes" }));
      fireEvent.click(await screen.findByRole("button", { name: /Goat cube/ }));
      await screen.findByRole("region", { name: "Chosen cube" });
      fireEvent.click(within(rail()).getByRole("button", { name: "Close sources" }));
      fireEvent.focus(await screen.findByRole("button", { name: /^Alpha Beast,/ }));
      expect(within(inspectorPane()!).getByRole("heading", { name: "Alpha Beast" })).toBeInTheDocument();
      // The preview is a pane, not a sheet: no dialog opens for a pinned card.
      fireEvent.click(tile("Alpha Beast"));
      expect(within(inspectorPane()!).getByText("Pinned")).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Alpha Beast" })).toBeNull();
    });

    it("makes the drawer a modal dialog named like its button", () => {
      stubFetch();
      render(<CreateDraftForm />);
      const open = screen.getByRole("button", { name: "Add cards" });
      expect(open).toHaveAttribute("aria-haspopup", "dialog");
      expect(screen.queryByRole("dialog", { name: "Add cards" })).toBeNull();
      fireEvent.click(open);
      expect(screen.getByRole("dialog", { name: "Add cards" })).toHaveAttribute("aria-modal", "true");
    });

    it("opens the drawer from the empty pool's buttons", () => {
      stubFetch();
      render(<CreateDraftForm />);
      fireEvent.click(screen.getByRole("button", { name: "Add a card list" }));
      expect(rail()).not.toHaveAttribute("aria-hidden");
      expect(within(rail()).getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "true");
    });

    it("has one Create button", () => {
      stubFetch();
      render(<CreateDraftForm />);
      expect(createButtons()).toHaveLength(1);
    });
  });

  describe("phone", () => {
    beforeEach(() => stubWindow("phone"));

    const tabs = () => screen.getByRole("navigation", { name: "Workbench panes" });
    const tabButton = (name: RegExp) => within(tabs()).getByRole("button", { name });

    it("shows one pane at a time, starting on the pool", () => {
      stubFetch();
      const { container } = render(<CreateDraftForm />);
      expect(root(container)).toHaveAttribute("data-mode", "phone");
      expect(screen.getByRole("region", { name: "Draft pool" })).toBeVisible();
      expect(container.querySelector("aside[aria-label=\"Draft rules and Create\"]")).not.toBeVisible();
      expect(tabButton(/Pool/)).toHaveAttribute("aria-current", "page");

      fireEvent.click(tabButton(/Rules/));
      expect(screen.getByLabelText("Players")).toBeVisible();
      expect(container.querySelector("section[aria-label=\"Draft pool\"]")).not.toBeVisible();

      fireEvent.click(tabButton(/Sources/));
      expect(rail()).toBeVisible();
    });

    it("has no preview column: a pinned card opens the card sheet", async () => {
      stubFetch();
      render(<CreateDraftForm />);
      expect(inspectorPane()).toBeNull();
      fireEvent.click(tabButton(/Sources/));
      fireEvent.click(within(rail()).getByRole("tab", { name: "Cubes" }));
      fireEvent.click(await screen.findByRole("button", { name: /Goat cube/ }));
      await screen.findByRole("region", { name: "Chosen cube" });
      fireEvent.click(tabButton(/Pool/));
      fireEvent.click(await screen.findByRole("button", { name: /^Alpha Beast,/ }));
      expect(screen.getByRole("dialog", { name: "Alpha Beast" })).toHaveAttribute("aria-modal", "true");
    });

    it("keeps one sticky Create button with the summary, on every tab", () => {
      stubFetch();
      render(<CreateDraftForm />);
      for (const name of [/Sources/, /Pool/, /Rules/]) {
        fireEvent.click(tabButton(name));
        expect(createButtons()).toHaveLength(1);
      }
      expect(createButtons()[0]).toBeDisabled();
      expect(screen.getAllByText("Add cards to the pool").length).toBeGreaterThan(0);
    });

    it("counts the pool on the Pool tab", async () => {
      stubFetch();
      render(<CreateDraftForm />);
      fireEvent.click(tabButton(/Sources/));
      fireEvent.click(within(rail()).getByRole("tab", { name: "Cubes" }));
      fireEvent.click(await screen.findByRole("button", { name: /Goat cube/ }));
      await screen.findByRole("region", { name: "Chosen cube" });
      // 9 Main copies and 18 Extra copies.
      expect(await within(tabs()).findByText("27")).toBeInTheDocument();
    });

    it("shows a create error on the Rules tab and in the dock", async () => {
      const fetch = stubFetch({ extra: { "POST /api/drafts": () => Response.json({ error: "Name is taken" }, { status: 409 }) } });
      render(<CreateDraftForm />);
      fireEvent.click(tabButton(/Sources/));
      fireEvent.click(within(rail()).getByRole("tab", { name: "List" }));
      const box = await screen.findByLabelText("Card list");
      fireEvent.paste(box, { clipboardData: { getData: () => "99 Dragon Egg" } });
      await screen.findByText(/^Pasted list - 99 cards/);
      fireEvent.click(tabButton(/Rules/));
      fireEvent.change(screen.getByLabelText("Players"), { target: { value: "2" } });
      fireEvent.change(screen.getByLabelText("Main Deck cards each"), { target: { value: "40" } });
      fireEvent.change(screen.getByLabelText("Cards per pile"), { target: { value: "20" } });
      expect(createButtons()[0]).toBeEnabled();
      fireEvent.click(createButtons()[0]);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Name is taken");
      expect(alert).toBeVisible();
      expect(alert.parentElement).toContainElement(createButtons()[0]);
      expect(fetch.find("/api/drafts", "POST")).toHaveLength(1);
      expect(push).not.toHaveBeenCalled();
      expect(tabButton(/Rules/)).toHaveAttribute("aria-current", "page");
    });
  });
});

describe("Workbench shortcuts", () => {
  beforeEach(() => stubWindow("wide"));

  const key = (init: KeyboardEventInit, target: Element | Document = document.body) => {
    const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    act(() => {
      target.dispatchEvent(e);
    });
    return e;
  };

  it("opens the keyboard help with ? and from its button, and Esc closes it", () => {
    stubFetch();
    render(<CreateDraftForm />);
    key({ key: "?", shiftKey: true });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("button", { name: "Got it" })).toHaveFocus();
    key({ key: "Escape" }, within(dialog).getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Keyboard shortcuts" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("toggles the sources with [ and the rules with ]", () => {
    stubFetch();
    const { container } = render(<CreateDraftForm />);
    key({ key: "[" });
    expect(root(container)).toHaveAttribute("data-sources", "off");
    key({ key: "[" });
    expect(root(container)).not.toHaveAttribute("data-sources");
    key({ key: "]" });
    expect(root(container)).toHaveAttribute("data-rules", "off");
    key({ key: "]" });
    expect(root(container)).not.toHaveAttribute("data-rules");
  });

  it("ignores letters and brackets while the cursor is in a field", () => {
    stubFetch();
    const { container } = render(<CreateDraftForm />);
    const players = screen.getByLabelText("Players");
    key({ key: "[" }, players);
    key({ key: "?" }, players);
    expect(root(container)).not.toHaveAttribute("data-sources");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores shortcuts with Ctrl, Alt or Meta held, and while the help is open", () => {
    stubFetch();
    const { container } = render(<CreateDraftForm />);
    key({ key: "[", ctrlKey: true });
    key({ key: "[", metaKey: true });
    key({ key: "[", altKey: true });
    expect(root(container)).not.toHaveAttribute("data-sources");

    key({ key: "?", shiftKey: true });
    key({ key: "]" });
    expect(root(container)).not.toHaveAttribute("data-rules");
  });

  it("focuses the card search with /", async () => {
    stubFetch();
    render(<CreateDraftForm />);
    fireEvent.click(screen.getByRole("tab", { name: "List" }));
    key({ key: "/" });
    expect(await screen.findByLabelText("Search cards by name")).toHaveFocus();
  });

  it("does not create on Ctrl+Enter while the help is open", async () => {
    const stub = stubFetch();
    render(<CreateDraftForm />);
    fireEvent.click(screen.getByRole("tab", { name: "List" }));
    const box = await screen.findByLabelText("Card list");
    fireEvent.paste(box, { clipboardData: { getData: () => "99 Dragon Egg" } });
    await screen.findByText(/^Pasted list - 99 cards/);
    fireEvent.change(screen.getByLabelText("Players"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Rounds"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Cards per pile"), { target: { value: "20" } });
    key({ key: "?", shiftKey: true });
    key({ key: "Enter", ctrlKey: true });
    expect(stub.find("/api/drafts", "POST")).toHaveLength(0);
  });
});
