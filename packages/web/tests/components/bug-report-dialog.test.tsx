// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BugReportDialog } from "@/components/bug-report/bug-report-dialog";
import { collectBugContext } from "@/components/bug-report/context";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { parseBugReportRequest } from "@/lib/bug-report";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: 1, issue: null }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/dashboard?tab=x#top");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.style.overflow = ""; });

function Harness({ collect = () => collectBugContext(null) }: { collect?: () => ReturnType<typeof collectBugContext> }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open report</button>
      <BugReportDialog open={open} onClose={() => setOpen(false)} collect={collect} />
    </>
  );
}

describe("collectBugContext", () => {
  it("without a room holds the path and browser details only", () => {
    const { path, duelSlug, context } = collectBugContext(null);
    expect(path).toBe("/dashboard");
    expect(duelSlug).toBeUndefined();
    expect(Object.keys(context).sort()).toEqual(["timestamp", "userAgent", "viewport"]);
  });

  it("with a 4-way room holds the public facts and passes the server check", () => {
    const room = FFA4_FIXTURES.states.main.room;
    const { path, duelSlug, context } = collectBugContext(room);
    expect(duelSlug).toBe(room.session.slug);
    expect(context).toMatchObject({ format: "ffa4", duelMode: room.session.mode, seat: room.mySeat, turn: room.engine!.turn, phase: room.engine!.phase, turnSeat: room.engine!.turnSeat });
    expect(context.livingPlayers).toBeGreaterThan(0);
    expect(context.animationSpeed).toBe(1);
    expect(context.log!.length).toBeLessThanOrEqual(15);
    const parsed = parseBugReportRequest({ description: "x", path, duelSlug, context });
    expect(parsed.ok).toBe(true);
  });

  it("drops private log lines over the whole log before it keeps the last 15", () => {
    const room = structuredClone(FFA4_FIXTURES.states.main.room);
    const lines = Array.from({ length: 30 }, (_, i) => (i % 2 ? `You added Card ${i} to your hand` : `Public line ${i}`));
    room.engine!.log = lines.map((text, i) => ({ id: i, text }));
    const log = collectBugContext(room).context.log!;
    expect(log).toHaveLength(15);
    expect(log.every((line) => line.startsWith("Public line"))).toBe(true);
    expect(log.at(-1)).toBe("Public line 28");
  });
});

describe("BugReportDialog", () => {
  it("traps Tab, closes on Escape, gives focus back and unlocks the page", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open report" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Report a bug" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(screen.getByLabelText(/What went wrong\?/));

    // Tab from the last control goes to the first one, and Shift+Tab from the first goes to the last.
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close modal" }));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reopens empty and keeps Send off until the first field has text", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open report" }));
    fireEvent.change(screen.getByLabelText(/What went wrong\?/), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Send report" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Open report" }));
    expect((screen.getByLabelText(/What went wrong\?/) as HTMLTextAreaElement).value).toBe("");
  });

  it("sends the page report without a duel and shows an error then keeps the text", async () => {
    fetchMock.mockImplementationOnce(async () => { throw new Error("offline"); });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open report" }));
    fireEvent.change(screen.getByLabelText(/What went wrong\?/), { target: { value: "Leaderboard is blank" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send report" })); });
    expect((await screen.findByRole("alert")).textContent).toContain("Check your connection");
    expect((screen.getByLabelText(/What went wrong\?/) as HTMLTextAreaElement).value).toBe("Leaderboard is blank");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send report" })); });
    await screen.findByTestId("bug-report-done");
    const body = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(body.path).toBe("/dashboard");
    expect(body.duelSlug).toBeUndefined();
    expect(body.expected).toBeUndefined();
  });
});
