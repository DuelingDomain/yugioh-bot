// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkStub } from "./components/shell/helpers";
import type { ScenarioData, ScenarioListItem } from "../app/(app)/sandbox/_lib/load";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  startSandbox: vi.fn(),
  createScenario: vi.fn(),
  updateScenario: vi.fn(),
  deleteScenario: vi.fn(),
  getScenario: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("next/link", () => ({ default: LinkStub }));
vi.mock("@/components/sandbox/api", () => ({
  startSandbox: mocks.startSandbox,
  createScenario: mocks.createScenario,
  updateScenario: mocks.updateScenario,
  deleteScenario: mocks.deleteScenario,
  getScenario: mocks.getScenario,
}));
// The builder has its own tests. Here a stub shows what the editor gives it and lets the test press its buttons.
vi.mock("@/components/sandbox/builder", () => ({
  SandboxBuilder: function SandboxBuilderStub(props: {
    initial: { board: unknown; run: unknown };
    name?: string;
    onNameChange?: (name: string) => void;
    scenarioId?: number;
    saveLabel?: string;
    onChange?: (state: unknown) => void;
    onSave?: (state: unknown) => Promise<void>;
    onShare?: (state: unknown) => Promise<void>;
    onStarted?: (slug: string) => void;
  }) {
    // The real builder shows a thrown error in its own problem line. The stub does the same.
    const [problem, setProblem] = React.useState("");
    const call = (fn?: (state: unknown) => Promise<void>) => () => {
      void fn?.(props.initial).catch((e: Error) => setProblem(e.message));
    };
    return (
    <div>
      {problem ? <p>{problem}</p> : null}
      <input aria-label="name" value={props.name ?? ""} onChange={(e) => props.onNameChange?.(e.target.value)} />
      <span data-testid="scenario-id">{String(props.scenarioId)}</span>
      <button onClick={() => props.onChange?.(props.initial)}>edit</button>
      <button onClick={call(props.onSave)}>{props.saveLabel ?? "Save"}</button>
      <button onClick={call(props.onShare)}>share</button>
      <button onClick={() => props.onStarted?.("duel-9")}>started</button>
    </div>
    );
  },
}));

import { SandboxList } from "../app/(app)/sandbox/_components/sandbox-list";
import { PlayNow } from "../app/(app)/sandbox/_components/play-now";
import { ScenarioEditor } from "../app/(app)/sandbox/_components/scenario-editor";
import { copyName, shareUrl, updatedDay } from "../app/(app)/sandbox/_lib/labels";

const caps = { multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: true };
const board = { format: "1v1", p0: { hand: [46986414] } };
const run = { bots: { "1": "pass", "2": "pass", "3": "pass" } };

function item(over: Partial<ScenarioListItem> = {}): ScenarioListItem {
  return { id: 1, name: "Mine", format: "1v1", mode: "normal", ownerName: "Me", updatedAt: "2026-10-05 14:03:00", mine: true, ...over };
}
function data(over: Partial<ScenarioData> = {}): ScenarioData {
  return { ...item(), board, run, ...over } as ScenarioData;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});
afterEach(() => cleanup());

describe("labels", () => {
  it("builds copy names that fit 80 characters", () => {
    expect(copyName("Board")).toBe("Board (copy)");
    expect(copyName("Board (copy)")).toBe("Board (copy)");
    expect(copyName("x".repeat(80))).toHaveLength(80);
    expect(copyName("x".repeat(80)).endsWith(" (copy)")).toBe(true);
  });
  it("shows the day and the share link", () => {
    expect(updatedDay("2026-10-05 14:03:00")).toBe("2026-10-05");
    expect(shareUrl("http://x", 4)).toBe("http://x/sandbox/4?play=1");
  });
});

