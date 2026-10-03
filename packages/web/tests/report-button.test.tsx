// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/duel/api", () => ({
  reportEnabled: vi.fn(async () => true),
  getDuelRoom: vi.fn(async () => ({ session: { name: "Dust Tornado" }, engine: { revision: 7, prompt: { id: "p1" } } })),
  listDuelPresets: vi.fn(async () => ({ presets: [{ id: "x", title: "Dust Tornado", format: "1v1", needsMultiCore: false, checklist: ["See chain", "See pass"] }] })),
}));

import { ReportButton, composeNote } from "@/components/duel/report-button";
import { marks } from "@/components/duel/report-buffers";

const fetchMock = vi.fn();
beforeEach(() => {
  marks.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ path: "/tmp/rep" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("composeNote", () => {
  it("labels the fields and stays within 4000 characters", () => {
    const n = composeNote({ category: "stall", expected: "a", actual: "b".repeat(9000) }, ["m1"]);
    expect(n.startsWith("Category: stall\nExpected: a\nActual: b")).toBe(true);
    expect(n.length).toBeLessThanOrEqual(4000);
  });
});

describe("ReportButton", () => {
  it("saves a mark on M and ignores M while typing", async () => {
    render(<div><input aria-label="field" /><ReportButton slug="s" /></div>);
    await screen.findByText(/Report/);
    // The M listener is added in a passive effect after the button shows; on a slow runner the first key can come first.
    await waitFor(() => {
      if (marks.size === 0) fireEvent.keyDown(window, { key: "m" });
      expect(marks.size).toBe(1);
    });
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "m" });
    expect(marks.size).toBe(1);
    fireEvent.keyDown(window, { key: "m", ctrlKey: true });
    expect(marks.size).toBe(1);
  });

  it("sends the structured form with attachments", async () => {
    render(<ReportButton slug="s" />);
    fireEvent.click(await screen.findByText(/Report/));
    fireEvent.change(await screen.findByLabelText("Category"), { target: { value: "wrong-rule" } });
    fireEvent.change(await screen.findByLabelText("Checklist item"), { target: { value: "See pass" } });
    fireEvent.change(screen.getByLabelText("Expected"), { target: { value: "chain link 2" } });
    fireEvent.change(screen.getByLabelText("Actual"), { target: { value: "no chain" } });
    fireEvent.click(screen.getByText("Save report"));
    await screen.findByText("/tmp/rep");
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/report"))!;
    const body = JSON.parse(call[1].body as string);
    expect(body.note).toContain("Category: wrong-rule");
    expect(body.note).toContain("Checklist item: See pass");
    expect(body.note).toContain("Expected: chain link 2");
    expect(body.note).toContain("Actual: no chain");
    expect(body.attachments.revision).toBe(7);
    expect(body.attachments.prompt).toEqual({ id: "p1" });
    expect(body.attachments.room.session.name).toBe("Dust Tornado");
    for (const k of ["frames", "clicks", "consoleErrors", "marks"]) expect(body.attachments).toHaveProperty(k);
  });

  it("says so when the attachments were dropped", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ path: "/tmp/rep", attachments: "too-large" }), { status: 200 }));
    render(<ReportButton slug="s" />);
    fireEvent.click(await screen.findByText(/Report/));
    fireEvent.click(await screen.findByText("Save report"));
    await screen.findByText("/tmp/rep");
    expect(screen.getByText("Report saved. The page data was too large and was not attached.")).toBeTruthy();
  });

  it("shows no warning when the attachments were written", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ path: "/tmp/rep", attachments: "written" }), { status: 200 }));
    render(<ReportButton slug="s" />);
    fireEvent.click(await screen.findByText(/Report/));
    fireEvent.click(await screen.findByText("Save report"));
    await screen.findByText("/tmp/rep");
    expect(screen.queryByText(/was not attached/)).toBeNull();
  });

  it("sends one automatic report per error signature", async () => {
    render(<ReportButton slug="s" />);
    await screen.findByText(/Report/);
    const fire = () => window.dispatchEvent(new ErrorEvent("error", { message: "boom", filename: "a.js", lineno: 1 }));
    fire(); fire();
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/report") && c[1]?.method === "POST")).toHaveLength(1));
    window.dispatchEvent(new ErrorEvent("error", { message: "other", filename: "a.js", lineno: 2 }));
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(2));
    const first = JSON.parse(fetchMock.mock.calls.find((c) => c[1]?.method === "POST")![1].body as string);
    expect(first.note).toContain("Category: crash (automatic)");
  });
});
