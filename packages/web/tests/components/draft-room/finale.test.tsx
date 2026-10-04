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
      expect(screen.getByText("Create the tournament when you are ready. Saved draft decks are registered for it.")).toBeTruthy();
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

    it("shows a create error", async () => {
      render(<DraftFinale {...host} tournament={{ ...idle, error: "Draft must be completed" }} />);
      fireEvent.click(await screen.findByRole("button", { name: "Create tournament" }));
      expect(screen.getByRole("alert").textContent).toBe("Draft must be completed");
    });

    it("keeps focus on the submit button while creating and ignores a repeat submit", async () => {
      const create = vi.fn(async () => {});
      const setFormat = vi.fn();
      const { rerender } = render(<DraftFinale {...host} tournament={{ ...idle, create, setFormat }} />);
      fireEvent.click(await screen.findByRole("button", { name: "Create tournament" }));
      const submit = screen.getByRole("button", { name: "Create tournament" });
      submit.focus();
      fireEvent.click(submit);
      expect(create).toHaveBeenCalledTimes(1);

      rerender(<DraftFinale {...host} tournament={{ ...idle, create, setFormat, creating: true }} />);
      const busy = screen.getByRole("button", { name: "Creating…" });
      expect(busy).toBe(submit);
      expect((busy as HTMLButtonElement).disabled).toBe(false);
      expect(busy.getAttribute("aria-disabled")).toBe("true");
      expect(busy.getAttribute("aria-busy")).toBe("true");
      expect(document.activeElement).toBe(busy);

      fireEvent.click(busy);
      fireEvent.submit(screen.getByRole("form", { name: "Create tournament" }));
      fireEvent.change(screen.getByRole("combobox", { name: "Format" }), { target: { value: "single_elim" } });
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(create).toHaveBeenCalledTimes(1);
      expect(setFormat).not.toHaveBeenCalled();
      expect(screen.getByRole("form", { name: "Create tournament" })).toBeTruthy();
      expect(screen.getByRole("combobox", { name: "Format" }).getAttribute("aria-disabled")).toBe("true");
      expect(document.activeElement).toBe(busy);
    });

    it("moves focus to Go to tournament after the host creates the tournament", async () => {
      const { rerender } = render(<DraftFinale {...host} />);
      fireEvent.click(await screen.findByRole("button", { name: "Create tournament" }));
      const submit = screen.getByRole("button", { name: "Create tournament" });
      submit.focus();
      fireEvent.click(submit);
      rerender(<DraftFinale {...host} tournament={{ ...idle, creating: true }} />);
      rerender(<DraftFinale {...host} tournament={{ ...idle, linked: { name: "Cup", webSlug: "cup" } }} />);

      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("link", { name: "Go to tournament" })));
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

  describe("a live update makes the tournament", () => {
    const made = { ...idle, linked: { name: "Cup", webSlug: "cup" } };

    it("changes the non-host finale to Go to tournament without moving focus", async () => {
      const { rerender } = render(<DraftFinale {...props} />);
      const deck = await screen.findByRole("link", { name: "View your deck" });
      await waitFor(() => expect(document.activeElement).toBe(deck));
      const status = screen.getByText("The host or a server admin will start the tournament.");
      expect(status.getAttribute("aria-live")).toBe("polite");

      rerender(<DraftFinale {...props} tournament={made} />);

      const go = screen.getByRole("link", { name: "Go to tournament" });
      expect(go.getAttribute("href")).toBe("/tournament/cup");
      expect(document.activeElement).toBe(deck);
      expect(document.activeElement).not.toBe(go);
      // The same status element changes text, so the polite live region announces it.
      expect(status.isConnected).toBe(true);
      expect(status.textContent).toBe("The tournament is ready. Saved draft decks are registered for it.");
    });

    it("leaves focus alone for a host who is not on the Create tournament button", async () => {
      const host = { ...props, canCreateTournament: true };
      const { rerender } = render(<DraftFinale {...host} />);
      const create = await screen.findByRole("button", { name: "Create tournament" });
      const close = screen.getByRole("button", { name: "Close" });
      close.focus();

      rerender(<DraftFinale {...host} tournament={made} />);

      expect(screen.getByRole("link", { name: "Go to tournament" })).toBeTruthy();
      expect(create.isConnected).toBe(false);
      expect(document.activeElement).toBe(close);
    });

    it("moves focus to Go to tournament when it replaces the button the host was on", async () => {
      const host = { ...props, canCreateTournament: true };
      const { rerender } = render(<DraftFinale {...host} />);
      const create = await screen.findByRole("button", { name: "Create tournament" });
      await waitFor(() => expect(document.activeElement).toBe(create));

      rerender(<DraftFinale {...host} tournament={made} />);

      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("link", { name: "Go to tournament" })));
    });
  });

  describe("a tournament already exists", () => {
    it.each([true, false])("links to it with canCreateTournament=%s and offers no create button", async (canCreateTournament) => {
      render(<DraftFinale {...props} canCreateTournament={canCreateTournament} tournament={{ ...idle, linked: { name: "Cup", webSlug: "cup" } }} />);
      const go = await screen.findByRole("link", { name: "Go to tournament" });

      expect(go.getAttribute("href")).toBe("/tournament/cup");
      await waitFor(() => expect(document.activeElement).toBe(go));
      expect(screen.queryByRole("button", { name: "Create tournament" })).toBeNull();
      expect(screen.getByText("The tournament is ready. Saved draft decks are registered for it.")).toBeTruthy();
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
      expect(screen.getByText("The host or a server admin will start the tournament.")).toBeTruthy();
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
