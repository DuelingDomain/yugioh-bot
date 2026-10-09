// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostConfirm, HostMenu } from "../../../src/components/draft/room/host-menu";
import { RoomBar } from "../../../src/components/draft/room/room-bar";
import { setCurrentMotion } from "../../../src/components/draft/room/motion";
import { DraftTerminalError, draftTerminalMessage, requestDraftTerminal } from "../../../src/lib/draft-terminal-client";

beforeEach(() => {
  setCurrentMotion("full");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Host button in the room bar", () => {
  const base = {
    name: "Friday cube night",
    sub: "6 at the table",
    motion: "full" as const,
    motionOpen: false,
    onMotion: () => {},
    canSay: false,
    sayOpen: false,
    onSay: () => {},
    progress: 0,
    where: { theme: false, extra: false, packRound: 1, packsPerPlayer: 3, pickStep: 1, packSize: 15, direction: 1 as const, phaseDone: 0, phaseOf: 0 },
  };

  it("is there for the host, labelled and wired to the popover", () => {
    const onHost = vi.fn();
    render(<RoomBar {...base} canHost hostOpen={false} onHost={onHost} />);
    const button = screen.getByRole("button", { name: "Host controls" });
    expect(button).toHaveTextContent("Host");
    expect(button).toHaveAttribute("aria-controls", "hostPop");
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(onHost).toHaveBeenCalledWith(button);
  });

  it("is missing for a player who is not the host", () => {
    render(<RoomBar {...base} />);
    expect(screen.queryByRole("button", { name: "Host controls" })).toBeNull();
  });
});

describe("host menu", () => {
  it("offers End now and Cancel draft, and sends nothing itself", () => {
    const onChoose = vi.fn();
    render(<HostMenu open anchor={null} onChoose={onChoose} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Host controls" });
    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.map((b) => b.querySelector("b")?.textContent)).toEqual(["End now (keep picks)", "Cancel draft"]);
    expect(buttons[1]).toHaveAttribute("data-tone", "danger");
    fireEvent.click(buttons[0]);
    expect(onChoose).toHaveBeenLastCalledWith("end");
    fireEvent.click(buttons[1]);
    expect(onChoose).toHaveBeenLastCalledWith("cancel");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<HostMenu open anchor={null} onChoose={() => {}} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Host controls" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("host confirm", () => {
  it("renders nothing without an action", () => {
    const { container } = render(<HostConfirm action={null} onConfirm={vi.fn()} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("asks before ending, keeps focus on the safe button, and sends one End request on confirm", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<HostConfirm action="end" onConfirm={onConfirm} onClose={onClose} />);
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("heading")).toHaveTextContent("End the draft now?");
    expect(screen.getByRole("button", { name: "Keep drafting" })).toHaveFocus();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "End draft" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("end");
  });

  it("backs out without sending", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<HostConfirm action="end" onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep drafting" }));
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps Cancel draft off until the host types the word", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<HostConfirm action="cancel" onConfirm={onConfirm} onClose={() => {}} />);
    const confirm = screen.getByRole("button", { name: "Cancel draft" });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("data-kind", "danger");
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "cance" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: "Cancel" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledExactlyOnceWith("cancel"));
  });

  it("sends one request when the host clicks twice, and turns both buttons off while it runs", async () => {
    let finish: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onClose = vi.fn();
    render(<HostConfirm action="end" onConfirm={onConfirm} onClose={onClose} />);
    const confirm = screen.getByRole("button", { name: "End draft" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const busy = screen.getByRole("button", { name: "Ending…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Keep drafting" })).toBeDisabled();
    // Escape does not close the dialog under a running request
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows the error in the dialog, stays open, and lets the host try again", async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error("This draft has not started, so it cannot be ended. Cancel it instead."))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<HostConfirm action="end" onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "End draft" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This draft has not started");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "End draft" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "End draft" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});

describe("draft terminal client", () => {
  const reply = (status: number, body: unknown) =>
    vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

  it("posts to the end route without a body", async () => {
    const fetchMock = reply(200, { id: 1, status: "completed", changed: true });
    vi.stubGlobal("fetch", fetchMock);
    await requestDraftTerminal("my draft", "end");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/drafts/my%20draft/end", { method: "POST" });
  });

  it("posts to the cancel route", async () => {
    const fetchMock = reply(200, { id: 1, status: "cancelled", changed: true });
    vi.stubGlobal("fetch", fetchMock);
    await requestDraftTerminal("d", "cancel");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/drafts/d/cancel", { method: "POST" });
  });

  it.each([
    [409, "DRAFT_NOT_STARTED", /has not started/, true],
    [409, "DRAFT_ALREADY_FINISHED", /already finished/, true],
    [409, "DRAFT_HAS_TOURNAMENT", /tournament/, false],
    [503, undefined, /not available/, false],
    [401, undefined, /Sign in again/, false],
    [403, undefined, /host or an owner/, false],
    [500, undefined, /could not be ended/, false],
  ])("turns %s %s into plain words", async (status, code, words, refresh) => {
    vi.stubGlobal("fetch", reply(status, { error: "raw", code }));
    const err = await requestDraftTerminal("d", "end").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DraftTerminalError);
    expect((err as DraftTerminalError).message).toMatch(words);
    expect((err as DraftTerminalError).status).toBe(status);
    expect((err as DraftTerminalError).refresh).toBe(refresh);
  });

  it("explains a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fail")));
    const err = await requestDraftTerminal("d", "cancel").catch((e: unknown) => e);
    expect((err as DraftTerminalError).message).toMatch(/Could not reach the server/);
    expect((err as DraftTerminalError).status).toBeNull();
  });

  it("falls back to the server text for an unknown status", () => {
    expect(draftTerminalMessage("end", 418, null, "teapot")).toBe("teapot");
    expect(draftTerminalMessage("cancel", 418, null, null)).toBe("Failed to cancel the draft.");
  });
});
