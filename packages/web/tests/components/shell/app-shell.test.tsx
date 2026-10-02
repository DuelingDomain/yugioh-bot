// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LinkStub, fontMock, stubFetch } from "./helpers";

vi.mock("next/font/google", () => fontMock());
vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));
vi.mock("next/link", () => ({ default: LinkStub }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

import { usePathname } from "next/navigation";
import { AppShell } from "../../../src/components/layout/app-shell";

const mockUsePathname = vi.mocked(usePathname);
const KEY = "yugidraft:sidebar-collapsed";

describe("AppShell bypass routes", () => {
  beforeEach(() => {
    stubFetch();
  });

  it.each(["/duels/abc", "/decks/new", "/decks/42"])("%s renders without the shell", (path) => {
    mockUsePathname.mockReturnValue(path);
    const { container } = render(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );
    expect(screen.getByText("page")).toBeTruthy();
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelector("header")).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps the exact main wrappers", () => {
    mockUsePathname.mockReturnValue("/duels/abc");
    const a = render(<AppShell><p>x</p></AppShell>);
    expect(a.container.firstElementChild?.className).toBe("min-h-screen bg-bg-deep p-4 text-text-primary sm:p-6 lg:p-8");
    a.unmount();
    mockUsePathname.mockReturnValue("/decks/new");
    const b = render(<AppShell><p>x</p></AppShell>);
    expect(b.container.firstElementChild?.className).toBe("min-h-screen bg-bg-deep text-text-primary");
  });

  it("/decks (the library) and /decks/draft/x keep the shell", () => {
    mockUsePathname.mockReturnValue("/decks");
    const { container } = render(<AppShell><p>x</p></AppShell>);
    expect(container.querySelector("aside")).not.toBeNull();
  });
});

describe("AppShell frame", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockUsePathname.mockReturnValue("/tournaments");
    stubFetch();
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders sidebar, phone top bar and page; the page is not inside .ms", () => {
    const { container } = render(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );
    expect(container.querySelector("header.ns-top")).not.toBeNull();
    expect(container.querySelector("aside.ns-side")).not.toBeNull();
    const main = container.querySelector("main") as HTMLElement;
    expect(main.closest(".ms")).toBeNull();
    expect(screen.getByText("page").closest(".ms")).toBeNull();
    expect(screen.getByText("Tournaments", { selector: ".ns-title" })).toBeTruthy();
  });

  it("falls back to YugiDraft for the phone title", () => {
    mockUsePathname.mockReturnValue("/nowhere");
    render(<AppShell><p>x</p></AppShell>);
    expect(screen.getByText("YugiDraft", { selector: ".ns-title" })).toBeTruthy();
  });

  it("restores the collapsed state from storage after mount", async () => {
    window.localStorage.setItem(KEY, "1");
    const { container } = render(<AppShell><p>x</p></AppShell>);
    await waitFor(() => expect(container.querySelector(".ns")).toHaveAttribute("data-c"));
    expect(container.firstElementChild).toHaveAttribute("data-sidebar-collapsed", "true");
  });

  it("remembers a toggle", async () => {
    const { container } = render(<AppShell><p>x</p></AppShell>);
    expect(container.querySelector(".ns")).not.toHaveAttribute("data-c");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(container.querySelector(".ns")).toHaveAttribute("data-c");
    expect(window.localStorage.getItem(KEY)).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(window.localStorage.getItem(KEY)).toBe("0");
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { container } = render(<AppShell><p>x</p></AppShell>);
    expect(container.querySelector(".ns")).not.toHaveAttribute("data-c");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(container.querySelector(".ns")).toHaveAttribute("data-c");
  });

  it("phone menu: opens as a dialog, page goes inert, Escape closes and focus returns", async () => {
    const { container } = render(<AppShell><p>x</p></AppShell>);
    const menuBtn = screen.getByRole("button", { name: "Open menu" });
    fireEvent.click(menuBtn);
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });
    expect(menuBtn).toHaveAttribute("aria-expanded", "true");
    expect((container.firstElementChild as HTMLElement & { inert: boolean }).inert).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close menu" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((container.firstElementChild as HTMLElement & { inert: boolean }).inert).toBe(false);
    expect(document.activeElement).toBe(menuBtn);
  });

  it("closes the phone menu when the window grows past phone width", async () => {
    const listeners: Array<() => void> = [];
    const mq = {
      matches: false,
      addEventListener: (_: string, cb: () => void) => {
        listeners.push(cb);
      },
      removeEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn().mockReturnValue(mq) as unknown as typeof window.matchMedia;
    render(<AppShell><p>x</p></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("dialog");
    mq.matches = true;
    listeners.forEach((cb) => cb());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("never shows a Sign in button, even when the session fails", async () => {
    stubFetch("fail");
    render(<AppShell><p>x</p></AppShell>);
    await waitFor(() => expect(screen.queryByLabelText("Loading your account")).toBeNull());
    expect(screen.queryByText(/sign in/i)).toBeNull();
  });
});
