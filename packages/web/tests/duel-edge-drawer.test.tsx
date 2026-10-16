// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EdgeDrawer, EdgeTab, anyEdgeDrawerOpen, formatTabCount, useExclusiveDrawers } from "@/components/duel/edge-drawer";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const tab = (name = /log/i) => screen.getByRole("button", { name });

describe("formatTabCount", () => {
  it("shows 1 to 99, then 99+, and nothing for 0 or junk", () => {
    expect(formatTabCount(3)).toBe("3");
    expect(formatTabCount(120)).toBe("99+");
    expect(formatTabCount(0)).toBeNull();
    expect(formatTabCount(undefined)).toBeNull();
    expect(formatTabCount(Number.NaN)).toBeNull();
  });
});

describe("EdgeTab", () => {
  it("is a button with aria-expanded and glows only with attention", () => {
    const { rerender } = render(<EdgeTab side="right" label="Log" />);
    expect(tab()).toHaveAttribute("aria-expanded", "false");
    expect(tab()).toHaveAttribute("data-attention", "false");
    rerender(<EdgeTab side="right" label="Log" attention count={4} open />);
    expect(tab()).toHaveAttribute("data-attention", "true");
    expect(tab()).toHaveAttribute("aria-expanded", "true");
    expect(tab()).toHaveTextContent("4 new");
  });
  it("says 'new' for attention without a count", () => {
    render(<EdgeTab side="left" label="Master" attention tone="gold" />);
    expect(tab(/master/i)).toHaveTextContent("new");
    expect(tab(/master/i)).toHaveAttribute("data-tone", "gold");
  });
});

