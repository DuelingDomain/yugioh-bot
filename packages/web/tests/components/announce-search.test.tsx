// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelAnswer, DuelCardInfo, DuelPrompt } from "@yugidraft/shared/duels";
const { searchDuelCards } = vi.hoisted(() => ({ searchDuelCards: vi.fn() }));
vi.mock("@/components/duel/api", () => ({ searchDuelCards }));
import { AnnounceSearch, PromptTray, usePromptDraft } from "@/components/duel/prompts";
import { PromptCenter } from "@/components/duel/prompt-center";

const card = (code: number, name: string, inDeck = false): DuelCardInfo => ({
  code, name, inDeck, description: "", type: 17, attack: 0, defense: 0, level: 1, attribute: 1, race: "dragon",
});
const suggestions = [card(1, "Blue-Eyes White Dragon", true), card(2, "Dark Magician", true)];
beforeEach(() => { searchDuelCards.mockReset(); searchDuelCards.mockResolvedValue({ cards: suggestions }); });
afterEach(cleanup);
const prompt: DuelPrompt = { id: "announce", seat: 0, kind: "announce-card", title: "Announce a card", options: [] };
function Panel({ center, submit, current = prompt }: { center: boolean; submit: (answer: DuelAnswer) => void; current?: DuelPrompt }) {
  const draft = usePromptDraft(current);
  return center
    ? <PromptCenter prompt={current} mySeat={0} active slug="table" busy={false} draft={draft} onSubmit={submit}
        menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={1} />
    : <PromptTray prompt={current} mySeat={0} slug="table" busy={false} draft={draft} onSubmit={submit} />;
}

