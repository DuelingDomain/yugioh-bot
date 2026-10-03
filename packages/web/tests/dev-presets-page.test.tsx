// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

const { submit } = vi.hoisted(() => ({ submit: vi.fn(async (..._a: unknown[]) => ({ path: "/p" })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/duel/api", () => ({
  DUEL_LIST_KEY: "/api/duels",
  listDuelPresets: vi.fn(async () => ({
    presets: [{ id: "dust", title: "Dust", format: "1v1", needsMultiCore: false, checklist: ["See chain", "See pass"] }],
  })),
  startDuelPreset: vi.fn(),
}));
vi.mock("@/components/duel/fonts", () => ({ duelFontClasses: "" }));
vi.mock("@/components/duel/report-button", () => ({ submitReport: submit }));

import { DevPresets } from "../app/(app)/duels/dev-presets/dev-presets";
import { checklistResults } from "@/components/duel/report-buffers";

function page() {
  return render(<SWRConfig value={{ provider: () => new Map() }}><DevPresets /></SWRConfig>);
}
beforeEach(() => { submit.mockClear(); checklistResults.clear(); window.localStorage.clear(); });
afterEach(cleanup);

describe("dev presets page", () => {
  it("shows unknown core info and unknown issues when the host gives none", async () => {
    page();
    await screen.findByText("Dust");
    expect(screen.getByTestId("core-info").textContent).toContain("unknown");
    expect(screen.getByTestId("known-issues").textContent).toContain("unknown");
  });

  it("records pass/fail in the buffer and writes a checklist report when a room exists", async () => {
    window.localStorage.setItem("duel-preset-last:dust", "room-1");
    page();
    fireEvent.click(await screen.findByLabelText("Fail: See pass"));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith("room-1", expect.objectContaining({ category: "checklist", checklistItem: "See pass", actual: "FAIL" }), expect.anything());
    expect(checklistResults.snapshot()[0]).toMatchObject({ presetId: "dust", item: "See pass", result: "fail" });
    fireEvent.click(screen.getByLabelText("Pass: See chain"));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  });

  it("only buffers the result when no room was started", async () => {
    page();
    fireEvent.click(await screen.findByLabelText("Pass: See chain"));
    expect(submit).not.toHaveBeenCalled();
    expect(checklistResults.size).toBe(1);
  });
});
