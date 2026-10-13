// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForkSearchContext } from "@/components/duel/replay-fork-control";
import { AnnounceSearch } from "@/components/duel/prompts";
import type { ForkSearchBinding } from "@/components/duel/api";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const card = (code: number, name: string) => ({ code, name, type: "Monster", description: "" });

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function Harness({ binding }: { binding: ForkSearchBinding | null }) {
  return (
    <ForkSearchContext.Provider value={binding}>
      <AnnounceSearch slug="fork-1" cardCode={null} busy={false} onPick={() => {}} />
    </ForkSearchContext.Provider>
  );
}

async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(260); }); }

describe("announce card search of a replay fork", () => {
  it("sends the seat, prompt and revision it was typed for, and clears old results when the binding changes", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => json({ cards: [card(1, "Dark Magician")] }));
    vi.stubGlobal("fetch", fetch);
    const view = render(<Harness binding={{ as: 1, promptId: "p1", revision: 4 }} />);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe("/api/duels/cards?q=&slug=fork-1&as=1&promptId=p1&revision=4");
    fireEvent.change(screen.getByLabelText("Search card name"), { target: { value: "dark" } });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String((fetch.mock.calls[1] as unknown[])[0])).toBe("/api/duels/cards?q=dark&slug=fork-1&as=1&promptId=p1&revision=4");
    expect(screen.getByText("Dark Magician")).toBeTruthy();

    // The same binding by value (a new object) does not search again.
    view.rerender(<Harness binding={{ as: 1, promptId: "p1", revision: 4 }} />);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Dark Magician")).toBeTruthy();

    // A new prompt for the same seat: the old results go at once and the search asks again for the new binding.
    let release!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise<Response>((done) => { release = done; }));
    view.rerender(<Harness binding={{ as: 1, promptId: "p2", revision: 5 }} />);
    expect(screen.queryByText("Dark Magician")).toBeNull();
    await settle();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String((fetch.mock.calls[2] as unknown[])[0])).toBe("/api/duels/cards?q=dark&slug=fork-1&as=1&promptId=p2&revision=5");
    await act(async () => { release(json({ cards: [card(2, "Dark Hole")] })); });
    expect(screen.getByText("Dark Hole")).toBeTruthy();
  });
});
