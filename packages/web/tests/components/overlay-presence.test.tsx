// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Modal } from "../../src/components/ui/modal";
import { Sheet } from "../../src/components/ui/sheet";
import { CubeBottomSheet, UndoToast } from "../../src/components/cubes/cube-sheet";
import { Popover } from "../../src/components/decks/import-popover";
import { HostDrawer } from "../../src/components/tournament/sheet/host-drawer";

vi.mock("../../src/components/tournament/matches/match-row", () => ({ MatchRow: () => null }));
vi.mock("../../src/components/tournament/sheet/rail-panels", () => ({ EndingEarly: () => null, PlayersPanel: () => null }));

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

/**
 * Every overlay with an exit follows one contract: on close it stays mounted, flips to
 * data-state="closed" and goes inert at once, gives focus back at once, and unmounts after its exit.
 */
function Toggle({ children }: { children: (open: boolean, set: (open: boolean) => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open it</button>
      {children(open, setOpen)}
    </>
  );
}

function openIt() {
  const opener = screen.getByRole("button", { name: "Open it" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("Modal", () => {
  it("fades out in place, lets go of focus and scroll at once, then unmounts", async () => {
    render(
      <Toggle>{(open, set) => <Modal open={open} onClose={() => set(false)} title="Sure?"><button type="button">Yes</button></Modal>}</Toggle>,
    );
    const opener = openIt();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-mo=modal]")).toHaveAttribute("data-state", "open");
    expect(dialog.querySelector("[data-mo=scrim]")).toHaveAttribute("data-state", "open");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(dialog).toHaveAttribute("inert");
    expect(dialog.querySelector("[data-mo=modal]")).toHaveAttribute("data-state", "closed");
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(document.activeElement).toBe(opener);
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(document.activeElement).toBe(opener);
  });
});

describe("Sheet", () => {
  it("slides out in place, then unmounts, with focus back on the opener at once", async () => {
    render(
      <Toggle>{(open, set) => <Sheet open={open} onClose={() => set(false)} title="Settings"><p>Body</p></Sheet>}</Toggle>,
    );
    const opener = openIt();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-mo=slide]")).toHaveAttribute("data-state", "open");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(dialog).toHaveAttribute("inert");
    expect(dialog.querySelector("[data-mo=slide]")).toHaveAttribute("data-state", "closed");
    expect(document.activeElement).toBe(opener);
    await waitFor(() => expect(dialog.isConnected).toBe(false));
  });
});

describe("CubeBottomSheet and UndoToast", () => {
  it("the sheet keeps its title and content through the exit, then unmounts", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<CubeBottomSheet open label="Add cards" onClose={onClose}><p>Search</p></CubeBottomSheet>);
    const sheet = await screen.findByRole("dialog", { name: "Add cards" });
    expect(sheet).toHaveAttribute("data-state", "open");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<CubeBottomSheet open={false} label="" onClose={onClose}>{null}</CubeBottomSheet>);
    expect(screen.getByRole("dialog", { name: "Add cards" })).toBe(sheet);
    expect(sheet).toHaveAttribute("data-state", "closed");
    expect(sheet).toHaveAttribute("inert");
    expect(screen.getByText("Search")).toBeInTheDocument();
    // A closing sheet no longer listens for Escape.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(sheet.isConnected).toBe(false));
  });

  it("the toast keeps its message while it leaves, then unmounts", async () => {
    const { rerender } = render(<UndoToast open message="Removed Main A" busy={false} onUndo={vi.fn()} onDismiss={vi.fn()} />);
    const toast = (await screen.findByText("Removed Main A")).closest("[data-mo]") as HTMLElement;
    expect(toast).toHaveAttribute("data-state", "open");
    rerender(<UndoToast open={false} message="" busy={false} onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText("Removed Main A")).toBeInTheDocument();
    expect(toast).toHaveAttribute("data-state", "closed");
    expect(toast).toHaveAttribute("inert");
    await waitFor(() => expect(toast.isConnected).toBe(false));
  });
});

describe("Popover (the import popover)", () => {
  it("scales out in place, returns focus to its trigger at once, then unmounts", async () => {
    render(
      <Toggle>{(open, set) => <Popover label="Import" open={open} onOpenChange={set}><button type="button">Go</button></Popover>}</Toggle>,
    );
    const trigger = screen.getByRole("button", { name: "Import" });
    trigger.focus();
    fireEvent.click(trigger);
    const panel = await screen.findByRole("dialog");
    expect(panel).toHaveAttribute("data-mo", "pop");
    expect(panel).toHaveAttribute("data-state", "open");
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBe(panel);
    expect(panel).toHaveAttribute("data-state", "closed");
    expect(panel).toHaveAttribute("inert");
    expect(document.activeElement).toBe(trigger);
    await waitFor(() => expect(panel.isConnected).toBe(false));
  });
});

describe("HostDrawer", () => {
  const tournament = { matches: [], status: "done", currentUserPlayerId: null } as never;
  const drawer = (open: boolean, onClose: () => void = vi.fn()) => (
    <HostDrawer open={open} tournament={tournament} tournamentSlug="t" ratings={{} as never} onChanged={vi.fn()} onClose={onClose} />
  );

  it("slides out in place, stops trapping at once, returns focus, then unmounts", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button type="button" onClick={() => setOpen(true)}>Open it</button>{drawer(open, () => setOpen(false))}</>;
    }
    render(<Harness />);
    const opener = openIt();
    const panel = await screen.findByRole("dialog", { name: "Host tools" });
    expect(panel).toHaveAttribute("data-state", "open");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close host tools" })));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Host tools" })).toBe(panel);
    expect(panel).toHaveAttribute("data-state", "closed");
    expect(panel).toHaveAttribute("inert");
    expect(document.activeElement).toBe(opener);
    await waitFor(() => expect(panel.isConnected).toBe(false));
  });
});
