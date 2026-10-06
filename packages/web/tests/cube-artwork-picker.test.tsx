// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CubeEditor } from "@/components/cubes/cube-editor";
import { clearCardArtworksCache } from "@/lib/card-artworks-client";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

function card(id: number, name: string) {
  return { id, name, type: "Normal Monster", frameType: "normal", effectText: "", imageUrl: "i", imageUrlSmall: "i" };
}
const url = (passcode: number, variant: string) => `/api/cards/${passcode}/image?variant=${variant}`;
const FAMILY = {
  passcode: 1,
  artworks: [1, 2].map((passcode) => ({ passcode, isMain: passcode === 1, imageUrl: url(passcode, "full"), smallUrl: url(passcode, "small"), croppedUrl: url(passcode, "cropped") })),
};

let entries: Array<{ catalogCardId: number; pool: "main"; maxCopies: number }>;
let posts: Array<Record<string, unknown>>;
let swapError: string | null;

beforeEach(() => {
  clearCardArtworksCache();
  entries = [{ catalogCardId: 1, pool: "main", maxCopies: 2 }];
  posts = [];
  swapError = null;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const target = String(input);
    const detail = () => ({ pools: { main: entries, extra: [] }, cards: entries.map((entry) => card(entry.catalogCardId, "Main A")) });
    if (target.endsWith("/api/cubes/5/cards")) {
      const body = JSON.parse(String(init?.body)) as { op: string; catalogCardId: number; artworkPasscode: number };
      posts.push(body);
      if (swapError) return { ok: false, status: 400, json: async () => ({ error: swapError }) } as Response;
      entries = entries.map((entry) => (entry.catalogCardId === body.catalogCardId ? { ...entry, catalogCardId: body.artworkPasscode } : entry));
      return { ok: true, json: async () => detail() } as Response;
    }
    if (target.endsWith("/api/cubes/5")) {
      return { ok: true, json: async () => ({ cube: { id: 5, name: "Custom", archetype: null, banlist: null, draftType: undefined, settings: {} }, ...detail() }) } as Response;
    }
    if (target.endsWith("/artworks")) return { ok: true, json: async () => FAMILY } as Response;
    return { ok: true, json: async () => ({ cards: [] }) } as Response;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openSelected() {
  render(<CubeEditor cubeId={5} />);
  await screen.findByRole("heading", { name: "Custom" });
  fireEvent.click(screen.getByRole("button", { name: "Main A, 2 copies" }));
  return within(await screen.findByRole("group", { name: "Choose an art" })).getAllByRole("button");
}

describe("cube card art", () => {
  it("swaps the art of the selected card and keeps it selected", async () => {
    const thumbs = await openSelected();
    expect(thumbs[0]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(thumbs[1]!);
    await waitFor(() => expect(posts).toEqual([{ op: "setArtwork", catalogCardId: 1, artworkPasscode: 2 }]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Main A, 2 copies" })).toHaveAttribute("aria-pressed", "true"));
    const after = within(await screen.findByRole("group", { name: "Choose an art" })).getAllByRole("button");
    await waitFor(() => expect(after[1]).toHaveAttribute("aria-pressed", "true"));
  });

  it("shows the server reason and keeps the card when the swap is refused", async () => {
    swapError = "That art is already in the cube.";
    const thumbs = await openSelected();
    fireEvent.click(thumbs[1]!);
    expect(await screen.findByText("That art is already in the cube.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Main A, 2 copies" })).toHaveAttribute("aria-pressed", "true");
  });
});
