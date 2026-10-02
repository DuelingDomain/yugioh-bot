// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LinkStub, fontMock, ready } from "./shell/helpers";

vi.mock("next/font/google", () => fontMock());
vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));
vi.mock("next/link", () => ({ default: LinkStub }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

import { usePathname } from "next/navigation";
import { MobileDrawer } from "../../src/components/layout/mobile-drawer";

const mockUsePathname = vi.mocked(usePathname);

describe("MobileDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePathname.mockReturnValue("/dashboard");
  });

  it("is not mounted while closed", () => {
    render(<MobileDrawer open={false} onClose={vi.fn()} account={ready} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("link", { name: /dashboard/i })).toBeNull();
  });

  it("is a modal dialog portalled to the body, with focus on Close", () => {
    const { container } = render(<MobileDrawer open={true} onClose={vi.fn()} account={ready} />);
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(container.contains(dialog)).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close menu" }));
  });

  it("closes from Close, the scrim and Escape", () => {
    const onClose = vi.fn();
    render(<MobileDrawer open={true} onClose={onClose} account={ready} />);
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    fireEvent.click(document.querySelector(".ns-scrim") as HTMLElement);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("closes when a page is picked", () => {
    const onClose = vi.fn();
    render(<MobileDrawer open={true} onClose={onClose} account={ready} />);
    fireEvent.click(screen.getByRole("link", { name: /tournaments/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps Tab inside: last wraps to first, Shift+Tab on first wraps to last", () => {
    render(<MobileDrawer open={true} onClose={vi.fn()} account={ready} />);
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close menu" });
    const accountBtn = screen.getByRole("button", { name: /account menu/i });
    accountBtn.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(accountBtn);
  });

  it("marks the current page", () => {
    mockUsePathname.mockReturnValue("/tournament/abc");
    render(<MobileDrawer open={true} onClose={vi.fn()} account={ready} />);
    const lit = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveAccessibleName("Tournaments");
    expect(screen.getByRole("navigation", { name: /mobile navigation/i })).toBeTruthy();
  });

  it("locks page scroll while open and releases it on close", () => {
    const { rerender } = render(<MobileDrawer open={true} onClose={vi.fn()} account={ready} />);
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<MobileDrawer open={false} onClose={vi.fn()} account={ready} />);
    expect(document.body.style.overflow).toBe("");
  });
});
