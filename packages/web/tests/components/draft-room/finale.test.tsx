// @vitest-environment jsdom
import React, { type ComponentPropsWithRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftFinale, type FinaleProps } from "../../../src/components/draft/room/finale";
import type { DraftTournament } from "../../../src/components/draft/use-draft-tournament";

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

const idle: DraftTournament = {
  linked: null,
  format: "round_robin",
  setFormat: () => {},
  bestOf: 3,
  setBestOf: () => {},
  creating: false,
  error: null,
  create: async () => {},
};

const props: FinaleProps = {
  slug: "finale-draft",
  pool: [],
  theme: false,
  extraCount: 0,
  canCreateTournament: false,
  tournament: idle,
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
  describe("host without a tournament", () => {
    const host = { ...props, canCreateTournament: true };

    it("offers Create tournament as the focused primary action and no Build your deck", async () => {
      render(<DraftFinale {...host} />);
      const create = await screen.findByRole("button", { name: "Create tournament" });

      await waitFor(() => expect(document.activeElement).toBe(create));
      expect(screen.queryByText("Build your deck")).toBeNull();
      expect(screen.queryByText(/Your deck starts here/)).toBeNull();
      expect(screen.getByText("Every deck is saved. Create the tournament when you are ready.")).toBeTruthy();
      for (const name of ["Export YDK", "Close"]) expect(screen.getByRole("button", { name })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Back to drafts" }).getAttribute("href")).toBe("/drafts");
    });

    it("opens the format choice, focuses it and creates with the chosen settings", async () => {
      const create = vi.fn(async () => {});
      const setFormat = vi.fn();
      const setBestOf = vi.fn();
      render(<DraftFinale {...host} tournament={{ ...idle, create, setFormat, setBestOf }} />);
      fireEvent.click(await screen.findByRole("button", { name: "Create tournament" }));

      const format = screen.getByRole("combobox", { name: "Format" });
      await waitFor(() => expect(document.activeElement).toBe(format));
      expect(Array.from((format as HTMLSelectElement).options).map((o) => o.text)).toEqual(["Round robin", "Single elimination"]);

      fireEvent.change(format, { target: { value: "single_elim" } });
      fireEvent.change(screen.getByRole("combobox", { name: "Match length" }), { target: { value: "1" } });
      expect(setFormat).toHaveBeenCalledWith("single_elim");
      expect(setBestOf).toHaveBeenCalledWith(1);

      fireEvent.click(screen.getByRole("button", { name: "Create tournament" }));
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("goes back to the primary button when the format choice is cancelled", async () => {
      render(<DraftFinale {...host} />);
      fireEvent.click(await screen.findByRole("button", { name: "Create tournament" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      const create = screen.getByRole("button", { name: "Create tournament" });
      expect(screen.queryByRole("combobox", { name: "Format" })).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(create));
    });

    it("shows a create error and disables the form while creating", async () => {
      const { rerender } = render(<DraftFinale {...host} tournament={{ ...idle, error: "Draft must be completed" }} />);
      fireEvent.click(await screen.findByRole("button", { name: "Create tournament" }));
      expect(screen.getByRole("alert").textContent).toBe("Draft must be completed");

      rerender(<DraftFinale {...host} tournament={{ ...idle, creating: true }} />);
      expect((screen.getByRole("button", { name: "Creating…" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("combobox", { name: "Format" }) as HTMLSelectElement).disabled).toBe(true);
    });

    it("moves focus to Go to tournament once the tournament exists", async () => {
      const { rerender } = render(<DraftFinale {...host} />);
      fireEvent.click(await screen.findByRole("button", { name: "Create tournament" }));
      rerender(<DraftFinale {...host} tournament={{ ...idle, linked: { name: "Cup", webSlug: "cup" } }} />);

      const go = screen.getByRole("link", { name: "Go to tournament" });
      expect(go.getAttribute("href")).toBe("/tournament/cup");
      expect(screen.queryByRole("button", { name: "Create tournament" })).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(go));
    });
  });

  describe("a tournament already exists", () => {
    it.each([true, false])("links to it with canCreateTournament=%s and offers no create button", async (canCreateTournament) => {
      render(<DraftFinale {...props} canCreateTournament={canCreateTournament} tournament={{ ...idle, linked: { name: "Cup", webSlug: "cup" } }} />);
      const go = await screen.findByRole("link", { name: "Go to tournament" });

      expect(go.getAttribute("href")).toBe("/tournament/cup");
      await waitFor(() => expect(document.activeElement).toBe(go));
      expect(screen.queryByRole("button", { name: "Create tournament" })).toBeNull();
      expect(screen.getByText("The tournament is ready. Every deck is registered for it.")).toBeTruthy();
    });

    it("falls back to the tournament list when the slug is unknown", async () => {
      render(<DraftFinale {...props} tournament={{ ...idle, linked: { name: null, webSlug: null } }} />);
      expect((await screen.findByRole("link", { name: "Go to tournament" })).getAttribute("href")).toBe("/tournaments");
    });
  });

  describe("other players", () => {
    it("see no create button, only that the host starts the tournament and a link to their deck", async () => {
      render(<DraftFinale {...props} />);
      const deck = await screen.findByRole("link", { name: "View your deck" });

      expect(deck.getAttribute("href")).toBe("/decks/draft/finale-draft");
      await waitFor(() => expect(document.activeElement).toBe(deck));
      expect(screen.queryByRole("button", { name: "Create tournament" })).toBeNull();
      expect(screen.queryByText("Build your deck")).toBeNull();
      expect(screen.getByText("The host will start the tournament. Your deck is saved and will be registered for it.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Export YDK" })).toBeTruthy();
    });
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
    const first = await screen.findByRole("link", { name: "View your deck" });

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
