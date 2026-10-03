// @vitest-environment jsdom
import React, { type ComponentPropsWithRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftFinale, type FinaleProps } from "../../../src/components/draft/room/finale";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "--mock-font" });
  return {
    Newsreader: font,
    Oxanium: font,
    Sofia_Sans_Extra_Condensed: font,
    Sofia_Sans_Semi_Condensed: font,
  };
});
vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentPropsWithRef<"a">) => <a {...props}>{children}</a>,
}));

const props: FinaleProps = {
  slug: "finale-draft",
  pool: [],
  theme: false,
  extraCount: 0,
  canBuild: true,
  exporting: false,
  exportError: null,
  onExport: () => {},
  onClose: () => {},
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DraftFinale", () => {
  it.each([true, false])("focuses the first action after the portal mounts with canBuild=%s", async (canBuild) => {
    render(<DraftFinale {...props} canBuild={canBuild} />);
    const first = canBuild
      ? await screen.findByRole("link", { name: "Build your deck" })
      : await screen.findByRole("button", { name: "Export YDK" });

    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it("closes once on Escape on document and removes the listener on unmount", async () => {
    const onClose = vi.fn();
    const { unmount } = render(<DraftFinale {...props} onClose={onClose} />);
    await screen.findByRole("dialog", { name: "Draft complete" });
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes once on Escape inside the finale", async () => {
    const onClose = vi.fn();
    render(<DraftFinale {...props} onClose={onClose} />);
    const first = await screen.findByRole("link", { name: "Build your deck" });

    fireEvent.keyDown(first, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not move focus back to the first action when export state changes", async () => {
    const { rerender } = render(<DraftFinale {...props} />);
    const close = await screen.findByRole("button", { name: "Close" });
    close.focus();

    rerender(<DraftFinale {...props} exporting />);
    expect(document.activeElement).toBe(close);
  });
});
