// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedDeck } from "@yugidraft/shared/duels";
import { SavedDeckLibrary } from "../../src/components/decks/library";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const created: Array<{ name: string; mode: string }> = [];

function stubApi() {
  let nextId = 1;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/decks" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Omit<SavedDeck, "id" | "createdAt" | "updatedAt">;
      created.push({ name: body.name, mode: body.mode });
      const deck: SavedDeck = { ...body, id: nextId++, createdAt: "2026-09-30 12:00:00", updatedAt: "2026-09-30 12:00:00" };
      return Response.json({ deck }, { status: 201 });
    }
    return Response.json({ decks: [] });
  }));
}

function ydkFile(name: string, text: string) {
  return new File([text], name, { type: "text/plain" });
}

afterEach(() => {
  created.length = 0;
  vi.unstubAllGlobals();
});

describe("SavedDeckLibrary YDK import", () => {
  it("saves every chosen file as its own deck and lists it", async () => {
    stubApi();
    render(<SavedDeckLibrary />);
    await screen.findByText(/No saved decks yet/);

    fireEvent.click(screen.getByRole("button", { name: /Import YDK$/ }));
    fireEvent.change(screen.getByLabelText("YDK files"), {
      target: {
        files: [
          ydkFile("Blue_Eyes.ydk", "#main\n89631139\n#extra\n!side\n"),
          ydkFile("Notes.txt", "nothing here"),
          ydkFile("Master.ydk", "#deckmaster\n14558127\n#main\n89631139\n#extra\n!side\n"),
        ],
      },
    });

    await waitFor(() => expect(screen.getAllByText(/^Saved as/)).toHaveLength(2));
    expect(created).toEqual([
      { name: "Blue Eyes", mode: "normal" },
      { name: "Master", mode: "domain" },
    ]);
    expect(screen.getByText("No cards found. Is this a YDK file?")).toBeInTheDocument();

    const list = screen.getAllByRole("list").find((el) => el.querySelector("a[href='/decks/1']") && el.textContent?.includes("Updated"));
    expect(list).toBeDefined();
    expect(within(list!).getByText("Blue Eyes")).toBeInTheDocument();
    expect(within(list!).getByText("Master")).toBeInTheDocument();
  });
});
