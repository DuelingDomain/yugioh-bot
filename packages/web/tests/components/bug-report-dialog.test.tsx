// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BugReportDialog } from "@/components/bug-report/bug-report-dialog";
import { collectBugContext } from "@/components/bug-report/context";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { parseBugReportRequest } from "@/lib/bug-report";

const fetchMock = vi.fn();
const json = (data: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(data), { status, headers });
let precheckAnswer: () => Promise<Response>;
let reportAnswer: (body: Record<string, unknown>) => Promise<Response>;
beforeEach(() => {
  vi.clearAllMocks();
  precheckAnswer = async () => json({ knownLimits: [], duplicates: [] });
  reportAnswer = async () => json({ id: 1, issue: null });
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    String(url).endsWith("/precheck") ? precheckAnswer() : reportAnswer(JSON.parse(String(init?.body ?? "{}"))));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/dashboard?tab=x#top");
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.style.overflow = ""; });

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
    const parsed = parseBugReportRequest({ description: "The duel froze on my turn", expected: "It should go on", path, duelSlug, context });
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
  it("reopens empty", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open report" }));
    fireEvent.change(screen.getByLabelText(/What went wrong\?/), { target: { value: "some text" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Open report" }));
    expect((screen.getByLabelText(/What went wrong\?/) as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByLabelText(/What did you expect\?/) as HTMLTextAreaElement).value).toBe("");
  });
});

const DESCRIPTION = "The chain froze and the duel never went on";
const EXPECTED = "The chain should resolve";

function open(collect?: () => ReturnType<typeof collectBugContext>) {
  render(<Harness collect={collect} />);
  fireEvent.click(screen.getByRole("button", { name: "Open report" }));
}
function write(description = DESCRIPTION, expected = EXPECTED) {
  fireEvent.change(screen.getByLabelText(/What went wrong\?/), { target: { value: description } });
  fireEvent.change(screen.getByLabelText(/What did you expect\?/), { target: { value: expected } });
}
async function send() {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send report" })); });
}
const urls = () => fetchMock.mock.calls.map(([url]) => String(url));
const reportBodies = () => fetchMock.mock.calls.filter(([url]) => url === "/api/bug-reports").map(([, init]) => JSON.parse(init.body as string));

describe("BugReportDialog quality check", () => {
  it("shows a message under each field, calls nothing, and clears them when the text is good", async () => {
    open();
    write("Broke", "");
    await send();
    expect(screen.getByText(/at least 20 characters and 4 words/)).toBeInTheDocument();
    expect(screen.getByText("Tell us what you expected to happen.")).toBeInTheDocument();
    expect(screen.getByLabelText(/What went wrong\?/)).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
    write("Broke", "ok");
    expect(screen.getByText(/at least 10 characters\./)).toBeInTheDocument();
    write();
    expect(screen.queryByText(/at least 20 characters/)).toBeNull();
    expect(screen.queryByText(/at least 10 characters\./)).toBeNull();
    expect(screen.getByLabelText(/What went wrong\?/)).not.toHaveAttribute("aria-invalid");
  });

  it("shows the field errors the server sends back from the check", async () => {
    precheckAnswer = async () => json({ error: "x", fieldErrors: { expected: "Server says write more." } }, 400);
    open();
    write();
    await send();
    expect(await screen.findByText("Server says write more.")).toBeInTheDocument();
    expect(reportBodies()).toHaveLength(0);
  });
});

