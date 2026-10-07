// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LinkStub, ready, noProfile } from "./helpers";

vi.mock("next/link", () => ({ default: LinkStub }));
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@/lib/actions", () => ({ handleSignOut: signOut }));

import { AccountMenu } from "../../../src/components/layout/account-menu";

function open(account = ready, variant: "side" | "phone" = "side") {
  render(<AccountMenu account={account} pathname="/dashboard" variant={variant} />);
  const trigger = screen.getByRole("button", { name: /account menu, imran/i });
  fireEvent.click(trigger);
  return trigger;
}

/** The menu plays a 100ms exit: at once it is closed and inert, and a moment later it is gone. */
async function expectClosed() {
  const menu = screen.queryByRole("menu");
  if (menu) {
    expect(menu).toHaveAttribute("data-state", "closed");
    expect(menu).toHaveAttribute("inert");
  }
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
}

describe("AccountMenu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens as a menu with focus on the first item", () => {
    const trigger = open();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.getByRole("menu", { name: "Account" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Your profile" }));
    expect(screen.getByRole("menuitem", { name: "Your profile" })).toHaveAttribute("href", "/player/7");
  });

  it("arrow keys wrap, Home and End jump", () => {
    open();
    const menu = screen.getByRole("menu");
    const profile = screen.getByRole("menuitem", { name: "Your profile" });
    const out = screen.getByRole("menuitem", { name: "Sign out" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(out);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(profile);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(out);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(profile);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(out);
  });

  it("Escape closes and returns focus to the trigger", async () => {
    const trigger = open();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    // Focus and aria-expanded do not wait for the exit.
    expect(document.activeElement).toBe(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expectClosed();
  });

  it("stays mounted, closed and inert while it fades out, then unmounts", async () => {
    open();
    const menu = screen.getByRole("menu");
    expect(menu).toHaveAttribute("data-mo", "pop");
    expect(menu).toHaveAttribute("data-state", "open");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.getByRole("menu")).toBe(menu);
    expect(menu).toHaveAttribute("data-state", "closed");
    expect(menu).toHaveAttribute("inert");
    await waitFor(() => expect(menu.isConnected).toBe(false));
  });

  it("Tab closes the menu", async () => {
    const trigger = open();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(document.activeElement).toBe(trigger);
    await expectClosed();
  });

  it("a press outside closes it", async () => {
    open();
    fireEvent.mouseDown(document.body);
    await expectClosed();
  });

  it("Sign out returns to sign-in", async () => {
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledWith();
    await expectClosed();
  });

  it("without a profile, Your profile is disabled and explained", () => {
    open(noProfile);
    const item = screen.getByRole("menuitem", { name: "Your profile" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(screen.getByText(/you get a profile after your first match/i)).toBeTruthy();
  });

  it("phone variant is a ring button with the phone menu, and shows no tier line", () => {
    const trigger = open(ready, "phone");
    expect(screen.getByRole("menu")).toHaveAttribute("data-variant", "phone");
    expect(trigger).not.toHaveTextContent("Gold");
  });

  it("the side seat shows your name, tier and Elo, with no chevrons", () => {
    render(<AccountMenu account={ready} pathname="/dashboard" variant="side" />);
    const seat = screen.getByRole("button", { name: /account menu, imran/i });
    expect(seat).toHaveTextContent("Imran");
    expect(seat).toHaveTextContent("Gold");
    expect(seat).toHaveTextContent("1432");
    expect(seat.querySelector("svg.lucide-chevrons-up-down")).toBeNull();
  });

  it("the seat shows the name alone when the rating could not be read", () => {
    render(<AccountMenu account={{ ...ready, tier: null, elo: null }} pathname="/dashboard" variant="side" />);
    expect(screen.getByRole("button", { name: /account menu, imran/i }).textContent).not.toMatch(/\d{3,}/);
  });

  it("the rail seat is the ring alone", () => {
    render(<AccountMenu account={ready} pathname="/dashboard" variant="side" rail />);
    expect(screen.getByRole("button", { name: /account menu, imran/i })).not.toHaveTextContent("Gold");
  });
});