describe.each([false, true])("announcement autocomplete (center=%s)", center => {
  it("loads own deck suggestions on opening and supports arrows and Enter without duplicate submission", async () => {
    const submit = vi.fn();
    render(<Panel center={center} submit={submit} />);
    await waitFor(() => expect(searchDuelCards).toHaveBeenCalledWith("", "table"));
    expect(await screen.findByText("Blue-Eyes White Dragon")).toBeVisible();
    expect(screen.getAllByText("In your deck")).toHaveLength(2);
    const input = screen.getByLabelText("Search card name");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submit).toHaveBeenCalledExactlyOnceWith({ cardCode: 2 });
  });
  it("searches one character, resets the keyboard highlight, and supports ArrowUp", async () => {
    const submit = vi.fn();
    render(<Panel center={center} submit={submit} />);
    await screen.findByText("Dark Magician");
    const input = screen.getByLabelText("Search card name");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    searchDuelCards.mockResolvedValueOnce({ cards: [suggestions[0]] });
    fireEvent.change(input, { target: { value: "b" } });
    await waitFor(() => expect(searchDuelCards).toHaveBeenLastCalledWith("b", "table"));
    await waitFor(() => expect(screen.queryByText("Dark Magician")).toBeNull());
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submit).toHaveBeenCalledExactlyOnceWith({ cardCode: 1 });
  });
  it("loads fresh empty-query suggestions when the announcement prompt changes", async () => {
    const submit = vi.fn();
    const view = render(<Panel center={center} submit={submit} />);
    await screen.findByText("Dark Magician");
    fireEvent.change(screen.getByLabelText("Search card name"), { target: { value: "blue" } });
    await waitFor(() => expect(searchDuelCards).toHaveBeenLastCalledWith("blue", "table"));
    view.rerender(<Panel center={center} submit={submit} current={{ ...prompt, id: "next-announce" }} />);
    await waitFor(() => expect(searchDuelCards).toHaveBeenLastCalledWith("", "table"));
    expect(screen.getByLabelText("Search card name")).toHaveValue("");
  });
  it("declares only the highlighted name after an exact-name search", async () => {
    const submit = vi.fn();
    const matches = [card(12580477, "Raigeki"), card(4178474, "Raigeki Break", true)];
    render(<Panel center={center} submit={submit} />);
    await screen.findByText("Dark Magician");
    searchDuelCards.mockResolvedValueOnce({ cards: matches });
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "raigeki" } });
    await screen.findByText("Raigeki Break");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submit).toHaveBeenCalledExactlyOnceWith({ cardCode: 12580477 });
    submit.mockClear();
    fireEvent.mouseEnter(screen.getByRole("option", { name: /Raigeki Break/ }));
    expect(screen.getByRole("option", { name: /Raigeki Break/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", repeat: true });
    expect(submit).toHaveBeenCalledExactlyOnceWith({ cardCode: 4178474 });
  });
  it("keeps old rows while searching and blocks selection until the new reply arrives", async () => {
    const submit = vi.fn();
    let finish!: (result: { cards: DuelCardInfo[] }) => void;
    render(<Panel center={center} submit={submit} />);
    await screen.findByText("Dark Magician");
    searchDuelCards.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "blue" } });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("listbox")).toHaveAttribute("data-stale", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: /Dark Magician/ }));
    expect(submit).not.toHaveBeenCalled();
    await waitFor(() => expect(searchDuelCards).toHaveBeenLastCalledWith("blue", "table"));
    expect(screen.getByText("Dark Magician")).toBeVisible();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
    await act(async () => { finish({ cards: [suggestions[0]] }); });
    expect(screen.queryByText("Dark Magician")).toBeNull();
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "false");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submit).toHaveBeenCalledExactlyOnceWith({ cardCode: 1 });
  });
  it("announces a short result count and keeps options outside the Tab order and live regions", async () => {
    render(<Panel center={center} submit={vi.fn()} />);
    await screen.findByText("Dark Magician");
    expect(screen.getByRole("status")).toHaveTextContent(/^2 results$/);
    const list = screen.getByRole("listbox");
    expect(list.closest('[aria-live="polite"], [aria-live="assertive"]')).toBeNull();
    for (const option of screen.getAllByRole("option")) expect(option).toHaveAttribute("tabindex", "-1");
  });
  it.each([
    ["", "No matching cards in your deck. Type at least 2 characters to search all legal names."],
    ["zz", "No matching legal card names."],
  ])("shows the correct empty state for query %j", async (query, message) => {
    searchDuelCards.mockResolvedValue({ cards: [] });
    render(<Panel center={center} submit={vi.fn()} />);
    if (query) fireEvent.change(screen.getByRole("combobox"), { target: { value: query } });
    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

it("does not pick cards while busy or while the query results are stale", async () => {
  const pick = vi.fn();
  const view = render(<AnnounceSearch slug="table" cardCode={null} busy={false} onPick={pick} />);
  await screen.findByText("Dark Magician");
  fireEvent.change(screen.getByLabelText("Search card name"), { target: { value: "xyz" } });
  fireEvent.keyDown(screen.getByLabelText("Search card name"), { key: "Enter" });
  expect(pick).not.toHaveBeenCalled();
  view.rerender(<AnnounceSearch slug="table" cardCode={null} busy onPick={pick} />);
  fireEvent.keyDown(screen.getByLabelText("Search card name"), { key: "Enter" });
  expect(pick).not.toHaveBeenCalled();
});

it("ignores an older search response and exposes the active result to assistive technology", async () => {
  let finishOld!: (result: { cards: DuelCardInfo[] }) => void;
  searchDuelCards.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  searchDuelCards.mockResolvedValueOnce({ cards: [suggestions[0]] });
  render(<AnnounceSearch slug="table" cardCode={null} busy={false} onPick={vi.fn()} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "blue" } });
  await screen.findByText("Blue-Eyes White Dragon");
  await act(async () => { finishOld({ cards: [suggestions[1]] }); });
  expect(screen.queryByText("Dark Magician")).toBeNull();
  const input = screen.getByRole("combobox");
  expect(input).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("option")).toHaveAttribute("id", input.getAttribute("aria-activedescendant"));
});