describe("BugReportDialog pre-check", () => {
  it("sends the report straight away when the check finds nothing, with both texts and one context snapshot", async () => {
    const collect = vi.fn(() => collectBugContext(null));
    open(collect);
    write();
    await send();
    await screen.findByTestId("bug-report-done");
    expect(urls()).toEqual(["/api/bug-reports/precheck", "/api/bug-reports"]);
    expect(collect).toHaveBeenCalledTimes(1);
    const [report] = reportBodies();
    expect(report).toMatchObject({ description: DESCRIPTION, expected: EXPECTED, path: "/dashboard" });
    expect(report.duplicateOf).toBeUndefined();
    const precheckBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(precheckBody).toEqual(report);
    expect(screen.getByText("Saved — the team will see it.")).toBeInTheDocument();
  });

  it.each([
    ["a network error", async () => { throw new Error("offline"); }],
    ["a server error", async () => json({ error: "boom" }, 500)],
    ["a rate limit", async () => json({ error: "slow" }, 429)],
  ])("sends the report when the check fails with %s", async (_name, answer) => {
    precheckAnswer = answer as () => Promise<Response>;
    open();
    write();
    await send();
    await screen.findByTestId("bug-report-done");
    expect(reportBodies()).toHaveLength(1);
  });

  it("sends the report when the check takes longer than 5 seconds", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!String(url).endsWith("/precheck")) return Promise.resolve(json({ id: 1, issue: null }));
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    });
    open();
    write();
    await send();
    expect(screen.getByTestId("bug-report-checking")).toBeInTheDocument();
    expect(reportBodies()).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(5001); });
    expect(screen.getByTestId("bug-report-done")).toBeInTheDocument();
    expect(reportBodies()).toHaveLength(1);
  });

  it("shows a known problem with its explanation, sends nothing yet, and sends a new report on 'My bug is different'", async () => {
    precheckAnswer = async () => json({
      knownLimits: [{ id: "ffa-surrender-end-of-turn", title: "Surrender waits until the end of the turn", explanation: "A new immediate rule is coming." }],
      duplicates: [],
    });
    open();
    write();
    await send();
    expect(await screen.findByText("This is already known")).toBeInTheDocument();
    expect(screen.getByText("Surrender waits until the end of the turn")).toBeInTheDocument();
    expect(screen.getByText("A new immediate rule is coming.")).toBeInTheDocument();
    expect(reportBodies()).toHaveLength(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "My bug is different" })); });
    await screen.findByTestId("bug-report-done");
    expect(reportBodies()).toHaveLength(1);
    expect(reportBodies()[0].duplicateOf).toBeUndefined();
  });

  const duplicates = [
    { number: 12, url: "https://github.com/o/r/issues/12", title: "[Bug] [FFA3] Chain froze", sameDuel: true, score: 0.5 },
    { number: 15, url: "https://github.com/o/r/issues/15", title: "[Bug] Duel stuck", sameDuel: false, score: 0.4 },
  ];

  it("lists similar issues with links, marks the one from this duel, and 'Yes, same bug' sends duplicateOf", async () => {
    precheckAnswer = async () => json({ knownLimits: [], duplicates });
    reportAnswer = async () => json({ id: 3, issue: { number: 12, url: duplicates[0]!.url }, duplicate: true });
    open();
    write();
    await send();
    expect(await screen.findByText("Is it one of these?")).toBeInTheDocument();
    expect(screen.getByText("Reported by another player in this duel")).toBeInTheDocument();
    expect(screen.getAllByText("Reported by another player in this duel")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Chain froze/ })).toHaveAttribute("href", duplicates[0]!.url);
    expect(screen.getByRole("link", { name: /Duel stuck/ })).toHaveAttribute("href", duplicates[1]!.url);
    expect(screen.queryByText("This is already known")).toBeNull();
    const yes = screen.getAllByRole("button", { name: "Yes, same bug" });
    expect(yes).toHaveLength(2);
    await act(async () => { fireEvent.click(yes[0]!); });
    await screen.findByTestId("bug-report-done");
    expect(reportBodies()).toHaveLength(1);
    expect(reportBodies()[0]).toMatchObject({ description: DESCRIPTION, expected: EXPECTED, duplicateOf: 12 });
    expect(screen.getByTestId("bug-report-done").textContent).toContain("added to issue #12");
    expect(screen.getByRole("link", { name: "#12" })).toHaveAttribute("href", duplicates[0]!.url);
  });

  it("'No, it is different' sends a normal report with no duplicateOf", async () => {
    precheckAnswer = async () => json({ knownLimits: [], duplicates });
    reportAnswer = async () => json({ id: 4, issue: { number: 99, url: "https://github.com/o/r/issues/99" } });
    open();
    write();
    await send();
    await screen.findByText("Is it one of these?");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "No, it is different" })); });
    await screen.findByTestId("bug-report-done");
    expect(reportBodies()).toHaveLength(1);
    expect(reportBodies()[0].duplicateOf).toBeUndefined();
    expect(screen.getByTestId("bug-report-done").textContent).toContain("Your report is issue");
  });

  it("shows known problems and similar issues together, and the 'different' button still sends a new report", async () => {
    precheckAnswer = async () => json({ knownLimits: [{ id: "a", title: "Known thing", explanation: "Explained." }], duplicates });
    open();
    write();
    await send();
    expect(await screen.findByText("This is already known")).toBeInTheDocument();
    expect(screen.getByText("Is it one of these?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "No, it is different" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "My bug is different" })); });
    await screen.findByTestId("bug-report-done");
    expect(reportBodies()[0].duplicateOf).toBeUndefined();
  });

  it("drops an issue the server refuses (409) and keeps the other choices", async () => {
    precheckAnswer = async () => json({ knownLimits: [], duplicates });
    reportAnswer = async () => json({ error: "That issue is not open for reports. Send your report as a new one." }, 409);
    open();
    write();
    await send();
    await screen.findByText("Is it one of these?");
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Yes, same bug" })[0]!); });
    expect((await screen.findByRole("alert")).textContent).toContain("not open for reports");
    expect(screen.queryByRole("link", { name: /Chain froze/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Duel stuck/ })).toBeInTheDocument();
  });

  it("goes back to the text with nothing lost", async () => {
    precheckAnswer = async () => json({ knownLimits: [], duplicates });
    open();
    write();
    await send();
    await screen.findByText("Is it one of these?");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByLabelText(/What went wrong\?/) as HTMLTextAreaElement).value).toBe(DESCRIPTION);
    expect((screen.getByLabelText(/What did you expect\?/) as HTMLTextAreaElement).value).toBe(EXPECTED);
    expect(reportBodies()).toHaveLength(0);
  });

  it("keeps the text and shows the error when the report cannot be sent, then sends on a second try", async () => {
    reportAnswer = async () => { throw new Error("offline"); };
    open();
    write();
    await send();
    expect((await screen.findByRole("alert")).textContent).toContain("Check your connection");
    expect((screen.getByLabelText(/What went wrong\?/) as HTMLTextAreaElement).value).toBe(DESCRIPTION);
    reportAnswer = async () => json({ id: 1, issue: { number: 7, url: "https://github.com/o/r/issues/7" } });
    await send();
    await screen.findByTestId("bug-report-done");
    expect(screen.getByRole("link", { name: "#7" })).toBeInTheDocument();
  });
});