describe("SandboxList", () => {
  const items = [
    item({ id: 1, name: "Mine" }),
    item({ id: 2, name: "Theirs", mine: false, ownerName: "Rin", format: "ffa4", mode: "domain" }),
  ];

  it("splits your scenarios from other developers and links Play to the share route", () => {
    render(<SandboxList items={items} />);
    const mine = screen.getByRole("region", { name: "Your scenarios" });
    const others = screen.getByRole("region", { name: "Other developers" });
    expect(within(mine).getByRole("link", { name: "Play Mine" })).toHaveAttribute("href", "/sandbox/1?play=1");
    expect(within(others).getByRole("link", { name: "Play Theirs" })).toHaveAttribute("href", "/sandbox/2?play=1");
    expect(within(others).getByText("by Rin")).toBeInTheDocument();
    expect(within(others).getByText("4-way")).toBeInTheDocument();
  });

  it("offers Delete only on your own scenarios and Save as copy only on the others", () => {
    render(<SandboxList items={items} />);
    expect(screen.getByRole("button", { name: "Delete Mine" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Theirs" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save Theirs as copy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Mine as copy" })).toBeNull();
  });

  it("saves another developer's scenario as your copy and opens it", async () => {
    mocks.getScenario.mockResolvedValue({ id: 2, board, run });
    mocks.createScenario.mockResolvedValue({ id: 9 });
    render(<SandboxList items={items} />);
    await userEvent.click(screen.getByRole("button", { name: "Save Theirs as copy" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/sandbox/9"));
    expect(mocks.createScenario).toHaveBeenCalledWith({ name: "Theirs (copy)", board, run });
  });

  it("asks before it deletes, then removes the row", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SandboxList items={items} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Mine" }));
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("alertdialog", { name: "Delete Mine" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Mine")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith("/api/sandbox/scenarios/1", { method: "DELETE" });
    vi.unstubAllGlobals();
  });

  it("shows an empty state with New scenario", () => {
    render(<SandboxList items={[]} />);
    expect(screen.getByText("No saved scenarios yet")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /New scenario/ })[0]).toHaveAttribute("href", "/sandbox/new");
  });

  it("copies the share link", async () => {
    render(<SandboxList items={items} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy link to Mine" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/sandbox/1?play=1`));
    expect(await screen.findByText(/Link copied/)).toBeInTheDocument();
  });
});

describe("PlayNow", () => {
  it("starts once with the saved board and replaces itself with the duel room", async () => {
    mocks.startSandbox.mockResolvedValue({ slug: "abc" });
    render(<PlayNow scenario={data({ id: 5 })} />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/duels/abc"));
    expect(mocks.startSandbox).toHaveBeenCalledTimes(1);
    expect(mocks.startSandbox).toHaveBeenCalledWith({ board, run, scenarioId: 5 });
  });

  it("shows the error, then retries and opens the builder", async () => {
    mocks.startSandbox.mockRejectedValueOnce(new Error("Duel engine is down")).mockResolvedValueOnce({ slug: "again" });
    render(<PlayNow scenario={data({ id: 5 })} />);
    expect(await screen.findByText("Duel engine is down")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in builder" })).toHaveAttribute("href", "/sandbox/5");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/duels/again"));
    expect(mocks.startSandbox).toHaveBeenCalledTimes(2);
  });
});

describe("ScenarioEditor", () => {
  it("saves a new board, then keeps updating the same scenario", async () => {
    mocks.createScenario.mockResolvedValue({ id: 7, name: "Burn test" });
    mocks.updateScenario.mockResolvedValue({ id: 7 });
    const replaceState = vi.spyOn(window.history, "replaceState");
    render(<ScenarioEditor capabilities={caps} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Name the board first.")).toBeInTheDocument();
    expect(mocks.createScenario).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("name"), "Burn test");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.createScenario).toHaveBeenCalledWith(expect.objectContaining({ name: "Burn test" })));
    expect(replaceState).toHaveBeenCalledWith(null, "", "/sandbox/7");
    await waitFor(() => expect(screen.getByTestId("scenario-id")).toHaveTextContent("7"));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.updateScenario).toHaveBeenCalledWith(7, expect.objectContaining({ name: "Burn test" })));
    expect(mocks.createScenario).toHaveBeenCalledTimes(1);
    replaceState.mockRestore();
  });

  it("gives another developer Save as copy, never an update or a delete", async () => {
    mocks.createScenario.mockResolvedValue({ id: 12, name: "Theirs (copy)" });
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => undefined);
    render(<ScenarioEditor capabilities={caps} scenario={data({ id: 3, name: "Theirs", mine: false, ownerName: "Rin" })} />);
    expect(screen.queryByRole("button", { name: "Delete scenario" })).toBeNull();
    expect(screen.getByText(/By Rin/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save as copy" }));
    await waitFor(() => expect(mocks.createScenario).toHaveBeenCalledWith(expect.objectContaining({ name: "Theirs (copy)" })));
    expect(mocks.updateScenario).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Delete scenario" })).toBeInTheDocument();
    replaceState.mockRestore();
  });

  it("links the duel to the scenario only when the board matches the saved one", async () => {
    render(<ScenarioEditor capabilities={caps} scenario={data({ id: 3, mine: false })} />);
    expect(screen.getByTestId("scenario-id")).toHaveTextContent("3");
    await userEvent.click(screen.getByRole("button", { name: "edit" }));
    await waitFor(() => expect(screen.getByTestId("scenario-id")).toHaveTextContent("undefined"));
  });

  it("copies the play link on Share, saving a new board first", async () => {
    mocks.createScenario.mockResolvedValue({ id: 8, name: "Fresh" });
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => undefined);
    render(<ScenarioEditor capabilities={caps} />);
    await userEvent.type(screen.getByLabelText("name"), "Fresh");
    await userEvent.click(screen.getByRole("button", { name: "share" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/sandbox/8?play=1`));
    expect(mocks.createScenario).toHaveBeenCalledTimes(1);
    replaceState.mockRestore();
  });

  it("goes to the duel room when Start answers", async () => {
    render(<ScenarioEditor capabilities={caps} />);
    await userEvent.click(screen.getByRole("button", { name: "started" }));
    expect(mocks.push).toHaveBeenCalledWith("/duels/duel-9");
  });

  it("falls back to an empty board and says so when a saved board cannot load", () => {
    render(<ScenarioEditor capabilities={caps} draft={{ board: { format: "nope" } }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i);
  });

  it("deletes your scenario after a confirm and returns to the list", async () => {
    mocks.deleteScenario.mockResolvedValue(undefined);
    render(<ScenarioEditor capabilities={caps} scenario={data({ id: 3 })} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete scenario" }));
    expect(mocks.deleteScenario).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/sandbox"));
    expect(mocks.deleteScenario).toHaveBeenCalledWith(3);
  });
});
