// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { Snapshots } from "../src/components/admin-console/model";

const { refreshSection } = vi.hoisted(() => ({ refreshSection: vi.fn() }));
vi.mock("../src/components/admin-console/use-admin-section", () => ({ refreshSection }));
import { WaitlistView } from "../src/components/admin-console/views/waitlist";

const empty = { result: null, fetchedAt: null, failure: null };
const snapshots: Snapshots = {
  online: empty, live: empty, today: empty, system: empty, stats: empty, errors: empty, usage: empty,
  waitlist: { ...empty, result: { state: "ok", updatedAt: 1, data: { pending: 1, entries: [{ id: "wle_1", email: "new@example.test", status: "pending", createdAt: null }] } } },
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it.each([
  ["ok", "approve", 200, "Approved. Invite sent."],
  ["ok", "reject", 200, "Rejected."],
  ["already_decided", "approve", 200, "Already approved. No new action was taken."],
  ["already_decided", "reject", 200, "Already rejected. No new action was taken."],
  ["conflict", "reject", 409, "Another decision is already set. Refresh before you try again."],
  ["in_progress", "approve", 202, "A decision is in progress. Wait, then refresh."],
])("shows a short line for %s (%s)", async (status, decision, code, message) => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ status, decision }, { status: code }));
  vi.stubGlobal("fetch", fetcher);
  const actions = { go: vi.fn(), openPerson: vi.fn(), toast: vi.fn() };
  const user = userEvent.setup();
  render(<WaitlistView s={snapshots} actions={actions} />);
  // Always request approval: repeat/conflict feedback must use the decision returned by the server.
  await user.click(screen.getByRole("button", { name: /^Approve / }));
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect(await screen.findByText(message)).toBeVisible();
  expect(actions.toast.mock.calls[0][0]).toBe(message);
  expect(refreshSection).toHaveBeenCalledWith("waitlist");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ action: "approve" });
});

it("keeps a failed request available for retry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "clerk_unavailable" }, { status: 502 })));
  const user = userEvent.setup();
  render(<WaitlistView s={snapshots} actions={{ go: vi.fn(), openPerson: vi.fn(), toast: vi.fn() }} />);
  await user.click(screen.getByRole("button", { name: /^Approve / }));
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not approve this person. Try again.");
  expect(refreshSection).not.toHaveBeenCalled();
});