describe("EdgeDrawer", () => {
  it("is closed by default and the panel is inert", () => {
    render(<EdgeDrawer side="right" label="Log"><button>Entry</button></EdgeDrawer>);
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "closed");
    expect(dialog()).toHaveAttribute("inert");
    expect(tab()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens from the tab, moves focus in, and Escape closes and returns focus to the tab", () => {
    render(<EdgeDrawer side="right" label="Log"><button>Entry</button></EdgeDrawer>);
    fireEvent.click(tab(), { detail: 1 });
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "open");
    expect(dialog()).not.toHaveAttribute("inert");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Entry" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "closed");
    expect(document.activeElement).toBe(tab());
  });

  it("marks Escape as handled and reports an open drawer, so other Escape handlers step aside", () => {
    render(<EdgeDrawer side="right" label="Log"><p>x</p></EdgeDrawer>);
    expect(anyEdgeDrawerOpen()).toBe(false);
    fireEvent.click(tab(), { detail: 1 });
    expect(anyEdgeDrawerOpen()).toBe(true);
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => { document.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(anyEdgeDrawerOpen()).toBe(false);
  });

  it("toggles from the tab", () => {
    render(<EdgeDrawer side="left" label="Log"><p>x</p></EdgeDrawer>);
    fireEvent.click(tab(), { detail: 1 });
    fireEvent.click(tab(), { detail: 1 });
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "closed");
  });

  it("closes on a press outside, without moving focus back", () => {
    render(
      <div>
        <button>Field</button>
        <EdgeDrawer side="right" label="Log"><button>Entry</button></EdgeDrawer>
      </div>,
    );
    fireEvent.click(tab(), { detail: 1 });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Field" }));
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "closed");
    expect(document.activeElement).not.toBe(tab());
  });

  it("stays open on a press inside", () => {
    render(<EdgeDrawer side="right" label="Log"><button>Entry</button></EdgeDrawer>);
    fireEvent.click(tab(), { detail: 1 });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Entry" }));
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "open");
  });

  it("can ignore outside presses and Escape", () => {
    render(<EdgeDrawer side="right" label="Log" closeOnOutside={false} closeOnEscape={false}><p>x</p></EdgeDrawer>);
    fireEvent.click(tab(), { detail: 1 });
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "open");
  });

  it("traps Tab inside the open panel", () => {
    render(
      <EdgeDrawer side="right" label="Log"><button>One</button><button>Two</button></EdgeDrawer>,
    );
    fireEvent.click(tab(), { detail: 1 });
    const two = screen.getByRole("button", { name: "Two" });
    two.focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => { document.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "One" }));
  });

  it("opens on hover after a delay, closes on leave, and does not take focus", () => {
    render(<EdgeDrawer side="right" label="Log"><button>Entry</button></EdgeDrawer>);
    const slot = tab().parentElement!;
    fireEvent.pointerEnter(slot, { pointerType: "mouse" });
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "closed");
    act(() => { vi.advanceTimersByTime(150); });
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "open");
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Entry" }));
    fireEvent.pointerLeave(slot, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(300); });
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "closed");
  });

  it("does not close while the pointer moves from the tab onto the panel", () => {
    render(<EdgeDrawer side="right" label="Log"><button>Entry</button></EdgeDrawer>);
    const slot = tab().parentElement!;
    fireEvent.pointerEnter(slot, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(150); });
    fireEvent.pointerLeave(slot, { pointerType: "mouse" });
    fireEvent.pointerEnter(dialog(), { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "open");
  });

  it("a click on a hover-opened drawer pins it", () => {
    render(<EdgeDrawer side="right" label="Log"><button>Entry</button></EdgeDrawer>);
    const slot = tab().parentElement!;
    fireEvent.pointerEnter(slot, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(150); });
    fireEvent.click(tab(), { detail: 1 });
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "open");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Entry" }));
    fireEvent.pointerLeave(slot, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "open");
  });

  it("touch never hover-opens, and hoverOpen=false turns it off", () => {
    const { rerender } = render(<EdgeDrawer side="right" label="Log"><p>x</p></EdgeDrawer>);
    fireEvent.pointerEnter(tab().parentElement!, { pointerType: "touch" });
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "closed");
    rerender(<EdgeDrawer side="right" label="Log" hoverOpen={false}><p>x</p></EdgeDrawer>);
    fireEvent.pointerEnter(tab().parentElement!, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "closed");
  });

  it("toggles on its shortcut key, but not while typing or with a modifier", () => {
    render(
      <div>
        <input aria-label="chat" />
        <EdgeDrawer side="right" label="Log" shortcut="l"><p>x</p></EdgeDrawer>
      </div>,
    );
    const root = () => document.querySelector("[data-edge-drawer]");
    fireEvent.keyDown(screen.getByLabelText("chat"), { key: "l" });
    expect(root()).toHaveAttribute("data-state", "closed");
    fireEvent.keyDown(document.body, { key: "l", ctrlKey: true });
    expect(root()).toHaveAttribute("data-state", "closed");
    fireEvent.keyDown(document.body, { key: "L" });
    expect(root()).toHaveAttribute("data-state", "open");
    fireEvent.keyDown(document.body, { key: "l" });
    expect(root()).toHaveAttribute("data-state", "closed");
  });

  it("works controlled, and reports changes with how it happened", () => {
    const seen: Array<[boolean, string]> = [];
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <EdgeDrawer side="bottom" label="Log" open={open} onOpenChange={(next, via) => { seen.push([next, via]); setOpen(next); }}>
          <p>x</p>
        </EdgeDrawer>
      );
    }
    render(<Host />);
    fireEvent.click(tab(), { detail: 0 });
    expect(seen).toEqual([[true, "key"]]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(seen).toEqual([[true, "key"], [false, "key"]]);
  });

  it("a parent can open it (for example from a log entry) and focus moves in", () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>Show entry</button>
          <EdgeDrawer side="right" label="Log" open={open} onOpenChange={setOpen}><button>Detail</button></EdgeDrawer>
        </div>
      );
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Show entry" }));
    expect(document.querySelector("[data-edge-drawer]")).toHaveAttribute("data-state", "open");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Detail" }));
  });

  it("passes the size and tab offset to css", () => {
    render(<EdgeDrawer side="left" label="Log" size="300px" tabOffset="25%"><p>x</p></EdgeDrawer>);
    const root = document.querySelector<HTMLElement>("[data-edge-drawer]")!;
    expect(root.style.getPropertyValue("--bf-drawer-size")).toBe("300px");
    expect(root.style.getPropertyValue("--bf-tab-offset")).toBe("25%");
  });
});

describe("useExclusiveDrawers", () => {
  it("keeps one drawer open at a time", () => {
    function Host() {
      const drawers = useExclusiveDrawers<"log" | "chat">();
      return (
        <div>
          <EdgeDrawer side="right" label="Log" hoverOpen={false} {...drawers.bind("log")}><p>a</p></EdgeDrawer>
          <EdgeDrawer side="left" label="Chat" hoverOpen={false} {...drawers.bind("chat")}><p>b</p></EdgeDrawer>
        </div>
      );
    }
    render(<Host />);
    const state = (name: string) => document.querySelector(`[data-edge-drawer="${name}"]`)!.getAttribute("data-state");
    fireEvent.click(tab(/log/i), { detail: 1 });
    expect(state("Log")).toBe("open");
    fireEvent.click(tab(/chat/i), { detail: 1 });
    expect(state("Chat")).toBe("open");
    expect(state("Log")).toBe("closed");
  });
});
