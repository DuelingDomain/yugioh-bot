// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizerPanel } from "@/components/tournament/sheet/organizer-panel";
import { sheetTournament } from "../fixtures/tournament-sheet";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const props = { tournament: sheetTournament, tournamentSlug: "friday-night-12", onChanged: vi.fn() };

function confirmEnd(kind: "complete" | "cancel") {
  fireEvent.click(screen.getByRole("button", { name: kind === "complete" ? "End tournament now" : "Cancel tournament" }));
  fireEvent.click(screen.getByRole("button", { name: kind === "complete" ? "End tournament" : "Cancel tournament" }));
}

describe("OrganizerPanel in-place confirmations", () => {
  it("requires confirmation, DELETEs, then redirects to /tournaments", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: 12, status: "cancelled" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OrganizerPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel tournament" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Cancel this tournament?")).toBeInTheDocument();
    expect(screen.getByText(/It closes for everyone and can't be reopened\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel tournament" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-12", { method: "DELETE" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/tournaments"));
  });
  it("requires confirmation, POSTs to /complete and refreshes without redirecting", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: 12, status: "completed" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OrganizerPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "End tournament now" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("End the tournament now?")).toBeInTheDocument();
    expect(screen.getByText(/Unplayed matches stay unplayed and no champion is recorded\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End tournament" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-12/complete", { method: "POST" }));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });
  it.each(["complete", "cancel"] as const)("Keep playing dismisses %s without sending a request", (kind) => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<OrganizerPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: kind === "complete" ? "End tournament now" : "Cancel tournament" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "End tournament now" })).toBeInTheDocument();
  });
  it.each([
    ["cancel", 403, "Only the tournament creator can cancel it"],
    ["complete", 400, "Cannot end a pending tournament"],
  ] as const)("surfaces %s server errors and stays on the page", async (kind, status, error) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error }, { status })));
    render(<OrganizerPanel {...props} />);
    confirmEnd(kind);
    expect(await screen.findByRole("alert")).toHaveTextContent(error);
    expect(push).not.toHaveBeenCalled();
    expect(props.onChanged).not.toHaveBeenCalled();
  });
  it.each(["complete", "cancel"] as const)("keeps %s confirmation usable after a network error", async (kind) => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network unavailable"); }));
    render(<OrganizerPanel {...props} />);
    confirmEnd(kind);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
    expect(screen.getByRole("button", { name: "Keep playing" })).toBeEnabled();
  });
});

describe("OrganizerPanel timing and rules", () => {
  it("edits just the deadline with the existing PUT and ISO parsing", async () => {
    const fetchMock = vi.fn(async () => Response.json({})); vi.stubGlobal("fetch", fetchMock);
    render(<OrganizerPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit deadline" }));
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2099-01-01T12:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-12", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deadlineAt: new Date("2099-01-01T12:30").toISOString() }),
    }));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  });
  it("sends null when the deadline is cleared", async () => {
    const fetchMock = vi.fn(async () => Response.json({})); vi.stubGlobal("fetch", fetchMock);
    render(<OrganizerPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit deadline" }));
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-12", expect.objectContaining({ body: '{"deadlineAt":null}' })));
  });
  it("sends a numeric window without overwriting the deadline", async () => {
    const fetchMock = vi.fn(async () => Response.json({})); vi.stubGlobal("fetch", fetchMock);
    render(<OrganizerPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit confirm window" }));
    fireEvent.change(screen.getByLabelText("Confirm window (hours)"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-12", expect.objectContaining({ body: '{"reportConfirmWindowHours":6}' })));
  });
  it("discards unsaved changes on Cancel and follows the latest value when reopened", () => {
    const { rerender } = render(<OrganizerPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit confirm window" }));
    fireEvent.change(screen.getByLabelText("Confirm window (hours)"), { target: { value: "6" } });
    rerender(<OrganizerPanel {...props} tournament={{ ...sheetTournament, reportConfirmWindowHours: 48 }} />);
    expect(screen.getByLabelText("Confirm window (hours)")).toHaveValue(6);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Confirm window (hours)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit confirm window" }));
    expect(screen.getByLabelText("Confirm window (hours)")).toHaveValue(48);
  });
  it("keeps a rejected edit open and shows its error under the row", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "deadline must be a valid future date" }, { status: 400 })));
    render(<OrganizerPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit deadline" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("deadline must be a valid future date");
    expect(screen.getByLabelText("Deadline")).toBeInTheDocument();
    expect(props.onChanged).not.toHaveBeenCalled();
  });
  it("shows the corrected lock copy and otherwise expands the unchanged rules form", () => {
    const { rerender } = render(<OrganizerPanel {...props} />);
    expect(screen.getByText("Duel rules are locked. The first online duel has been opened.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit rules" })).toBeNull();
    rerender(<OrganizerPanel {...props} tournament={{ ...sheetTournament, rulesLocked: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit rules" }));
    expect(within(screen.getByRole("form", { name: "Duel rules" })).getByRole("button", { name: "Save duel rules" })).toBeInTheDocument();
  });

  it.each(["0", "721", "1.5"])("rejects an invalid confirmation window of %s hours before sending a request", async (value) => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<OrganizerPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit confirm window" }));
    fireEvent.change(screen.getByLabelText("Confirm window (hours)"), { target: { value } });
    fireEvent.submit(screen.getByRole("form", { name: "Edit confirm window" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirm window must be a whole number from 1 to 720 hours");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends null to restore the default confirmation window", async () => {
    const fetchMock = vi.fn(async () => Response.json({})); vi.stubGlobal("fetch", fetchMock);
    render(<OrganizerPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit confirm window" }));
    fireEvent.change(screen.getByLabelText("Confirm window (hours)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-12", expect.objectContaining({ body: '{"reportConfirmWindowHours":null}' })));
  });
});
