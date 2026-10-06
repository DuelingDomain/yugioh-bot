// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeSandboxShare } from "@yugidraft/shared/duels";
import { LinkStub } from "./components/shell/helpers";

const mocks = vi.hoisted(() => ({ push: vi.fn(), createScenario: vi.fn(), getScenario: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: LinkStub }));
vi.mock("@/components/sandbox/api", () => ({ createScenario: mocks.createScenario, getScenario: mocks.getScenario }));

import { SandboxList } from "../app/(app)/sandbox/_components/sandbox-list";

const board = { format: "ffa3", mode: "normal", masterRule: 5, turn: "p0", deckSize: 20, startAt: "draw", eliminated: ["p2"] } as const;
const run = { bots: { "1": "pass", "2": "pass", "3": "pass" } } as const;

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

async function paste(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.click(screen.getByRole("button", { name: /import code/i }));
  await user.click(screen.getByRole("textbox", { name: /share code/i }));
  await user.paste(code);
  await user.click(screen.getByRole("button", { name: "Import" }));
}

describe("SandboxList Import code", () => {
  it("saves the code as your scenario and opens it", async () => {
    mocks.createScenario.mockResolvedValue({ id: 12 });
    const user = userEvent.setup();
    render(<SandboxList items={[]} />);
    await paste(user, encodeSandboxShare({ name: "Column test", board: { ...board }, run: { bots: { ...run.bots } } }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/sandbox/12"));
    expect(mocks.createScenario).toHaveBeenCalledWith({ name: "Column test", board: { ...board }, run: { bots: { ...run.bots } } });
  });

  it("names a code that has no name", async () => {
    mocks.createScenario.mockResolvedValue({ id: 3 });
    const user = userEvent.setup();
    render(<SandboxList items={[]} />);
    await paste(user, encodeSandboxShare({ board: { ...board }, run: { bots: { ...run.bots } } }));
    await waitFor(() => expect(mocks.createScenario).toHaveBeenCalledWith(expect.objectContaining({ name: "Imported scenario" })));
  });

  it("shows a bad code and a save error inline, without leaving the page", async () => {
    const user = userEvent.setup();
    render(<SandboxList items={[]} />);
    await paste(user, "nope");
    expect(await screen.findByRole("alert")).toHaveTextContent(/must start with DKSB1:/);
    expect(mocks.createScenario).not.toHaveBeenCalled();

    mocks.createScenario.mockRejectedValue(new Error("You have 200 scenarios already."));
    const box = screen.getByRole("textbox", { name: /share code/i });
    await user.clear(box);
    await user.click(box);
    await user.paste(encodeSandboxShare({ board: { ...board }, run: { bots: { ...run.bots } } }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You have 200 scenarios already.");
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
