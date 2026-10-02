// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CubesLibraryList } from "@/components/cubes/cubes-library-list";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const cubes = [
  { id: 1, name: "Blue-Eyes pool", archetype: "Blue-Eyes", banlist: "TCG", mainCount: 14, extraCount: 3, setNames: [], customCardIds: [] },
  { id: 2, name: "Weekend sets", archetype: null, banlist: null, mainCount: 0, extraCount: 0, setNames: ["LOB", "MRD"], customCardIds: [] },
];

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("CubesLibraryList", () => {
  it("lists cubes, with a template row that has no editor link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ cubes }) }) as Response));
    render(<CubesLibraryList />);
    expect(await screen.findByRole("link", { name: "Blue-Eyes pool" })).toHaveAttribute("href", "/cubes/1");
    expect(screen.getByText("Weekend sets")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Weekend sets" })).toBeNull();
    expect(screen.getByText("Draft template")).toBeInTheDocument();
  });

  it("confirms a delete in the row, focusing Keep", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === "DELETE" ? ({ ok: true, json: async () => ({}) } as Response) : ({ ok: true, json: async () => ({ cubes }) } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<CubesLibraryList />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Blue-Eyes pool" }));
    expect(screen.getByText(/Delete Blue-Eyes pool for everyone on the server\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Blue-Eyes pool" })).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith("/api/cubes/1", { method: "DELETE" });
  });

  it("shows the empty state and offers Retry on a load error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ cubes: [] }) }) as Response));
    const { unmount } = render(<CubesLibraryList />);
    expect(await screen.findByRole("heading", { name: "No cubes yet" })).toBeInTheDocument();
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response));
    render(<CubesLibraryList />);
    expect(await screen.findByText(/Couldn.t load your cubes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });
});
